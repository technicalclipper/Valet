// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Where the proceeds of a spend go. Fixed at mint, never movable.
enum BeneficiaryMode {
    VAULT,      // back to the vault: the agent trades the issuer's money
    PRINCIPAL,  // to the recipient: the issuer is giving them exposure over time
    FIXED       // to an address named at mint
}

/// @notice The limits. Everything here is set once, by someone thinking clearly,
///         and may afterwards only be tightened — never loosened.
/// @dev The split between soft and hard is the point. An approved escalation
///      lifts `perAction` and `perWindow` and nothing else; `hardCap` and
///      `totalCap` are not liftable by a permit, by the issuer at 3am, or by a
///      compromised backend.
struct Bounds {
    uint256 perAction;      // soft: most that may move in one spend
    uint256 perWindow;      // soft: most that may move within one window
    uint256 hardCap;        // hard: absolute ceiling on a single spend
    uint256 totalCap;       // hard: lifetime ceiling across every spend
    uint32 windows;         // how many windows this capsule may ever use
    uint64 windowLength;    // seconds per window
    uint64 notBefore;       // nothing before this
    uint64 expiresAt;       // nothing after this
    uint16 maxSlippageBps;  // scope: the worst fill the holder may accept
}

/// @notice Holds the money. The holder never owns this, and never owns what is in it.
struct Vault {
    address asset;      // ERC20 being spent; address(0) would mean native
    address issuer;     // who funded it
    uint256 balance;    // accounted separately from token balance, so a stray
                        // transfer in cannot enlarge what a capsule may spend
    bool revoked;
}

/// @notice The permission itself. Three parties share one capsule without
///         sharing power: access is by role, not by ownership.
///
///  issuer     revoke · pause · top up · tighten
///  principal  pause · hand back
///  holder     execute — and nothing else
struct Capsule {
    uint256 vaultId;
    address issuer;
    address principal;
    address holder;             // zero until claimed; settable exactly once
    BeneficiaryMode mode;
    address fixedBeneficiary;   // only read when mode == FIXED
    bytes32 policyHash;         // hash of the policy document shown before mint
    Bounds bounds;
    // --- mutable state ---
    uint256 spentTotal;
    uint256 spentInWindow;
    uint32 lastWindowIndex;   // which window `spentInWindow` refers to
    bool revoked;               // issuer: ends it
    bool surrendered;           // principal: hands it back
    bool pausedByIssuer;
    bool pausedByPrincipal;
}

/// @notice Which of the nineteen checks refused a spend.
/// @dev One enum rather than nineteen errors, so a refusal is legible to the
///      agent, the console and the demo alike: the chain says *which* limit bit.
enum Assert {
    NONE,
    // who is asking
    VAULT_MISMATCH,
    NOT_CLAIMED,
    NOT_HOLDER,
    // is it alive
    VAULT_REVOKED,
    CAPSULE_REVOKED,
    SURRENDERED,
    PAUSED,
    BEFORE_START,
    EXPIRED,
    // recurrence
    WINDOWS_EXHAUSTED,
    // soft caps — an approved escalation may lift these
    ZERO_AMOUNT,
    OVER_ACTION_CAP,
    OVER_WINDOW_CAP,
    // hard caps — nothing lifts these
    OVER_HARD_CAP,
    OVER_TOTAL_CAP,
    // scope
    TARGET_NOT_ALLOWED,
    SLIPPAGE_TOO_WIDE,
    WRONG_RECIPIENT,
    // funds
    VAULT_UNDERFUNDED
}

/// @notice What the holder is asking to do. The agent declares its intent —
///         venue, size, the fill it expects and where proceeds go — and the
///         contract checks every part of that declaration before anything moves.
struct SpendRequest {
    uint256 capsuleId;
    uint256 vaultId;    // declared, then checked against the capsule
    uint256 amountIn;
    uint256 quotedOut;  // what the agent says the venue will pay
    uint256 minOut;     // the floor it commits to accepting
    address target;     // the venue
    address recipient;  // where the agent says proceeds will land
}

/// @notice Arguments for minting. A struct because the bounds alone are nine fields
///         and positional arguments at that width are how caps get transposed.
struct MintParams {
    uint256 vaultId;
    address principal;
    BeneficiaryMode mode;
    address fixedBeneficiary;
    bytes32 policyHash;
    Bounds bounds;
    address[] allowedTargets;
}
