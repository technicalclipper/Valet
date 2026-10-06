// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BeneficiaryMode, Bounds, Capsule, MintParams, Vault} from "./ValetTypes.sol";

/// @title Valet — bounded, revocable spending authority for agents
/// @notice A valet key for money. The car starts, the boot stays shut, and that
///         isn't a promise about a server — it is the shape of the key.
/// @dev Phase 1.1: vaults, capsules, the three roles, minting, funding, claiming.
///      Spending (`_checkAndCharge` + `execute`) arrives in 1.2/1.3; the storage
///      here is already shaped to carry every assert those will make.
contract Valet {
    using SafeERC20 for IERC20;

    // --- storage ---

    uint256 public nextVaultId = 1;
    uint256 public nextCapsuleId = 1;

    mapping(uint256 => Vault) internal _vaults;
    mapping(uint256 => Capsule) internal _capsules;

    /// @dev Scope: the venues a capsule may touch. Per capsule, by address, so a
    ///      permission is coupled to no particular DEX.
    mapping(uint256 => mapping(address => bool)) public allowedTarget;

    // --- events: the audit trail is the chain's, not a log we write ---

    event VaultOpened(uint256 indexed vaultId, address indexed issuer, address asset);
    event VaultFunded(uint256 indexed vaultId, address indexed from, uint256 amount, uint256 balance);
    event VaultRevoked(uint256 indexed vaultId, address indexed issuer);
    event CapsuleMinted(
        uint256 indexed capsuleId,
        uint256 indexed vaultId,
        address indexed principal,
        bytes32 policyHash,
        BeneficiaryMode mode
    );
    event CapsuleClaimed(uint256 indexed capsuleId, address indexed holder, address indexed by);
    event CapsuleRevoked(uint256 indexed capsuleId, address indexed issuer);
    event CapsulePaused(uint256 indexed capsuleId, address indexed by, bool isIssuer, bool paused);

    // --- errors ---

    error NotIssuer();
    error NotPrincipal();
    error NoSuchVault();
    error NoSuchCapsule();
    error VaultIsRevoked();
    error WrongAsset();
    error AlreadyClaimed();
    error ZeroAmount();
    error ZeroAddress();
    error BadBounds(string what);

    // --- role gates -------------------------------------------------------
    // Three parties share one capsule without sharing power.

    modifier onlyIssuer(uint256 capsuleId) {
        if (_capsules[capsuleId].issuer == address(0)) revert NoSuchCapsule();
        if (msg.sender != _capsules[capsuleId].issuer) revert NotIssuer();
        _;
    }

    modifier onlyPrincipal(uint256 capsuleId) {
        if (_capsules[capsuleId].issuer == address(0)) revert NoSuchCapsule();
        if (msg.sender != _capsules[capsuleId].principal) revert NotPrincipal();
        _;
    }

    // --- vaults -----------------------------------------------------------

    function openVault(address asset) external returns (uint256 vaultId) {
        if (asset == address(0)) revert ZeroAddress();
        vaultId = nextVaultId++;
        _vaults[vaultId] = Vault({asset: asset, issuer: msg.sender, balance: 0, revoked: false});
        emit VaultOpened(vaultId, msg.sender, asset);
    }

    /// @dev Anyone may add funds, but only the issuer's capsules can spend them.
    ///      The accounted `balance` is tracked rather than read from
    ///      `token.balanceOf(this)`, so one vault cannot spend another's money and
    ///      a stray transfer in cannot quietly raise a capsule's ceiling.
    function fundVault(uint256 vaultId, uint256 amount) external {
        Vault storage v = _vaults[vaultId];
        if (v.issuer == address(0)) revert NoSuchVault();
        if (v.revoked) revert VaultIsRevoked();
        if (amount == 0) revert ZeroAmount();

        IERC20(v.asset).safeTransferFrom(msg.sender, address(this), amount);
        v.balance += amount;
        emit VaultFunded(vaultId, msg.sender, amount, v.balance);
    }

    // --- capsules ---------------------------------------------------------

    function mintCapsule(MintParams calldata p) external returns (uint256 capsuleId) {
        Vault storage v = _vaults[p.vaultId];
        if (v.issuer == address(0)) revert NoSuchVault();
        if (v.revoked) revert VaultIsRevoked();
        if (msg.sender != v.issuer) revert NotIssuer();
        if (p.principal == address(0)) revert ZeroAddress();
        if (p.mode == BeneficiaryMode.FIXED && p.fixedBeneficiary == address(0)) revert ZeroAddress();

        _validateBounds(p.bounds);

        capsuleId = nextCapsuleId++;
        Capsule storage c = _capsules[capsuleId];
        c.vaultId = p.vaultId;
        c.issuer = msg.sender;
        c.principal = p.principal;
        c.mode = p.mode;
        c.fixedBeneficiary = p.fixedBeneficiary;
        c.policyHash = p.policyHash;
        c.bounds = p.bounds;
        c.windowStart = p.bounds.notBefore;

        for (uint256 i = 0; i < p.allowedTargets.length; i++) {
            if (p.allowedTargets[i] == address(0)) revert ZeroAddress();
            allowedTarget[capsuleId][p.allowedTargets[i]] = true;
        }

        emit CapsuleMinted(capsuleId, p.vaultId, p.principal, p.policyHash, p.mode);
    }

    /// @dev Checked at mint, by whoever is awake and thinking, rather than at
    ///      spend time when an agent is driving.
    function _validateBounds(Bounds calldata b) internal pure {
        if (b.hardCap == 0) revert BadBounds("hardCap must be set");
        if (b.totalCap == 0) revert BadBounds("totalCap must be set");
        if (b.perAction == 0) revert BadBounds("perAction must be set");
        // soft caps must sit under the ceilings they are allowed to approach
        if (b.perAction > b.hardCap) revert BadBounds("perAction over hardCap");
        if (b.perWindow < b.perAction) revert BadBounds("perWindow under perAction");
        if (b.perWindow > b.totalCap) revert BadBounds("perWindow over totalCap");
        if (b.hardCap > b.totalCap) revert BadBounds("hardCap over totalCap");
        if (b.windows == 0) revert BadBounds("windows must be set");
        if (b.windowLength == 0) revert BadBounds("windowLength must be set");
        if (b.expiresAt <= b.notBefore) revert BadBounds("expiresAt before notBefore");
        if (b.maxSlippageBps > 10_000) revert BadBounds("slippage over 100%");
    }

    /// @notice Hand the capability to whoever will act. Settable exactly once.
    /// @dev The holder may be any address, including an agent nobody here wrote.
    ///      Nothing in this contract requires it to be ours, and every guarantee
    ///      holds unchanged either way. Single-claim is enforced here and does
    ///      not depend on any off-chain check.
    function claim(uint256 capsuleId, address holder) external {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();
        if (c.holder != address(0)) revert AlreadyClaimed();
        if (holder == address(0)) revert ZeroAddress();
        // the recipient decides who acts for them; the issuer may set it up for them
        if (msg.sender != c.principal && msg.sender != c.issuer) revert NotPrincipal();

        c.holder = holder;
        emit CapsuleClaimed(capsuleId, holder, msg.sender);
    }

    // --- the two powers that prove the role split --------------------------
    // The rest of the lifecycle (surrender, tighten, revoke-and-sweep) is 1.5.

    function revoke(uint256 capsuleId) external onlyIssuer(capsuleId) {
        _capsules[capsuleId].revoked = true;
        emit CapsuleRevoked(capsuleId, msg.sender);
    }

    /// @dev Either party may pause, and neither can unpause the other. A spend
    ///      needs both pauses clear, so one party cannot override the other.
    function setPausedByIssuer(uint256 capsuleId, bool paused) external onlyIssuer(capsuleId) {
        _capsules[capsuleId].pausedByIssuer = paused;
        emit CapsulePaused(capsuleId, msg.sender, true, paused);
    }

    function setPausedByPrincipal(uint256 capsuleId, bool paused) external onlyPrincipal(capsuleId) {
        _capsules[capsuleId].pausedByPrincipal = paused;
        emit CapsulePaused(capsuleId, msg.sender, false, paused);
    }

    // --- views ------------------------------------------------------------

    function getVault(uint256 vaultId) external view returns (Vault memory) {
        if (_vaults[vaultId].issuer == address(0)) revert NoSuchVault();
        return _vaults[vaultId];
    }

    function getCapsule(uint256 capsuleId) external view returns (Capsule memory) {
        if (_capsules[capsuleId].issuer == address(0)) revert NoSuchCapsule();
        return _capsules[capsuleId];
    }

    /// @notice Where a spend's proceeds would land. Decided at mint; not movable.
    function beneficiaryOf(uint256 capsuleId) public view returns (address) {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();
        if (c.mode == BeneficiaryMode.PRINCIPAL) return c.principal;
        if (c.mode == BeneficiaryMode.FIXED) return c.fixedBeneficiary;
        return address(this); // VAULT — proceeds return to the vault
    }
}
