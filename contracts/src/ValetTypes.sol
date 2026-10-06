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
    uint32 windowsUsed;
    uint64 windowStart;
    bool revoked;               // issuer: ends it
    bool surrendered;           // principal: hands it back
    bool pausedByIssuer;
    bool pausedByPrincipal;
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
