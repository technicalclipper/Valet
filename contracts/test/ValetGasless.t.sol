// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {Assert, BeneficiaryMode, Bounds, MintParams, SpendRequest} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC6 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// Spike 0.2 — can someone who has never held a token use a capsule?
///
/// The question behind the "no wallet, no seed phrase, no gas" claim. The answer
/// has to hold without a paymaster, because a gas-credit balance is one more
/// thing that can be empty at the wrong moment.
contract ValetGaslessTest is Test {
    Valet valet;
    MockUSDC6 usdc;

    uint256 bobPk = 0xB0B;
    address bob;            // the recipient: zero balance throughout
    address issuer = makeAddr("alice");
    address agent = makeAddr("agent");
    address relayer = makeAddr("relayer");

    uint256 vaultId;
    uint256 capsuleId;
    uint64 start;

    function setUp() public {
        vm.warp(1_000_000);
        start = uint64(block.timestamp);
        bob = vm.addr(bobPk);

        valet = new Valet();
        usdc = new MockUSDC6();
        usdc.mint(issuer, 1_000e6);

        vm.startPrank(issuer);
        vaultId = valet.openVault(address(usdc));
        usdc.approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 100e6);
        address[] memory t = new address[](1);
        t[0] = makeAddr("venue");
        capsuleId = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: bob, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0),
            policyHash: keccak256("5 USDC of MON daily"),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6,
                windows: 30, windowLength: 1 days,
                notBefore: start, expiresAt: start + 30 days, maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
        vm.stopPrank();

        // the premise of the whole test
        vm.deal(bob, 0);
    }

    function _sign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // --- claiming ----------------------------------------------------------

    function test_aRecipientWithNoGasCanClaim() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = valet.principalNonce(capsuleId);
        bytes memory sig = _sign(valet.claimDigest(capsuleId, agent, nonce, deadline));

        vm.prank(relayer);
        valet.claimBySignature(capsuleId, agent, deadline, sig);

        assertEq(valet.getCapsule(capsuleId).holder, agent);
        assertEq(bob.balance, 0, "bob never needed a token");
    }

    function test_claimBySignatureIsStillSingleUse() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 n = valet.principalNonce(capsuleId);
        valet.claimBySignature(capsuleId, agent, deadline, _sign(valet.claimDigest(capsuleId, agent, n, deadline)));

        uint256 n2 = valet.principalNonce(capsuleId);
        bytes memory sig2 = _sign(valet.claimDigest(capsuleId, makeAddr("other"), n2, deadline));
        vm.expectRevert(Valet.AlreadyClaimed.selector);
        valet.claimBySignature(capsuleId, makeAddr("other"), deadline, sig2);
    }

    function test_aStrangersSignatureCannotClaim() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = valet.principalNonce(capsuleId);
        bytes32 digest = valet.claimDigest(capsuleId, agent, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, digest);
        vm.expectRevert(Valet.BadSignature.selector);
        valet.claimBySignature(capsuleId, agent, deadline, abi.encodePacked(r, s, v));
    }

    /// A signature is bound to the holder it names — a relayer cannot swap in
    /// an agent of its own choosing.
    function test_relayerCannotSubstituteADifferentHolder() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = valet.principalNonce(capsuleId);
        bytes memory sig = _sign(valet.claimDigest(capsuleId, agent, nonce, deadline));

        vm.prank(relayer);
        vm.expectRevert(Valet.BadSignature.selector);
        valet.claimBySignature(capsuleId, relayer, deadline, sig);
    }

    function test_expiredClaimSignatureIsRefused() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = valet.principalNonce(capsuleId);
        bytes memory sig = _sign(valet.claimDigest(capsuleId, agent, nonce, deadline));
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(Valet.PastDeadline.selector);
        valet.claimBySignature(capsuleId, agent, deadline, sig);
    }

    // --- pausing and handing back ------------------------------------------

    function test_aRecipientWithNoGasCanPauseAndResume() public {
        _claim();
        uint64 deadline = uint64(block.timestamp + 1 hours);

        uint256 n = valet.principalNonce(capsuleId);
        vm.prank(relayer);
        valet.principalActionBySignature(
            capsuleId, valet.ACTION_PAUSE(), true, deadline,
            _sign(valet.principalActionDigest(capsuleId, valet.ACTION_PAUSE(), true, n, deadline))
        );
        assertTrue(valet.getCapsule(capsuleId).pausedByPrincipal);

        uint256 n2 = valet.principalNonce(capsuleId);
        vm.prank(relayer);
        valet.principalActionBySignature(
            capsuleId, valet.ACTION_PAUSE(), false, deadline,
            _sign(valet.principalActionDigest(capsuleId, valet.ACTION_PAUSE(), false, n2, deadline))
        );
        assertFalse(valet.getCapsule(capsuleId).pausedByPrincipal);
        assertEq(bob.balance, 0);
    }

    function test_aRecipientWithNoGasCanHandItBack() public {
        _claim();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 n = valet.principalNonce(capsuleId);

        vm.prank(relayer);
        valet.principalActionBySignature(
            capsuleId, valet.ACTION_SURRENDER(), true, deadline,
            _sign(valet.principalActionDigest(capsuleId, valet.ACTION_SURRENDER(), true, n, deadline))
        );

        assertTrue(valet.getCapsule(capsuleId).surrendered);
        assertEq(valet.getVault(vaultId).balance, 100e6, "the money stayed the issuer's");
        assertEq(usdc.balanceOf(bob), 0, "bob took nothing");
        assertEq(bob.balance, 0, "and spent nothing");
    }

    /// A pause signature cannot be replayed as a surrender, or reused at all.
    function test_signedActionsCannotBeReplayedOrRepurposed() public {
        _claim();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 n = valet.principalNonce(capsuleId);
        // Read the constants up front. A getter call inside an expectRevert'd
        // argument list is itself a call that does not revert, and it satisfies
        // the expectation before the function under test ever runs.
        uint8 pauseAction = valet.ACTION_PAUSE();
        uint8 surrenderAction = valet.ACTION_SURRENDER();
        bytes memory pauseSig = _sign(valet.principalActionDigest(capsuleId, pauseAction, true, n, deadline));

        valet.principalActionBySignature(capsuleId, pauseAction, true, deadline, pauseSig);

        // same signature again: the nonce has moved on
        vm.expectRevert(Valet.BadSignature.selector);
        valet.principalActionBySignature(capsuleId, pauseAction, true, deadline, pauseSig);

        // and it is not a surrender authorisation
        vm.expectRevert(Valet.BadSignature.selector);
        valet.principalActionBySignature(capsuleId, surrenderAction, true, deadline, pauseSig);
    }

    function test_unknownActionRefused() public {
        _claim();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 n = valet.principalNonce(capsuleId);
        bytes memory sig = _sign(valet.principalActionDigest(capsuleId, 7, true, n, deadline));
        vm.expectRevert(Valet.UnknownAction.selector);
        valet.principalActionBySignature(capsuleId, 7, true, deadline, sig);
    }

    /// The whole journey, from a recipient who has never held a token:
    /// claim, pause, resume, hand back — four state changes, zero gas.
    function test_theEntireRecipientJourneyCostsTheRecipientNothing() public {
        assertEq(bob.balance, 0);
        uint64 d = uint64(block.timestamp + 1 days);

        uint256 n = valet.principalNonce(capsuleId);
        vm.prank(relayer);
        valet.claimBySignature(capsuleId, agent, d, _sign(valet.claimDigest(capsuleId, agent, n, d)));

        n = valet.principalNonce(capsuleId);
        vm.prank(relayer);
        valet.principalActionBySignature(capsuleId, 0, true, d, _sign(valet.principalActionDigest(capsuleId, 0, true, n, d)));

        n = valet.principalNonce(capsuleId);
        vm.prank(relayer);
        valet.principalActionBySignature(capsuleId, 0, false, d, _sign(valet.principalActionDigest(capsuleId, 0, false, n, d)));

        n = valet.principalNonce(capsuleId);
        vm.prank(relayer);
        valet.principalActionBySignature(capsuleId, 1, true, d, _sign(valet.principalActionDigest(capsuleId, 1, true, n, d)));

        assertEq(bob.balance, 0, "zero gas across the entire lifecycle");
        assertEq(valet.getCapsule(capsuleId).holder, agent);
        assertTrue(valet.getCapsule(capsuleId).surrendered);
    }

    function _claim() internal {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = valet.principalNonce(capsuleId);
        valet.claimBySignature(capsuleId, agent, deadline, _sign(valet.claimDigest(capsuleId, agent, nonce, deadline)));
    }
}
