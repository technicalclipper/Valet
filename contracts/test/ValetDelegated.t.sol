// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {BeneficiaryMode, Bounds, MintParams} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC7 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// A delegate that answers no ERC-1271 question correctly — like the sweeper
/// bots' contracts found behind anvil's accounts on Monad mainnet.
contract UnhelpfulDelegate {
    fallback() external payable {}
}

/// EIP-7702: an address with a private key that also runs contract code.
/// MetaMask smart accounts and Privy's 7702 wallets look like this.
contract ValetDelegatedTest is Test {
    Valet valet;
    MockUSDC7 usdc;
    uint256 issuerPk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    address issuer;
    address bob;
    uint256 capsuleId;

    function setUp() public {
        vm.warp(1_000_000);
        issuer = vm.addr(issuerPk);
        bob = vm.addr(bobPk);
        valet = new Valet();
        usdc = new MockUSDC7();
        usdc.mint(issuer, 1_000e6);

        vm.startPrank(issuer);
        uint256 vaultId = valet.openVault(address(usdc));
        usdc.approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 100e6);
        address[] memory t = new address[](1);
        t[0] = makeAddr("venue");
        capsuleId = valet.mintCapsule(MintParams({
            vaultId: vaultId, principal: bob, mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0), assetOut: address(0), policyHash: bytes32(0),
            bounds: Bounds({
                perAction: 5e6, perWindow: 5e6, hardCap: 10e6, totalCap: 150e6, windows: 30,
                windowLength: 1 days, notBefore: uint64(block.timestamp),
                expiresAt: uint64(block.timestamp + 30 days), maxSlippageBps: 100
            }),
            allowedTargets: t
        }));
        vm.stopPrank();

        // give bob a 7702 delegation designator: 0xef0100 ++ delegate address
        address delegate = address(new UnhelpfulDelegate());
        vm.etch(bob, abi.encodePacked(hex"ef0100", delegate));
        assertGt(bob.code.length, 0, "bob is an EOA that carries code");
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_aDelegatedRecipientCanStillClaimWithItsOwnKey() public {
        address agent = makeAddr("agent");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(bobPk, valet.claimDigest(capsuleId, agent, 0, deadline));
        valet.claimBySignature(capsuleId, agent, deadline, sig);
        assertEq(valet.getCapsule(capsuleId).holder, agent);
    }

    function test_aDelegatedRecipientCanStillPause() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(bobPk, valet.principalActionDigest(capsuleId, 0, true, 0, deadline));
        valet.principalActionBySignature(capsuleId, 0, true, deadline, sig);
        assertTrue(valet.getCapsule(capsuleId).pausedByPrincipal);
    }

    function test_aDelegatedIssuerCanStillApprove() public {
        // the issuer is delegated too
        vm.etch(issuer, abi.encodePacked(hex"ef0100", address(new UnhelpfulDelegate())));
        address agent = makeAddr("agent");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        valet.claimBySignature(capsuleId, agent, deadline, _sign(bobPk, valet.claimDigest(capsuleId, agent, 0, deadline)));
        vm.prank(agent);
        uint256 nonce = valet.requestEscalation(capsuleId, 8e6, "");
        valet.approveEscalation(capsuleId, 8e6, nonce, deadline, _sign(issuerPk, valet.escalationDigest(capsuleId, 8e6, nonce, deadline)));
        assertTrue(valet.getEscalation(capsuleId, nonce).approved);
    }

    /// Still no signature but the right one.
    function test_aStrangersKeyIsStillRefused() public {
        address agent = makeAddr("agent");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(0xDEAD, valet.claimDigest(capsuleId, agent, 0, deadline));
        vm.expectRevert(Valet.BadSignature.selector);
        valet.claimBySignature(capsuleId, agent, deadline, sig);
    }
}
