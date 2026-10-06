// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {Assert, BeneficiaryMode, Bounds, MintParams, SpendRequest} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC2 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @dev Exposes the internal charge so 1.2 can be pinned down before 1.3 adds a
///      venue. `liftSoftCap` stands in for what an approved escalation will do,
///      which is the only way the hard cap becomes reachable at all.
contract ValetHarness is Valet {
    function chargeOnly(SpendRequest calldata r) external {
        _checkAndCharge(r, false);
    }

    function chargeElevated(SpendRequest calldata r) external {
        _checkAndCharge(r, true);
    }

    function liftSoftCap(uint256 capsuleId, uint256 newPerAction, uint256 newPerWindow) external {
        _capsules[capsuleId].bounds.perAction = newPerAction;
        _capsules[capsuleId].bounds.perWindow = newPerWindow;
    }
}

/// One test per assert. Nineteen checks, nineteen distinct reasons to refuse.
contract ValetAssertsTest is Test {
    ValetHarness valet;
    MockUSDC2 usdc;

    address issuer = makeAddr("alice");
    address principal = makeAddr("bob");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");
    address venue = makeAddr("kuru");

    uint256 vaultId;
    uint256 capsuleId;
    uint64 start;

    function setUp() public {
        vm.warp(1_000_000);
        start = uint64(block.timestamp);

        valet = new ValetHarness();
        usdc = new MockUSDC2();
        usdc.mint(issuer, 10_000e6);

        vm.startPrank(issuer);
        vaultId = valet.openVault(address(usdc));
        usdc.approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 500e6);

        address[] memory targets = new address[](1);
        targets[0] = venue;
        capsuleId = valet.mintCapsule(MintParams({
            vaultId: vaultId,
            principal: principal,
            mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0),
            assetOut: address(0),
            policyHash: keccak256("5 USDC of MON daily for 30 days, max 1% slippage"),
            bounds: Bounds({
                perAction: 5e6,
                perWindow: 5e6,
                hardCap: 10e6,
                totalCap: 150e6,
                windows: 30,
                windowLength: 1 days,
                notBefore: start,
                expiresAt: start + 30 days,
                maxSlippageBps: 100
            }),
            allowedTargets: targets
        }));
        vm.stopPrank();

        vm.prank(principal);
        valet.claim(capsuleId, agent);
    }

    /// A request that passes every check, which each test then breaks one way.
    function _req() internal view returns (SpendRequest memory) {
        return SpendRequest({
            capsuleId: capsuleId,
            vaultId: vaultId,
            amountIn: 5e6,
            quotedOut: 1_740_000_000_000_000_000, // ~1.74 MON, the real fill from the Kuru spike
            minOut: 1_730_000_000_000_000_000,    // inside 1%
            target: venue,
            recipient: principal
        });
    }

    function _expect(Assert which, SpendRequest memory r) internal {
        assertEq(uint256(valet.preflight(r, agent)), uint256(which), "preflight disagrees");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, which));
        valet.chargeOnly(r);
    }

    // --- the happy path ---------------------------------------------------

    function test_00_allNineteenPass() public {
        SpendRequest memory r = _req();
        assertEq(uint256(valet.preflight(r, agent)), uint256(Assert.NONE));
        vm.prank(agent);
        valet.chargeOnly(r);

        assertEq(valet.getCapsule(capsuleId).spentTotal, 5e6);
        assertEq(valet.getCapsule(capsuleId).spentInWindow, 5e6);
        assertEq(valet.getVault(vaultId).balance, 495e6, "vault debited");
    }

    // --- who is asking (3) ------------------------------------------------

    function test_01_vaultMismatch() public {
        SpendRequest memory r = _req();
        r.vaultId = 999;
        _expect(Assert.VAULT_MISMATCH, r);
    }

    function test_02_notClaimed() public {
        vm.startPrank(issuer);
        address[] memory t = new address[](1);
        t[0] = venue;
        uint256 fresh = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: valet.getCapsule(capsuleId).bounds, allowedTargets: t
        }));
        vm.stopPrank();
        SpendRequest memory r = _req();
        r.capsuleId = fresh;
        _expect(Assert.NOT_CLAIMED, r);
    }

    function test_03_notHolder() public {
        SpendRequest memory r = _req();
        assertEq(uint256(valet.preflight(r, stranger)), uint256(Assert.NOT_HOLDER));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.NOT_HOLDER));
        valet.chargeOnly(r);
    }

    // --- is it alive (6) --------------------------------------------------

    function test_04_vaultRevoked() public {
        vm.prank(issuer);
        valet.revokeVault(vaultId);
        _expect(Assert.VAULT_REVOKED, _req());
    }

    function test_05_capsuleRevoked() public {
        vm.prank(issuer);
        valet.revoke(capsuleId);
        _expect(Assert.CAPSULE_REVOKED, _req());
    }

    function test_06_surrendered() public {
        vm.prank(principal);
        valet.surrender(capsuleId);
        _expect(Assert.SURRENDERED, _req());
    }

    function test_07_pausedByEitherParty() public {
        vm.prank(issuer);
        valet.setPausedByIssuer(capsuleId, true);
        _expect(Assert.PAUSED, _req());

        vm.prank(issuer);
        valet.setPausedByIssuer(capsuleId, false);
        vm.prank(principal);
        valet.setPausedByPrincipal(capsuleId, true);
        _expect(Assert.PAUSED, _req());
    }

    function test_08_beforeStart() public {
        vm.warp(start - 1);
        _expect(Assert.BEFORE_START, _req());
    }

    function test_09_expired() public {
        vm.warp(start + 30 days);
        _expect(Assert.EXPIRED, _req());
    }

    // --- recurrence (1) ---------------------------------------------------

    function test_10_windowsExhausted() public {
        // expiry is 30 days and windows are 30 x 1 day, so shorten the window
        // to reach exhaustion while the capsule is still inside its term
        vm.prank(issuer);
        uint256 id = _mintWith(1 hours, 5, start, start + 30 days);
        vm.prank(principal);
        valet.claim(id, agent);

        vm.warp(start + 5 hours);
        SpendRequest memory r = _req();
        r.capsuleId = id;
        _expect(Assert.WINDOWS_EXHAUSTED, r);
    }

    /// An unused window is forfeited, not banked.
    function test_10b_skippedWindowIsNotBanked() public {
        vm.warp(start + 3 days); // three days untouched
        SpendRequest memory r = _req();
        r.amountIn = 10e6; // two days' worth
        _expect(Assert.OVER_ACTION_CAP, r);

        r.amountIn = 5e6; // one day's worth still works
        vm.prank(agent);
        valet.chargeOnly(r);
        assertEq(valet.getCapsule(capsuleId).spentTotal, 5e6, "no catch-up");
    }

    // --- soft caps (3) ----------------------------------------------------

    function test_11_zeroAmount() public {
        SpendRequest memory r = _req();
        r.amountIn = 0;
        _expect(Assert.ZERO_AMOUNT, r);
    }

    function test_12_overActionCap() public {
        SpendRequest memory r = _req();
        r.amountIn = 5e6 + 1;
        _expect(Assert.OVER_ACTION_CAP, r);
    }

    function test_13_overWindowCap() public {
        vm.prank(agent);
        valet.chargeOnly(_req()); // uses the whole window
        SpendRequest memory r = _req();
        r.amountIn = 1e6;
        _expect(Assert.OVER_WINDOW_CAP, r);
    }

    // --- hard caps (2): the backstop ---------------------------------------

    /// @dev Unreachable while the soft caps hold, because mint forbids
    ///      perAction > hardCap. It only bites once an escalation lifts the soft
    ///      caps — which is exactly the point: this is what a permit cannot pass.
    function test_14_hardCapHoldsEvenWhenSoftCapsAreLifted() public {
        valet.liftSoftCap(capsuleId, 100e6, 100e6); // as an approved escalation would
        SpendRequest memory r = _req();
        r.amountIn = 20e6; // inside the lifted soft caps, over the hard cap of 10e6
        _expect(Assert.OVER_HARD_CAP, r);

        r.amountIn = 10e6; // at the hard cap exactly — allowed
        vm.prank(agent);
        valet.chargeOnly(r);
    }

    function test_15_overTotalCap() public {
        vm.prank(issuer);
        uint256 id = _mintWith(1 days, 30, start, start + 30 days);
        vm.prank(principal);
        valet.claim(id, agent);
        valet.liftSoftCap(id, 10e6, 10e6);

        // walk to the lifetime ceiling one window at a time
        SpendRequest memory r = _req();
        r.capsuleId = id;
        r.amountIn = 10e6;
        for (uint256 i = 0; i < 15; i++) {
            vm.warp(start + i * 1 days);
            vm.prank(agent);
            valet.chargeOnly(r);
        }
        assertEq(valet.getCapsule(id).spentTotal, 150e6, "at the lifetime cap");

        vm.warp(start + 16 days);
        r.amountIn = 1e6;
        _expect(Assert.OVER_TOTAL_CAP, r);
    }

    // --- scope (3) --------------------------------------------------------

    function test_16_targetNotAllowed() public {
        SpendRequest memory r = _req();
        r.target = makeAddr("some other dex");
        _expect(Assert.TARGET_NOT_ALLOWED, r);
    }

    function test_17_slippageTooWide() public {
        SpendRequest memory r = _req();
        r.minOut = r.quotedOut / 2; // a 50% floor against a 1% policy
        _expect(Assert.SLIPPAGE_TOO_WIDE, r);
    }

    function test_18_wrongRecipient() public {
        SpendRequest memory r = _req();
        r.recipient = agent; // the agent trying to pay itself
        _expect(Assert.WRONG_RECIPIENT, r);
    }

    // --- funds (1) --------------------------------------------------------

    /// Ordering: a cap refuses before the balance is even consulted, so an
    /// over-cap request is never reported as "not enough money".
    function test_19a_capsRefuseBeforeFundsAreConsulted() public {
        vm.prank(issuer);
        uint256 id = _mintWith(1 days, 30, start, start + 30 days);
        vm.prank(principal);
        valet.claim(id, agent);
        valet.liftSoftCap(id, 600e6, 600e6);

        SpendRequest memory r = _req();
        r.capsuleId = id;
        r.amountIn = 600e6; // over the hard cap, and also more than the vault holds
        _expect(Assert.OVER_HARD_CAP, r);
    }

    function test_19b_vaultUnderfunded() public {
        vm.startPrank(issuer);
        uint256 vid = valet.openVault(address(usdc));
        valet.fundVault(vid, 1e6); // barely funded
        address[] memory t = new address[](1);
        t[0] = venue;
        uint256 id = valet.mintCapsule(MintParams({
            vaultId: vid, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
                windows: 30, windowLength: 1 days, notBefore: start,
                expiresAt: start + 30 days, maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
        vm.stopPrank();
        vm.prank(principal);
        valet.claim(id, agent);

        SpendRequest memory r = _req();
        r.capsuleId = id;
        r.vaultId = vid;
        r.amountIn = 5e6; // inside every cap, but the vault has 1e6
        _expect(Assert.VAULT_UNDERFUNDED, r);
    }

    // --- helper -----------------------------------------------------------

    function _mintWith(uint64 windowLength, uint32 windows, uint64 notBefore, uint64 expiresAt)
        internal
        returns (uint256)
    {
        address[] memory t = new address[](1);
        t[0] = venue;
        return valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
                windows: windows, windowLength: windowLength,
                notBefore: notBefore, expiresAt: expiresAt, maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
    }
}
