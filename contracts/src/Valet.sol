// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Assert, BeneficiaryMode, Bounds, Capsule, Escalation, MintParams, SpendRequest, Vault} from "./ValetTypes.sol";

/// @title Valet — bounded, revocable spending authority for agents
/// @notice A valet key for money. The car starts, the boot stays shut, and that
///         isn't a promise about a server — it is the shape of the key.
/// @dev Phase 1.1: vaults, capsules, the three roles, minting, funding, claiming.
///      Spending (`_checkAndCharge` + `execute`) arrives in 1.2/1.3; the storage
///      here is already shaped to carry every assert those will make.
contract Valet is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @dev The type the issuer signs. Named here so the frontend and the
    ///      contract cannot disagree about it. Note for the client: Privy's REST
    ///      endpoint wants `primary_type` in snake_case, not viem's `primaryType`.
    bytes32 public constant ESCALATION_TYPEHASH =
        keccak256("Escalation(uint256 capsuleId,uint256 amount,uint256 nonce,uint64 deadline)");

    /// @dev The recipient's side of a capsule is signature-first for a reason.
    ///      Someone being set up with a permission has no wallet, no seed
    ///      phrase and no gas — that is the whole point of handing them a link.
    ///      Requiring them to transact would mean requiring them to be funded,
    ///      and paying their gas through a paymaster would mean a credit balance
    ///      that can run out mid-demo. A signature needs neither.
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(uint256 capsuleId,address holder,uint256 nonce,uint64 deadline)");
    bytes32 public constant PRINCIPAL_ACTION_TYPEHASH =
        keccak256("PrincipalAction(uint256 capsuleId,uint8 action,bool value,uint256 nonce,uint64 deadline)");

    uint8 public constant ACTION_PAUSE = 0;
    uint8 public constant ACTION_SURRENDER = 1;

    constructor() EIP712("Valet", "1") {}

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

    /// @dev capsuleId => nonce => escalation
    mapping(uint256 => mapping(uint256 => Escalation)) internal _escalations;
    /// @dev next nonce per capsule; a request takes one, so a signature for one
    ///      request can never be replayed against another
    mapping(uint256 => uint256) public escalationNonce;

    /// @dev One counter per capsule for the recipient's signed actions, so a
    ///      signature for one action can never be replayed as another.
    mapping(uint256 => uint256) public principalNonce;

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
    event CapsuleTightened(uint256 indexed capsuleId, address indexed issuer);
    event VaultSwept(uint256 indexed vaultId, address indexed issuer, uint256 amount);
    event EscalationRequested(uint256 indexed capsuleId, uint256 indexed nonce, uint256 amount, string reason);
    event EscalationApproved(uint256 indexed capsuleId, uint256 indexed nonce, uint256 amount, uint64 deadline);
    event EscalationConsumed(uint256 indexed capsuleId, uint256 indexed nonce, uint256 amountUsed);

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
    error NotATightening(string what);
    error NotRequested();
    error AlreadyApproved();
    error AlreadyConsumed();
    error NotApproved();
    error PastDeadline();
    error OverApprovedAmount(uint256 asked, uint256 approved);
    error BadSignature();
    error PointlessEscalation();
    error UnknownAction();

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
        return _spend(r, venueData, false);
    }

    function _spend(SpendRequest calldata r, bytes calldata venueData, bool elevated)
        internal
        returns (uint256 received)
    {
        (Capsule storage c, Vault storage v) = _checkAndCharge(r, elevated);

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
        return _evaluate(r, caller, false);
    }

    /// @notice As preflight, but as it would be judged under an approved escalation.
    function preflightElevated(SpendRequest calldata r, address caller) public view returns (Assert which) {
        return _evaluate(r, caller, true);
    }

    function _evaluate(SpendRequest calldata r, address caller, bool elevated)
        internal
        view
        returns (Assert which)
    {
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
        if (!elevated) {
            if (r.amountIn > c.bounds.perAction) return Assert.OVER_ACTION_CAP;
            uint256 inWindow = (idx == c.lastWindowIndex) ? c.spentInWindow : 0;
            if (inWindow + r.amountIn > c.bounds.perWindow) return Assert.OVER_WINDOW_CAP;
        }

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
    function _checkAndCharge(SpendRequest calldata r, bool elevated)
        internal
        returns (Capsule storage c, Vault storage v)
    {
        Assert which = _evaluate(r, msg.sender, elevated);
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




    // --- the recipient acts by signature, never by transaction -------------
    //
    // Every function here may be submitted by anyone. Authority is in the
    // signature, so a recipient who has never held a token can claim a
    // capsule, pause it, or hand it back, and a relayer pays. No paymaster, no
    // gas credits, nothing to top up.

    function claimDigest(uint256 capsuleId, address holder, uint256 nonce, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, capsuleId, holder, nonce, deadline)));
    }

    function principalActionDigest(uint256 capsuleId, uint8 action, bool value, uint256 nonce, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(PRINCIPAL_ACTION_TYPEHASH, capsuleId, action, value, nonce, deadline))
        );
    }

    /// @notice Claim with the principal's (or issuer's) signature.
    /// @dev Same single-use guarantee as claim(): holder must still be unset.
    function claimBySignature(uint256 capsuleId, address holder, uint64 deadline, bytes calldata signature)
        external
    {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();
        if (c.holder != address(0)) revert AlreadyClaimed();
        if (holder == address(0)) revert ZeroAddress();
        if (block.timestamp >= deadline) revert PastDeadline();

        uint256 nonce = principalNonce[capsuleId];
        bytes32 digest = claimDigest(capsuleId, holder, nonce, deadline);
        bool byPrincipal = SignatureChecker.isValidSignatureNow(c.principal, digest, signature);
        bool byIssuer = byPrincipal || SignatureChecker.isValidSignatureNow(c.issuer, digest, signature);
        if (!byIssuer) revert BadSignature();

        principalNonce[capsuleId] = nonce + 1;
        c.holder = holder;
        emit CapsuleClaimed(capsuleId, holder, byPrincipal ? c.principal : c.issuer);
    }

    /// @notice Pause or hand back, with the principal's signature.
    function principalActionBySignature(
        uint256 capsuleId,
        uint8 action,
        bool value,
        uint64 deadline,
        bytes calldata signature
    ) external {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();
        if (block.timestamp >= deadline) revert PastDeadline();

        uint256 nonce = principalNonce[capsuleId];
        bytes32 digest = principalActionDigest(capsuleId, action, value, nonce, deadline);
        if (!SignatureChecker.isValidSignatureNow(c.principal, digest, signature)) revert BadSignature();

        principalNonce[capsuleId] = nonce + 1;

        if (action == ACTION_PAUSE) {
            c.pausedByPrincipal = value;
            emit CapsulePaused(capsuleId, c.principal, false, value);
        } else if (action == ACTION_SURRENDER) {
            c.surrendered = true;
            emit CapsuleSurrendered(capsuleId, c.principal);
        } else {
            revert UnknownAction();
        }
    }

    // --- escalation -------------------------------------------------------
    //
    // An agent can ask to exceed its limit. It can never approve.
    //
    // The issuer's half of this is a signature and nothing else: approveEscalation
    // may be submitted by anyone holding it, so the issuer needs no gas and never
    // sends a transaction. What makes it theirs is that the signature must recover
    // to the capsule's issuer — a key the agent has never held.

    /// @notice The holder asks for more than its per-action cap allows.
    /// @dev A request over the hard cap is deliberately allowed through. The
    ///      issuer should be able to see that the agent asked for something
    ///      absurd, and the refusal belongs at execution, where the hard cap is.
    function requestEscalation(uint256 capsuleId, uint256 amount, string calldata reason)
        external
        returns (uint256 nonce)
    {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();
        if (msg.sender != c.holder) revert Refused(Assert.NOT_HOLDER);
        if (amount <= c.bounds.perAction) revert PointlessEscalation();

        nonce = escalationNonce[capsuleId]++;
        Escalation storage e = _escalations[capsuleId][nonce];
        e.requestedAmount = amount;
        e.requested = true;

        emit EscalationRequested(capsuleId, nonce, amount, reason);
    }

    /// @notice Turn the issuer's signature into a one-shot permit.
    /// @dev Callable by anyone. The authority is in the signature, not the
    ///      sender, which is what lets the issuer approve from a wallet holding
    ///      no gas — they sign, a relayer pays.
    function approveEscalation(
        uint256 capsuleId,
        uint256 amount,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        Capsule storage c = _capsules[capsuleId];
        if (c.issuer == address(0)) revert NoSuchCapsule();

        Escalation storage e = _escalations[capsuleId][nonce];
        if (!e.requested) revert NotRequested();
        if (e.approved) revert AlreadyApproved();
        if (block.timestamp >= deadline) revert PastDeadline();

        bytes32 digest = escalationDigest(capsuleId, amount, nonce, deadline);
        if (!SignatureChecker.isValidSignatureNow(c.issuer, digest, signature)) revert BadSignature();

        e.approvedAmount = amount;
        e.deadline = deadline;
        e.approved = true;

        emit EscalationApproved(capsuleId, nonce, amount, deadline);
    }

    /// @notice The digest the issuer signs. Exposed so a client cannot guess wrong.
    function escalationDigest(uint256 capsuleId, uint256 amount, uint256 nonce, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(ESCALATION_TYPEHASH, capsuleId, amount, nonce, deadline)));
    }

    /// @notice Spend under an approved escalation. Lifts the soft caps, and only those.
    /// @dev The permit is consumed before the venue is touched, so a reentrant
    ///      call finds it already spent.
    function executeElevated(SpendRequest calldata r, bytes calldata venueData, uint256 nonce)
        external
        nonReentrant
        returns (uint256 received)
    {
        Escalation storage e = _escalations[r.capsuleId][nonce];
        if (!e.approved) revert NotApproved();
        if (e.consumed) revert AlreadyConsumed();
        if (block.timestamp >= e.deadline) revert PastDeadline();
        if (r.amountIn > e.approvedAmount) revert OverApprovedAmount(r.amountIn, e.approvedAmount);

        e.consumed = true;
        emit EscalationConsumed(r.capsuleId, nonce, r.amountIn);

        received = _spend(r, venueData, true);
    }

    function getEscalation(uint256 capsuleId, uint256 nonce) external view returns (Escalation memory) {
        return _escalations[capsuleId][nonce];
    }

    // --- tightening: the limits may move down, never up --------------------

    /// @notice Narrow a live capsule. Every bound may only become stricter.
    /// @dev The issuer set these once while thinking clearly. Allowing a later
    ///      loosening would mean the ceiling a recipient was shown is not the
    ///      ceiling they have — so an issuer who wants a wider permission mints
    ///      a new capsule, which the recipient must accept, rather than quietly
    ///      widening one already in someone's hands.
    ///
    ///      `notBefore` and `windowLength` are immutable rather than merely
    ///      one-directional. Window index is (now - notBefore) / windowLength,
    ///      so moving either re-indexes every window — spending already recorded
    ///      against the old indices would land in different windows, and a
    ///      capsule could be made to forget that today was spent.
    function tighten(uint256 capsuleId, Bounds calldata b) external onlyIssuer(capsuleId) {
        Capsule storage c = _capsules[capsuleId];
        Bounds memory old = c.bounds;

        if (b.notBefore != old.notBefore) revert NotATightening("notBefore is immutable");
        if (b.windowLength != old.windowLength) revert NotATightening("windowLength is immutable");

        if (b.perAction > old.perAction) revert NotATightening("perAction");
        if (b.perWindow > old.perWindow) revert NotATightening("perWindow");
        if (b.hardCap > old.hardCap) revert NotATightening("hardCap");
        if (b.totalCap > old.totalCap) revert NotATightening("totalCap");
        if (b.windows > old.windows) revert NotATightening("windows");
        if (b.expiresAt > old.expiresAt) revert NotATightening("expiresAt");
        if (b.maxSlippageBps > old.maxSlippageBps) revert NotATightening("maxSlippageBps");

        // the result still has to be a coherent set of bounds, so an issuer
        // cannot drop hardCap under perAction and leave the pair contradictory
        _validateBounds(b);

        c.bounds = b;
        emit CapsuleTightened(capsuleId, msg.sender);
    }

    // --- ending it ---------------------------------------------------------

    /// @notice End every capsule on a vault and take the money back, at once.
    /// @dev One transaction, because the two halves are not separable in
    ///      practice: revoking and then sweeping leaves a window in which the
    ///      capsules are dead but the funds are still here, and sweeping first
    ///      leaves live capsules pointing at an empty vault.
    function revokeVaultAndSweep(uint256 vaultId) external nonReentrant returns (uint256 amount) {
        Vault storage v = _vaults[vaultId];
        if (v.issuer == address(0)) revert NoSuchVault();
        if (msg.sender != v.issuer) revert NotIssuer();

        v.revoked = true;
        amount = v.balance;
        v.balance = 0;

        emit VaultRevoked(vaultId, msg.sender);
        if (amount > 0) {
            IERC20(v.asset).safeTransfer(msg.sender, amount);
            emit VaultSwept(vaultId, msg.sender, amount);
        }
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
