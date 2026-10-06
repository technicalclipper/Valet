// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {Assert, BeneficiaryMode, Bounds, MintParams, SpendRequest} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUSDC5 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract MockVenue3 {
    IERC20 public immutable quote;
    constructor(IERC20 q) { quote = q; }
    receive() external payable {}
    function buy(uint256 quoteSize) external {
        quote.transferFrom(msg.sender, address(this), quoteSize);
        (bool ok,) = msg.sender.call{value: quoteSize * 3e11}("");
        require(ok, "payout");
    }
}

contract ValetEscalationTest is Test {
    Valet valet;
    MockUSDC5 usdc;
    MockVenue3 venue;

    uint256 issuerPk = 0xA11CE;
    address issuer;
    address principal = makeAddr("bob");
    address agent = makeAddr("agent");
    address relayer = makeAddr("relayer");

    uint256 vaultId;
    uint256 capsuleId;
    uint64 start;

    function setUp() public {
        vm.warp(1_000_000);
        start = uint64(block.timestamp);
        issuer = vm.addr(issuerPk);

        valet = new Valet();
        usdc = new MockUSDC5();
        venue = new MockVenue3(IERC20(address(usdc)));
        vm.deal(address(venue), 10_000 ether);
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
            policyHash: keccak256("5 USDC of MON daily, 30 days, 1% slippage"),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
                windows: 30, windowLength: 1 days,
                notBefore: start, expiresAt: start + 30 days, maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
        vm.stopPrank();
        vm.prank(principal);
        valet.claim(capsuleId, agent);
    }

    function _sign(uint256 pk, uint256 amount, uint256 nonce, uint64 deadline)
        internal view returns (bytes memory)
    {
        bytes32 digest = valet.escalationDigest(capsuleId, amount, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _req(uint256 amountIn) internal view returns (SpendRequest memory) {
        return SpendRequest({
            capsuleId: capsuleId, vaultId: vaultId, amountIn: amountIn,
            quotedOut: amountIn * 3e11, minOut: amountIn * 3e11 * 99 / 100,
            target: address(venue), recipient: principal
        });
    }

    function _data(uint256 a) internal pure returns (bytes memory) {
        return abi.encodeCall(MockVenue3.buy, (a));
    }

    // --- the full round trip ----------------------------------------------

    function test_agentAsksIssuerSignsSpendGoesThrough() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "unusually good price today");
        assertEq(nonce, 0);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(issuerPk, 8e6, nonce, deadline);

        // a relayer submits it; the issuer never sent a transaction and needs no gas
        vm.prank(relayer);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, sig);
        assertTrue(valet.getEscalation(capsuleId, nonce).approved);

        // 8 USDC is over the 5 USDC per-action cap, and now permitted
        vm.prank(agent);
        uint256 received = valet.executeElevated(_req(8e6), _data(8e6), nonce);

        assertEq(principal.balance, received, "bob paid");
        assertEq(valet.getCapsule(capsuleId).spentTotal, 8e6);
        assertEq(valet.getVault(vaultId).balance, 492e6);
    }

    /// The issuer signs; nothing about who submits it confers authority.
    function test_issuerNeverNeedsGas() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(issuerPk, 8e6, nonce, deadline);

        vm.deal(issuer, 0);
        vm.prank(relayer);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, sig);
        assertTrue(valet.getEscalation(capsuleId, nonce).approved);
        assertEq(issuer.balance, 0, "the issuer spent nothing");
    }

    // --- an agent can ask; it can never approve ---------------------------

    function test_agentCannotSignItsOwnApproval() public {
        uint256 agentPk = 0xBEEF;
        address agentKey = vm.addr(agentPk);
        // a fresh capsule whose holder is a key we control
        vm.startPrank(issuer);
        address[] memory t = new address[](1);
        t[0] = address(venue);
        uint256 id = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: principal, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: valet.getCapsule(capsuleId).bounds, allowedTargets: t
        }));
        vm.stopPrank();
        vm.prank(principal);
        valet.claim(id, agentKey);

        vm.prank(agentKey);
        uint256 nonce = valet.requestEscalation(id, 8e6, "please");

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest = valet.escalationDigest(id, 8e6, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);

        vm.prank(agentKey);
        vm.expectRevert(Valet.BadSignature.selector);
        valet.approveEscalation(id, 8e6, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function test_strangerSignatureRejected() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(0xDEAD, 8e6, nonce, deadline); // not the issuer

        vm.expectRevert(Valet.BadSignature.selector);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, sig);
    }

    function test_onlyTheHolderMayAsk() public {
        vm.prank(principal);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.NOT_HOLDER));
        valet.requestEscalation(capsuleId, 8e6, "");
    }

    // --- THE backstop -----------------------------------------------------

    /// Nothing lifts the hard cap. Not a permit, not the issuer in person.
    /// The issuer here asks for 100 USDC, signs for it themselves, and the
    /// chain still refuses, because the ceiling was set once at mint.
    function test_hardCapRefusesAnEscalationTheIssuerSigned() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 100e6, "let me go big");

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(issuerPk, 100e6, nonce, deadline);
        valet.approveEscalation(capsuleId, 100e6, nonce, deadline, sig);

        // the issuer genuinely approved 100 USDC
        assertEq(valet.getEscalation(capsuleId, nonce).approvedAmount, 100e6);

        // and the hard cap of 10 USDC refuses it anyway
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.OVER_HARD_CAP));
        valet.executeElevated(_req(100e6), _data(100e6), nonce);

        assertEq(principal.balance, 0, "nothing moved");
        assertEq(valet.getVault(vaultId).balance, 500e6, "vault untouched");

        // exactly at the hard cap, the same permit works
        vm.prank(agent);
        valet.executeElevated(_req(10e6), _data(10e6), nonce);
        assertEq(valet.getCapsule(capsuleId).spentTotal, 10e6);
    }

    /// An escalation lifts the soft caps and only those: the term, the pauses
    /// and the scope are all untouched.
    function test_escalationDoesNotLiftAnythingElse() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 10 days);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, _sign(issuerPk, 8e6, nonce, deadline));

        // paused
        vm.prank(principal);
        valet.setPausedByPrincipal(capsuleId, true);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.PAUSED));
        valet.executeElevated(_req(8e6), _data(8e6), nonce);
        vm.prank(principal);
        valet.setPausedByPrincipal(capsuleId, false);

        // out of scope
        SpendRequest memory r = _req(8e6);
        r.target = makeAddr("some other dex");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.TARGET_NOT_ALLOWED));
        valet.executeElevated(r, _data(8e6), nonce);

        // wrong recipient
        r = _req(8e6);
        r.recipient = agent;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.WRONG_RECIPIENT));
        valet.executeElevated(r, _data(8e6), nonce);

        // revoked
        vm.prank(issuer);
        valet.revoke(capsuleId);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.Refused.selector, Assert.CAPSULE_REVOKED));
        valet.executeElevated(_req(8e6), _data(8e6), nonce);
    }

    // --- one shot ---------------------------------------------------------

    function test_permitIsConsumedOnce() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, _sign(issuerPk, 8e6, nonce, deadline));

        vm.prank(agent);
        valet.executeElevated(_req(8e6), _data(8e6), nonce);

        vm.prank(agent);
        vm.expectRevert(Valet.AlreadyConsumed.selector);
        valet.executeElevated(_req(8e6), _data(8e6), nonce);
    }

    /// A yes to 8 cannot be stretched into a yes to 10.
    function test_cannotSpendMoreThanWasApproved() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, _sign(issuerPk, 8e6, nonce, deadline));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Valet.OverApprovedAmount.selector, 10e6, 8e6));
        valet.executeElevated(_req(10e6), _data(10e6), nonce);
    }

    /// A signature for one request cannot be moved onto another.
    function test_signatureIsBoundToItsNonce() public {
        vm.startPrank(agent);
        uint256 first = valet.requestEscalation(capsuleId, 8e6, "one");
        uint256 second = valet.requestEscalation(capsuleId, 8e6, "two");
        vm.stopPrank();
        assertEq(second, first + 1);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sigForFirst = _sign(issuerPk, 8e6, first, deadline);

        vm.expectRevert(Valet.BadSignature.selector);
        valet.approveEscalation(capsuleId, 8e6, second, deadline, sigForFirst);
    }

    function test_approvalCannotBeReused() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(issuerPk, 8e6, nonce, deadline);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, sig);
        vm.expectRevert(Valet.AlreadyApproved.selector);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, sig);
    }

    function test_unrequestedEscalationCannotBeApproved() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(issuerPk, 8e6, 7, deadline);
        vm.expectRevert(Valet.NotRequested.selector);
        valet.approveEscalation(capsuleId, 8e6, 7, deadline, sig);
    }

    // --- deadlines --------------------------------------------------------

    function test_approvalExpires() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, _sign(issuerPk, 8e6, nonce, deadline));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(agent);
        vm.expectRevert(Valet.PastDeadline.selector);
        valet.executeElevated(_req(8e6), _data(8e6), nonce);
    }

    function test_cannotApproveAfterDeadline() public {
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        uint64 deadline = uint64(block.timestamp - 1);
        bytes memory sig = _sign(issuerPk, 8e6, nonce, deadline);
        vm.expectRevert(Valet.PastDeadline.selector);
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, sig);
    }

    function test_pointlessEscalationRefused() public {
        vm.prank(agent);
        vm.expectRevert(Valet.PointlessEscalation.selector);
        valet.requestEscalation(capsuleId, 5e6, "already allowed");
    }

    // --- what the console shows -------------------------------------------

    function test_preflightShowsBothJudgements() public view {
        SpendRequest memory r = _req(8e6);
        assertEq(uint256(valet.preflight(r, agent)), uint256(Assert.OVER_ACTION_CAP));
        assertEq(uint256(valet.preflightElevated(r, agent)), uint256(Assert.NONE));
    }

    function test_domainSeparatorIsStable() public view {
        assertEq(
            valet.ESCALATION_TYPEHASH(),
            keccak256("Escalation(uint256 capsuleId,uint256 amount,uint256 nonce,uint64 deadline)")
        );
    }
}
