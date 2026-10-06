// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {Assert, BeneficiaryMode, Bounds, MintParams, SpendRequest} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUSDC4 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract MockVenue2 {
    IERC20 public immutable quote;
    constructor(IERC20 q) { quote = q; }
    receive() external payable {}
    function buy(uint256 quoteSize) external {
        quote.transferFrom(msg.sender, address(this), quoteSize);
        (bool ok,) = msg.sender.call{value: quoteSize * 3e11}("");
        require(ok, "payout");
    }
}

contract ValetLifecycleTest is Test {
    Valet valet;
    MockUSDC4 usdc;
    MockVenue2 venue;

    address issuer = makeAddr("alice");
    address principal = makeAddr("bob");
    address agent = makeAddr("agent");

    uint256 vaultId;
    uint256 capsuleId;
    uint64 start;

    function setUp() public {
        vm.warp(1_000_000);
        start = uint64(block.timestamp);
        valet = new Valet();
        usdc = new MockUSDC4();
        venue = new MockVenue2(IERC20(address(usdc)));
        vm.deal(address(venue), 1_000 ether);
        usdc.mint(issuer, 10_000e6);

        vm.startPrank(issuer);
        vaultId = valet.openVault(address(usdc));
        usdc.approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 500e6);
        address[] memory t = new address[](1);
        t[0] = address(venue);
        capsuleId = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0),
            policyHash: keccak256("5 USDC of MON daily"),
            bounds: _base(), allowedTargets: t
        }));
        vm.stopPrank();
        vm.prank(principal);
        valet.claim(capsuleId, agent);
    }

    function _base() internal view returns (Bounds memory) {
        return Bounds({
            perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
            windows: 30, windowLength: 1 days,
            notBefore: start, expiresAt: start + 30 days, maxSlippageBps: 100
        });
    }

    function _req(uint256 amountIn) internal view returns (SpendRequest memory) {
        return SpendRequest({
            capsuleId: capsuleId, vaultId: vaultId, amountIn: amountIn,
            quotedOut: amountIn * 3e11, minOut: amountIn * 3e11 * 99 / 100,
            target: address(venue), recipient: principal
        });
    }

    function _data(uint256 a) internal pure returns (bytes memory) {
        return abi.encodeCall(MockVenue2.buy, (a));
    }

    // --- tightening -------------------------------------------------------

    function test_tighteningNarrowsALiveCapsule() public {
        Bounds memory b = _base();
        b.perAction = 2e6;
        b.perWindow = 2e6;
        b.maxSlippageBps = 50;
        vm.prank(issuer);
        valet.tighten(capsuleId, b);

        assertEq(valet.getCapsule(capsuleId).bounds.perAction, 2e6);

        // the old size allowance is gone immediately
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.OVER_ACTION_CAP));
        valet.execute(_req(5e6), _data(5e6));

        // and so is the old slippage allowance: a 1% floor no longer clears a
        // 0.5% policy, even at a size the capsule still permits
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.SLIPPAGE_TOO_WIDE));
        valet.execute(_req(2e6), _data(2e6));

        // inside both new bounds, it works
        SpendRequest memory r = _req(2e6);
        r.minOut = r.quotedOut * 9_950 / 10_000; // 0.5%
        vm.prank(agent);
        valet.execute(r, _data(2e6));
    }

    function test_cannotLoosenAnyBound() public {
        string[7] memory names = ["perAction", "perWindow", "hardCap", "totalCap", "windows", "expiresAt", "maxSlippageBps"];
        for (uint256 i = 0; i < names.length; i++) {
            Bounds memory b = _base();
            if (i == 0) b.perAction = 6e6;
            if (i == 1) b.perWindow = 6e6;
            if (i == 2) b.hardCap = 11e6;
            if (i == 3) b.totalCap = 151e6;
            if (i == 4) b.windows = 31;
            if (i == 5) b.expiresAt = start + 31 days;
            if (i == 6) b.maxSlippageBps = 101;
            vm.prank(issuer);
            vm.expectRevert(abi.encodeWithSelector(Valet.NotATightening.selector, names[i]));
            valet.tighten(capsuleId, b);
        }
    }

    /// Moving either would re-index every window, so spending already recorded
    /// could land in a different window and today could be made to look unspent.
    function test_windowGeometryIsImmutable() public {
        Bounds memory b = _base();
        b.notBefore = start + 1;
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.NotATightening.selector, "notBefore is immutable"));
        valet.tighten(capsuleId, b);

        b = _base();
        b.windowLength = 12 hours;
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.NotATightening.selector, "windowLength is immutable"));
        valet.tighten(capsuleId, b);
    }

    /// A tightening still has to leave a coherent set of bounds.
    function test_tighteningCannotLeaveBoundsContradictory() public {
        Bounds memory b = _base();
        b.hardCap = 3e6; // below perAction of 5e6
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.BadBounds.selector, "perAction over hardCap"));
        valet.tighten(capsuleId, b);
    }

    function test_onlyIssuerTightens() public {
        Bounds memory b = _base();
        b.perAction = 1e6;
        vm.prank(principal);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.tighten(capsuleId, b);
        vm.prank(agent);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.tighten(capsuleId, b);
    }

    /// Tightening totalCap under what is already spent stops further spending
    /// without rewriting history.
    function test_tighteningBelowSpentStopsSpending() public {
        vm.prank(agent);
        valet.execute(_req(5e6), _data(5e6));

        Bounds memory b = _base();
        b.totalCap = 5e6;
        b.hardCap = 5e6; // must come down too, or the pair contradicts
        vm.prank(issuer);
        valet.tighten(capsuleId, b);

        vm.warp(start + 1 days);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.OVER_TOTAL_CAP));
        valet.execute(_req(1e6), _data(1e6));

        assertEq(valet.getCapsule(capsuleId).spentTotal, 5e6, "history intact");
    }

    // --- revoke and sweep --------------------------------------------------

    function test_revokeAndSweepEndsEverythingAtOnce() public {
        vm.prank(agent);
        valet.execute(_req(5e6), _data(5e6)); // 495e6 left

        uint256 before = usdc.balanceOf(issuer);
        vm.prank(issuer);
        uint256 swept = valet.revokeVaultAndSweep(vaultId);

        assertEq(swept, 495e6, "the remainder came back");
        assertEq(usdc.balanceOf(issuer) - before, 495e6);
        assertEq(valet.getVault(vaultId).balance, 0);
        assertTrue(valet.getVault(vaultId).revoked);

        // and every capsule on that vault is dead
        vm.warp(start + 1 days);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.VAULT_REVOKED));
        valet.execute(_req(5e6), _data(5e6));
    }

    function test_sweepKillsEveryCapsuleOnTheVault() public {
        vm.startPrank(issuer);
        address[] memory t = new address[](1);
        t[0] = address(venue);
        uint256 second = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: _base(), allowedTargets: t
        }));
        valet.revokeVaultAndSweep(vaultId);
        vm.stopPrank();

        vm.prank(principal);
        valet.claim(second, agent);
        SpendRequest memory r = _req(5e6);
        r.capsuleId = second;
        assertEq(uint256(valet.preflight(r, agent)), uint256(Assert.VAULT_REVOKED));
    }

    function test_onlyIssuerSweepsTheVault() public {
        vm.prank(principal);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.revokeVaultAndSweep(vaultId);
    }

    /// Proceeds a VAULT-mode capsule already earned are still collectable after
    /// the vault is revoked — revoking stops future spending, it does not
    /// confiscate what was already settled.
    function test_proceedsSurviveRevocation() public {
        vm.startPrank(issuer);
        address[] memory t = new address[](1);
        t[0] = address(venue);
        uint256 id = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.VAULT,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: _base(), allowedTargets: t
        }));
        vm.stopPrank();
        vm.prank(principal);
        valet.claim(id, agent);

        SpendRequest memory r = _req(5e6);
        r.capsuleId = id;
        r.recipient = address(valet);
        vm.prank(agent);
        uint256 earned = valet.execute(r, _data(5e6));

        vm.prank(issuer);
        valet.revokeVaultAndSweep(vaultId);

        uint256 before = issuer.balance;
        vm.prank(issuer);
        valet.sweepProceeds(id);
        assertEq(issuer.balance - before, earned, "already-settled proceeds still collectable");
    }

    // --- the recipient's side ----------------------------------------------

    /// The recipient hands it back; they cannot claw funds that were never theirs.
    function test_surrenderIsNotRevocation() public {
        vm.prank(principal);
        valet.surrender(capsuleId);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.SURRENDERED));
        valet.execute(_req(5e6), _data(5e6));

        // the money is still the issuer's, held in the vault
        assertEq(valet.getVault(vaultId).balance, 500e6);
        assertEq(usdc.balanceOf(principal), 0, "the recipient took nothing");
    }

    function test_pauseIsReversibleButSurrenderIsNot() public {
        vm.prank(principal);
        valet.setPausedByPrincipal(capsuleId, true);
        vm.prank(principal);
        valet.setPausedByPrincipal(capsuleId, false);
        vm.prank(agent);
        valet.execute(_req(5e6), _data(5e6)); // back in business

        vm.prank(principal);
        valet.surrender(capsuleId);
        vm.warp(start + 1 days);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.SURRENDERED));
        valet.execute(_req(5e6), _data(5e6)); // and there is no way back
    }
}
