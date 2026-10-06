// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Assert, BeneficiaryMode, Bounds, Capsule, MintParams, SpendRequest, Vault} from "./ValetTypes.sol";

/// @title Valet — bounded, revocable spending authority for agents
/// @notice A valet key for money. The car starts, the boot stays shut, and that
///         isn't a promise about a server — it is the shape of the key.
/// @dev Phase 1.1: vaults, capsules, the three roles, minting, funding, claiming.
///      Spending (`_checkAndCharge` + `execute`) arrives in 1.2/1.3; the storage
///      here is already shaped to carry every assert those will make.
contract Valet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- storage ---

    uint256 public nextVaultId = 1;
    uint256 public nextCapsuleId = 1;

    mapping(uint256 => Vault) internal _vaults;
    mapping(uint256 => Capsule) internal _capsules;

    /// @dev Scope: the venues a capsule may touch. Per capsule, by address, so a
    ///      permission is coupled to no particular DEX.
    mapping(uint256 => mapping(address => bool)) public allowedTarget;

    /// @dev Proceeds held for a VAULT-mode capsule, denominated in its assetOut.
    ///      Kept apart from Vault.balance, which is the spendable input asset —
    ///      conflating them would let a capsule spend what it just earned.
    mapping(uint256 => uint256) public proceedsOf;

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
    event CapsuleSurrendered(uint256 indexed capsuleId, address indexed principal);
    event CapsulePaused(uint256 indexed capsuleId, address indexed by, bool isIssuer, bool paused);
    event Executed(
        uint256 indexed capsuleId,
        address indexed holder,
        address indexed target,
        uint256 amountIn,
        uint256 received,
        address beneficiary
    );
    event ProceedsSwept(uint256 indexed capsuleId, address indexed to, uint256 amount);

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

    /// @notice A spend was refused, and by which of the nineteen checks.
    error Refused(Assert which);
    error VenueCallFailed(bytes reason);
    error BelowFloor(uint256 received, uint256 minOut);
    error PayoutFailed();
    error NothingToSweep();

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

        if (p.assetOut == v.asset) revert BadBounds("assetOut equals assetIn");
        _validateBounds(p.bounds);

        capsuleId = nextCapsuleId++;
        Capsule storage c = _capsules[capsuleId];
        c.vaultId = p.vaultId;
        c.issuer = msg.sender;
        c.principal = p.principal;
        c.mode = p.mode;
        c.fixedBeneficiary = p.fixedBeneficiary;
        c.assetOut = p.assetOut;
        c.policyHash = p.policyHash;
        c.bounds = p.bounds;

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

    /// @dev Ends every capsule drawing on this vault at once.
    function revokeVault(uint256 vaultId) external {
        Vault storage v = _vaults[vaultId];
        if (v.issuer == address(0)) revert NoSuchVault();
        if (msg.sender != v.issuer) revert NotIssuer();
        v.revoked = true;
        emit VaultRevoked(vaultId, msg.sender);
    }

    /// @notice The recipient hands the capability back.
    /// @dev Not called "revoke": the funds were never theirs to reclaim.
    function surrender(uint256 capsuleId) external onlyPrincipal(capsuleId) {
        _capsules[capsuleId].surrendered = true;
        emit CapsuleSurrendered(capsuleId, msg.sender);
    }

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



    // --- spending ---------------------------------------------------------

    /// @notice The only way money leaves a vault.
    /// @param r         what the holder declares it intends to do
    /// @param venueData the call to make at the venue — opaque to us on purpose
    /// @return received proceeds, measured rather than reported, and already
    ///         delivered to the beneficiary fixed at mint
    ///
    /// @dev The agent names the venue and writes the calldata; it never takes
    ///      custody. Funds go contract -> venue -> contract -> beneficiary inside
    ///      one transaction, and the destination was decided at mint. Skimming is
    ///      not detected and punished here — there is no point in the flow at
    ///      which the agent holds the asset to skim from.
    ///
    ///      Proceeds are measured as a balance delta, not read from the venue's
    ///      return value, because a venue that lies about its return value is a
    ///      venue we would otherwise trust.
    function execute(SpendRequest calldata r, bytes calldata venueData)
        external
        nonReentrant
        returns (uint256 received)
    {
        (Capsule storage c, Vault storage v) = _checkAndCharge(r);

        address assetOut = c.assetOut;
        uint256 before = _balanceOf(assetOut);

        IERC20(v.asset).forceApprove(r.target, r.amountIn);
        (bool ok, bytes memory err) = r.target.call(venueData);
        if (!ok) revert VenueCallFailed(err);
        IERC20(v.asset).forceApprove(r.target, 0);

        received = _balanceOf(assetOut) - before;
        if (received < r.minOut) revert BelowFloor(received, r.minOut);

        address beneficiary = beneficiaryOf(r.capsuleId);
        if (beneficiary == address(this)) {
            // VAULT mode: the issuer's money stayed the issuer's, and the
            // proceeds are booked rather than left loose in the contract
            proceedsOf[r.capsuleId] += received;
        } else {
            _payOut(assetOut, beneficiary, received);
        }

        emit Executed(r.capsuleId, msg.sender, r.target, r.amountIn, received, beneficiary);
    }

    /// @notice The issuer collects what a VAULT-mode capsule earned.
    function sweepProceeds(uint256 capsuleId) external nonReentrant onlyIssuer(capsuleId) returns (uint256 amount) {
        amount = proceedsOf[capsuleId];
        if (amount == 0) revert NothingToSweep();
        proceedsOf[capsuleId] = 0;
        _payOut(_capsules[capsuleId].assetOut, msg.sender, amount);
        emit ProceedsSwept(capsuleId, msg.sender, amount);
    }

    function _balanceOf(address asset) internal view returns (uint256) {
        return asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
    }

    function _payOut(address asset, address to, uint256 amount) internal {
        if (asset == address(0)) {
            (bool sent,) = to.call{value: amount}("");
            if (!sent) revert PayoutFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    /// @dev Kuru pays out native MON on a buy, so proceeds arrive this way.
    receive() external payable {}

    // --- the nineteen checks ---------------------------------------------
    //
    // Every spend passes through here. The limits are not in our server and not
    // in the agent's prompt; they are these requires, and an agent that ignores
    // every description it was given still meets them.

    /// @notice Evaluate a request without changing anything.
    /// @dev Shares its body with `_checkAndCharge`, so what the console shows and
    ///      what the chain enforces cannot drift apart. The UI preflights with
    ///      this; the holder spends through the other.
    /// @return which the first check that refuses, or Assert.NONE if all pass
    function preflight(SpendRequest calldata r, address caller) public view returns (Assert which) {
        Capsule storage c = _capsules[r.capsuleId];
        if (c.issuer == address(0)) return Assert.VAULT_MISMATCH;
        Vault storage v = _vaults[c.vaultId];

        // -- who is asking (3)
        if (r.vaultId != c.vaultId) return Assert.VAULT_MISMATCH;
        if (c.holder == address(0)) return Assert.NOT_CLAIMED;
        if (caller != c.holder) return Assert.NOT_HOLDER;

        // -- is it alive (6)
        if (v.revoked) return Assert.VAULT_REVOKED;
        if (c.revoked) return Assert.CAPSULE_REVOKED;
        if (c.surrendered) return Assert.SURRENDERED;
        if (c.pausedByIssuer || c.pausedByPrincipal) return Assert.PAUSED;
        if (block.timestamp < c.bounds.notBefore) return Assert.BEFORE_START;
        if (block.timestamp >= c.bounds.expiresAt) return Assert.EXPIRED;

        // -- recurrence (1)
        // Window index is computed, not rolled forward. A window that goes unused
        // is forfeited rather than banked, because letting a skipped day become
        // spendable later rebuilds the lump-sum risk this exists to remove.
        uint256 idx = (block.timestamp - c.bounds.notBefore) / c.bounds.windowLength;
        if (idx >= c.bounds.windows) return Assert.WINDOWS_EXHAUSTED;

        // -- soft caps (3): an approved escalation may lift these, and only these
        if (r.amountIn == 0) return Assert.ZERO_AMOUNT;
        if (r.amountIn > c.bounds.perAction) return Assert.OVER_ACTION_CAP;
        uint256 inWindow = (idx == c.lastWindowIndex) ? c.spentInWindow : 0;
        if (inWindow + r.amountIn > c.bounds.perWindow) return Assert.OVER_WINDOW_CAP;

        // -- hard caps (2): nothing lifts these. Not a permit, not the issuer at
        //    3am, not a compromised backend.
        if (r.amountIn > c.bounds.hardCap) return Assert.OVER_HARD_CAP;
        if (c.spentTotal + r.amountIn > c.bounds.totalCap) return Assert.OVER_TOTAL_CAP;

        // -- scope (3)
        if (!allowedTarget[r.capsuleId][r.target]) return Assert.TARGET_NOT_ALLOWED;
        if (!_floorWithinSlippage(r.quotedOut, r.minOut, c.bounds.maxSlippageBps)) {
            return Assert.SLIPPAGE_TOO_WIDE;
        }
        if (r.recipient != beneficiaryOf(r.capsuleId)) return Assert.WRONG_RECIPIENT;

        // -- funds (1)
        if (v.balance < r.amountIn) return Assert.VAULT_UNDERFUNDED;

        return Assert.NONE;
    }

    /// @dev The floor the holder commits to must sit within the slippage the
    ///      policy allows, measured against the quote the holder itself declared.
    ///
    ///      This bounds the holder's discretion, not its honesty: an agent that
    ///      quotes 100 cannot then accept 50, but nothing here stops it quoting
    ///      50 in the first place. That is deliberate, and it is safe, because the
    ///      holder never receives the proceeds — `recipient` is checked against a
    ///      beneficiary fixed at mint, so a bad fill costs the agent nothing to
    ///      gain. Slippage guards sloppiness; custody guards theft.
    function _floorWithinSlippage(uint256 quotedOut, uint256 minOut, uint16 maxSlippageBps)
        internal
        pure
        returns (bool)
    {
        if (quotedOut == 0) return false;
        if (minOut > quotedOut) return true; // a tighter floor than quoted is fine
        uint256 worstAllowed = quotedOut - (quotedOut * maxSlippageBps) / 10_000;
        return minOut >= worstAllowed;
    }

    /// @notice Check, then debit. Reverts naming the check that refused.
    /// @dev Debits before the venue is touched, so a reentrant call sees the
    ///      spend already counted against every cap.
    function _checkAndCharge(SpendRequest calldata r) internal returns (Capsule storage c, Vault storage v) {
        Assert which = preflight(r, msg.sender);
        if (which != Assert.NONE) revert Refused(which);

        c = _capsules[r.capsuleId];
        v = _vaults[c.vaultId];

        uint256 idx = (block.timestamp - c.bounds.notBefore) / c.bounds.windowLength;
        if (idx != c.lastWindowIndex) {
            c.lastWindowIndex = uint32(idx);
            c.spentInWindow = 0;
        }
        c.spentInWindow += r.amountIn;
        c.spentTotal += r.amountIn;
        v.balance -= r.amountIn;
    }

    /// @notice What the console shows: how much room is left, right now.
    function headroom(uint256 capsuleId)
        external
        view
        returns (uint256 perActionLeft, uint256 windowLeft, uint256 totalLeft, uint256 windowIndex)
    {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();
        windowIndex = block.timestamp < c.bounds.notBefore
            ? 0
            : (block.timestamp - c.bounds.notBefore) / c.bounds.windowLength;
        uint256 inWindow = (windowIndex == c.lastWindowIndex) ? c.spentInWindow : 0;
        perActionLeft = c.bounds.perAction;
        windowLeft = c.bounds.perWindow > inWindow ? c.bounds.perWindow - inWindow : 0;
        totalLeft = c.bounds.totalCap > c.spentTotal ? c.bounds.totalCap - c.spentTotal : 0;
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
