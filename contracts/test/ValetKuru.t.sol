// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {Assert, BeneficiaryMode, Bounds, MintParams, SpendRequest} from "../src/ValetTypes.sol";
import {KuruAdapter} from "../src/adapters/KuruAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev The real thing: Valet spending real USDC on the real Kuru MON-USDC book.
///      Needs --fork-url https://rpc.monad.xyz (vm.createSelectFork cannot fork
///      Monad on forge 1.8.1, and Kuru is not deployed on testnet).
contract ValetKuruTest is Test {
    address constant KURU_MON_USDC = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    Valet valet;
    address issuer = makeAddr("alice");
    address principal = makeAddr("bob");
    address agent = makeAddr("agent");

    uint256 vaultId;
    uint256 capsuleId;
    uint64 start;

    function setUp() public {
        // These suites read the real Kuru book, so they need
        // --fork-url https://rpc.monad.xyz. Skip rather than fail without it, so
        // a plain `forge test` still runs everything that does not need a fork.
        if (block.chainid != 143) {
            vm.skip(true);
            return;
        }
        start = uint64(block.timestamp);
        valet = new Valet();
        deal(USDC, issuer, 1_000e6);

        vm.startPrank(issuer);
        vaultId = valet.openVault(USDC);
        IERC20(USDC).approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 100e6);

        address[] memory targets = new address[](1);
        targets[0] = KURU_MON_USDC;
        capsuleId = valet.mintCapsule(MintParams({
            vaultId: vaultId,
            principal: principal,
            mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0),
            assetOut: address(0), // Kuru pays native MON on a buy
            policyHash: keccak256("buy 5 USDC of MON daily for 30 days, max 1% slippage, MON to bob@gmail.com"),
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

    /// Discover what the live book actually pays, without leaving a trace.
    function _probeFill(uint96 amountIn) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        SpendRequest memory r = SpendRequest({
            capsuleId: capsuleId, vaultId: vaultId, amountIn: amountIn,
            // a self-consistent quote/floor pair, so the probe is refused by
            // nothing and measures only what the book pays
            quotedOut: 1, minOut: 1, target: KURU_MON_USDC, recipient: principal
        });
        vm.prank(agent);
        out = valet.execute(r, KuruAdapter.marketBuy(amountIn, 0));
        vm.revertToState(snap);
    }

    function _req(uint96 amountIn, uint256 quotedOut) internal view returns (SpendRequest memory) {
        return SpendRequest({
            capsuleId: capsuleId,
            vaultId: vaultId,
            amountIn: amountIn,
            quotedOut: quotedOut,
            minOut: quotedOut * 99 / 100, // the 1% the policy allows
            target: KURU_MON_USDC,
            recipient: principal
        });
    }

    // --- beat one: it works -----------------------------------------------

    function test_dailyBuyFillsOnKuruAndPaysBob() public {
        uint256 expected = _probeFill(5e6);
        console.log("live fill for 5 USDC (wei MON):", expected);

        vm.prank(agent);
        uint256 received = valet.execute(_req(5e6, expected), KuruAdapter.marketBuy(5e6, expected * 99 / 100));

        console.log("received                       :", received);
        console.log("bob MON balance                :", principal.balance);

        assertGt(received, 0, "a real fill");
        assertEq(principal.balance, received, "every unit reached bob");
        assertEq(address(valet).balance, 0, "valet kept nothing");
        assertEq(agent.balance, 0, "the agent got nothing");
        assertEq(valet.getVault(vaultId).balance, 95e6, "vault debited by 5 USDC");
        assertEq(IERC20(USDC).allowance(address(valet), KURU_MON_USDC), 0, "no standing approval");
    }

    // --- beat two: the refusal --------------------------------------------

    /// The beat the demo turns on. The agent asks for four times its cap
    /// against a live, liquid book — and the chain refuses by name.
    function test_overCapIsRefusedByTheContractNotTheVenue() public {
        uint256 expected = _probeFill(5e6);
        SpendRequest memory r = _req(20e6, expected * 4);

        // the console shows which check refuses, before anything is attempted
        assertEq(uint256(valet.preflight(r, agent)), uint256(Assert.OVER_ACTION_CAP));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.OVER_ACTION_CAP));
        valet.execute(r, KuruAdapter.marketBuy(20e6, 0));

        assertEq(principal.balance, 0, "nothing moved");
        assertEq(valet.getVault(vaultId).balance, 100e6, "vault untouched");
        assertEq(valet.getCapsule(capsuleId).spentTotal, 0, "no spend recorded");
    }

    /// Lifting the soft caps does not open the hard one, even on a real venue.
    function test_hardCapStillBindsAgainstARealBook() public view {
        SpendRequest memory r = _req(20e6, 1);
        r.minOut = 0;
        // OVER_ACTION_CAP fires first while soft caps hold; the point is that
        // raising perAction to 20 USDC would still leave OVER_HARD_CAP at 10.
        assertEq(uint256(valet.preflight(r, agent)), uint256(Assert.OVER_ACTION_CAP));
        assertEq(valet.getCapsule(capsuleId).bounds.hardCap, 10e6, "the ceiling nothing lifts");
    }

    // --- scope, against the real venue ------------------------------------

    function test_anotherRealVenueIsRefused() public {
        uint256 expected = _probeFill(5e6);
        SpendRequest memory r = _req(5e6, expected);
        r.target = 0xb3e6778480b2E488385E8205eA05E20060B813cb; // Kuru's own aggregator, not allowlisted

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.TARGET_NOT_ALLOWED));
        valet.execute(r, KuruAdapter.marketBuy(5e6, 0));
    }

    /// A floor the live book cannot reach stops the trade and keeps the money.
    function test_unreachableFloorKeepsTheMoney() public {
        uint256 expected = _probeFill(5e6);
        SpendRequest memory r = _req(5e6, expected);
        r.minOut = expected * 2; // twice what the book pays

        vm.prank(agent);
        vm.expectRevert(); // Kuru's own FOK refuses before our floor is reached
        valet.execute(r, KuruAdapter.marketBuy(5e6, expected * 2));

        assertEq(valet.getVault(vaultId).balance, 100e6, "vault untouched");
        assertEq(principal.balance, 0);
    }

    // --- the rhythm the policy describes -----------------------------------

    function test_thirtyDaysOfDailyBuys() public {
        uint256 paid;
        for (uint256 d = 0; d < 5; d++) {
            vm.warp(start + d * 1 days);
            uint256 expected = _probeFill(5e6);
            vm.prank(agent);
            paid += valet.execute(_req(5e6, expected), KuruAdapter.marketBuy(5e6, expected * 99 / 100));
        }
        assertEq(valet.getCapsule(capsuleId).spentTotal, 25e6, "five days of 5 USDC");
        assertEq(principal.balance, paid, "bob holds every fill");
        assertEq(valet.getVault(vaultId).balance, 75e6);

        (, uint256 windowLeft, uint256 totalLeft,) = valet.headroom(capsuleId);
        assertEq(windowLeft, 0, "today is spent");
        assertEq(totalLeft, 125e6, "lifetime headroom left");
    }
}
