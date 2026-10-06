// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {Assert, BeneficiaryMode, Bounds, MintParams, SpendRequest} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUSDC3 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @dev Stands in for Kuru: takes USDC, pays native. `rate` is MON per USDC.
contract MockVenue {
    IERC20 public immutable quote;
    uint256 public rate;
    bool public skim;      // try to keep the proceeds
    bool public payNothing;

    constructor(IERC20 _quote, uint256 _rate) { quote = _quote; rate = _rate; }
    receive() external payable {}
    function setRate(uint256 r) external { rate = r; }
    function setSkim(bool s) external { skim = s; }
    function setPayNothing(bool p) external { payNothing = p; }

    function buy(uint256 quoteSize) external {
        quote.transferFrom(msg.sender, address(this), quoteSize);
        if (payNothing) return;
        uint256 out = quoteSize * rate;
        if (skim) out = out / 2;
        (bool ok,) = msg.sender.call{value: out}("");
        require(ok, "venue payout failed");
    }

    /// a venue that reports more than it pays
    function buyAndLie(uint256 quoteSize) external returns (uint256) {
        quote.transferFrom(msg.sender, address(this), quoteSize);
        (bool ok,) = msg.sender.call{value: quoteSize * rate / 10}("");
        require(ok, "x");
        return quoteSize * rate; // claims ten times what it sent
    }
}

contract ValetExecuteTest is Test {
    Valet valet;
    MockUSDC3 usdc;
    MockVenue venue;

    address issuer = makeAddr("alice");
    address principal = makeAddr("bob");
    address agent = makeAddr("agent");

    uint256 vaultId;
    uint256 capsuleId;
    uint64 start;
    uint256 constant RATE = 3e11; // 5e6 USDC -> 1.5e18 native

    function setUp() public {
        vm.warp(1_000_000);
        start = uint64(block.timestamp);

        valet = new Valet();
        usdc = new MockUSDC3();
        venue = new MockVenue(IERC20(address(usdc)), RATE);
        vm.deal(address(venue), 1_000 ether);
        usdc.mint(issuer, 10_000e6);

        vm.startPrank(issuer);
        vaultId = valet.openVault(address(usdc));
        usdc.approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 500e6);
        capsuleId = _mint(BeneficiaryMode.PRINCIPAL, address(0));
        vm.stopPrank();

        vm.prank(principal);
        valet.claim(capsuleId, agent);
    }

    function _mint(BeneficiaryMode mode, address fixedBen) internal returns (uint256) {
        address[] memory t = new address[](1);
        t[0] = address(venue);
        return valet.mintCapsule(MintParams({
            vaultId: vaultId,
            principal: principal,
            mode: mode,
            fixedBeneficiary: fixedBen,
            assetOut: address(0),
            policyHash: keccak256("5 USDC of MON daily, 30 days, 1% slippage"),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
                windows: 30, windowLength: 1 days,
                notBefore: start, expiresAt: start + 30 days, maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
    }

    function _req(uint256 id, address recipient) internal view returns (SpendRequest memory) {
        return SpendRequest({
            capsuleId: id,
            vaultId: vaultId,
            amountIn: 5e6,
            quotedOut: 5e6 * RATE,
            minOut: 5e6 * RATE * 99 / 100,
            target: address(venue),
            recipient: recipient
        });
    }

    function _data(uint256 amountIn) internal pure returns (bytes memory) {
        return abi.encodeCall(MockVenue.buy, (amountIn));
    }

    // --- the happy path ---------------------------------------------------

    function test_proceedsReachTheBeneficiaryInOneTransaction() public {
        vm.prank(agent);
        uint256 received = valet.execute(_req(capsuleId, principal), _data(5e6));

        assertEq(received, 5e6 * RATE, "measured proceeds");
        assertEq(principal.balance, received, "bob was paid");
        assertEq(address(valet).balance, 0, "valet keeps nothing");
        assertEq(valet.getVault(vaultId).balance, 495e6, "vault debited");
        assertEq(agent.balance, 0, "the agent got nothing");
    }

    /// The approval is exact and does not outlive the call.
    function test_noStandingApprovalSurvives() public {
        vm.prank(agent);
        valet.execute(_req(capsuleId, principal), _data(5e6));
        assertEq(usdc.allowance(address(valet), address(venue)), 0, "approval zeroed");
    }

    // --- custody ----------------------------------------------------------

    /// The agent never holds the asset, so there is no point at which to skim.
    function test_agentCannotRedirectProceeds() public {
        SpendRequest memory r = _req(capsuleId, agent); // agent names itself
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.WRONG_RECIPIENT));
        valet.execute(r, _data(5e6));
        assertEq(agent.balance, 0);
    }

    /// A venue that underpays is caught by the floor, and nothing is kept.
    function test_shortfallRevertsAndNothingMoves() public {
        venue.setSkim(true); // pays half
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(Valet.BelowFloor.selector, 5e6 * RATE / 2, 5e6 * RATE * 99 / 100)
        );
        valet.execute(_req(capsuleId, principal), _data(5e6));

        assertEq(principal.balance, 0, "nothing paid");
        assertEq(valet.getVault(vaultId).balance, 500e6, "debit rolled back");
        assertEq(valet.getCapsule(capsuleId).spentTotal, 0, "spend rolled back");
    }

    /// Proceeds are measured, not taken on the venue's word.
    function test_venueCannotLieAboutWhatItPaid() public {
        bytes memory lying = abi.encodeCall(MockVenue.buyAndLie, (5e6));
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(Valet.BelowFloor.selector, 5e6 * RATE / 10, 5e6 * RATE * 99 / 100)
        );
        valet.execute(_req(capsuleId, principal), lying);
    }

    function test_venueThatPaysNothingReverts() public {
        venue.setPayNothing(true);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.BelowFloor.selector, 0, 5e6 * RATE * 99 / 100));
        valet.execute(_req(capsuleId, principal), _data(5e6));
    }

    function test_venueRevertBubbles() public {
        vm.deal(address(venue), 0); // cannot pay out
        vm.prank(agent);
        vm.expectRevert();
        valet.execute(_req(capsuleId, principal), _data(5e6));
    }

    // --- beneficiary modes ------------------------------------------------

    function test_vaultModeBooksProceedsForTheIssuer() public {
        vm.prank(issuer);
        uint256 id = _mint(BeneficiaryMode.VAULT, address(0));
        vm.prank(principal);
        valet.claim(id, agent);

        vm.prank(agent);
        uint256 received = valet.execute(_req(id, address(valet)), _data(5e6));

        assertEq(valet.proceedsOf(id), received, "booked, not loose");
        assertEq(principal.balance, 0, "the recipient is paid nothing in VAULT mode");

        uint256 beforeSweep = issuer.balance;
        vm.prank(issuer);
        valet.sweepProceeds(id);
        assertEq(issuer.balance - beforeSweep, received, "issuer collected");
        assertEq(valet.proceedsOf(id), 0);
    }

    function test_onlyIssuerSweeps() public {
        vm.prank(issuer);
        uint256 id = _mint(BeneficiaryMode.VAULT, address(0));
        vm.prank(principal);
        valet.claim(id, agent);
        vm.prank(agent);
        valet.execute(_req(id, address(valet)), _data(5e6));

        vm.prank(agent);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.sweepProceeds(id);
    }

    function test_fixedModePaysTheNamedAddress() public {
        address carol = makeAddr("carol");
        vm.prank(issuer);
        uint256 id = _mint(BeneficiaryMode.FIXED, carol);
        vm.prank(principal);
        valet.claim(id, agent);

        vm.prank(agent);
        uint256 received = valet.execute(_req(id, carol), _data(5e6));
        assertEq(carol.balance, received);
    }

    // --- accounting over time ----------------------------------------------

    function test_dailyRhythmAcrossWindows() public {
        uint256 total;
        for (uint256 d = 0; d < 5; d++) {
            vm.warp(start + d * 1 days);
            vm.prank(agent);
            total += valet.execute(_req(capsuleId, principal), _data(5e6));
        }
        assertEq(valet.getCapsule(capsuleId).spentTotal, 25e6, "five days spent");
        assertEq(principal.balance, total, "five payouts received");

        // a sixth spend inside the fifth day is refused
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.OVER_WINDOW_CAP));
        valet.execute(_req(capsuleId, principal), _data(5e6));
    }

    function test_mintRejectsSameAssetInAndOut() public {
        address[] memory t = new address[](1);
        t[0] = address(venue);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.BadBounds.selector, "assetOut equals assetIn"));
        valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(usdc), policyHash: bytes32(0),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
                windows: 30, windowLength: 1 days, notBefore: start,
                expiresAt: start + 30 days, maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
    }
}
