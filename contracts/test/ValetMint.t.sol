// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Valet} from "../src/Valet.sol";
import {BeneficiaryMode, Bounds, Capsule, MintParams, Vault} from "../src/ValetTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract ValetMintTest is Test {
    Valet valet;
    MockUSDC usdc;

    address issuer = makeAddr("alice-issuer");
    address principal = makeAddr("bob-principal");
    address agent = makeAddr("agent-holder");
    address stranger = makeAddr("stranger");

    uint256 vaultId;

    function setUp() public {
        valet = new Valet();
        usdc = new MockUSDC();
        usdc.mint(issuer, 1_000e6);

        vm.startPrank(issuer);
        vaultId = valet.openVault(address(usdc));
        usdc.approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 500e6);
        vm.stopPrank();
    }

    function _bounds() internal view returns (Bounds memory) {
        return Bounds({
            perAction: 5e6,       // 5 USDC a go
            perWindow: 5e6,       // once per window
            hardCap: 10e6,        // nothing lifts this
            totalCap: 150e6,      // 30 windows x 5
            windows: 30,
            windowLength: 1 days,
            notBefore: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 30 days),
            maxSlippageBps: 100   // 1%
        });
    }

    function _params() internal view returns (MintParams memory p) {
        address[] memory targets = new address[](1);
        targets[0] = address(0xBEEF);
        p = MintParams({
            vaultId: vaultId,
            principal: principal,
            mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0),
            policyHash: keccak256("buy 5 USDC of MON daily for 30 days, max 1% slippage"),
            bounds: _bounds(),
            allowedTargets: targets
        });
    }

    function _mint() internal returns (uint256 id) {
        vm.prank(issuer);
        id = valet.mintCapsule(_params());
    }

    // --- funding ----------------------------------------------------------

    function test_vaultAccountsItsOwnBalance() public view {
        Vault memory v = valet.getVault(vaultId);
        assertEq(v.balance, 500e6);
        assertEq(v.asset, address(usdc));
        assertEq(v.issuer, issuer);
    }

    /// A stray transfer must not enlarge what a capsule may spend.
    function test_strayTransferDoesNotRaiseCeiling() public {
        usdc.mint(stranger, 100e6);
        vm.prank(stranger);
        usdc.transfer(address(valet), 100e6);
        assertEq(valet.getVault(vaultId).balance, 500e6, "accounted balance unchanged");
        assertEq(usdc.balanceOf(address(valet)), 600e6, "token balance did change");
    }

    // --- minting ----------------------------------------------------------

    function test_mintStoresBoundsAndPolicy() public {
        uint256 id = _mint();
        Capsule memory c = valet.getCapsule(id);
        assertEq(c.issuer, issuer);
        assertEq(c.principal, principal);
        assertEq(c.holder, address(0), "unclaimed at mint");
        assertEq(c.bounds.perAction, 5e6);
        assertEq(c.bounds.hardCap, 10e6);
        assertEq(c.bounds.totalCap, 150e6);
        assertEq(c.bounds.maxSlippageBps, 100);
        assertEq(c.policyHash, keccak256("buy 5 USDC of MON daily for 30 days, max 1% slippage"));
        assertTrue(valet.allowedTarget(id, address(0xBEEF)));
        assertFalse(valet.allowedTarget(id, address(0xDEAD)));
    }

    function test_onlyVaultIssuerMayMint() public {
        vm.prank(stranger);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.mintCapsule(_params());
    }

    function test_beneficiaryModeResolves() public {
        uint256 id = _mint();
        assertEq(valet.beneficiaryOf(id), principal, "PRINCIPAL mode pays the recipient");

        MintParams memory p = _params();
        p.mode = BeneficiaryMode.FIXED;
        p.fixedBeneficiary = stranger;
        vm.prank(issuer);
        uint256 id2 = valet.mintCapsule(p);
        assertEq(valet.beneficiaryOf(id2), stranger);

        p.mode = BeneficiaryMode.VAULT;
        p.fixedBeneficiary = address(0);
        vm.prank(issuer);
        uint256 id3 = valet.mintCapsule(p);
        assertEq(valet.beneficiaryOf(id3), address(valet), "VAULT mode returns to the vault");
    }

    // --- bounds validation: caught at mint, not at spend time -------------

    function test_perActionCannotExceedHardCap() public {
        MintParams memory p = _params();
        p.bounds.perAction = 11e6; // hardCap is 10e6
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.BadBounds.selector, "perAction over hardCap"));
        valet.mintCapsule(p);
    }

    function test_hardCapCannotExceedTotalCap() public {
        MintParams memory p = _params();
        p.bounds.hardCap = 200e6; // totalCap is 150e6
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.BadBounds.selector, "hardCap over totalCap"));
        valet.mintCapsule(p);
    }

    function test_expiryMustFollowStart() public {
        MintParams memory p = _params();
        p.bounds.expiresAt = p.bounds.notBefore;
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.BadBounds.selector, "expiresAt before notBefore"));
        valet.mintCapsule(p);
    }

    function test_slippageCannotExceedOneHundredPercent() public {
        MintParams memory p = _params();
        p.bounds.maxSlippageBps = 10_001;
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(Valet.BadBounds.selector, "slippage over 100%"));
        valet.mintCapsule(p);
    }

    // --- claiming: once, and to anyone ------------------------------------

    function test_principalMayClaimToAnyAgent() public {
        uint256 id = _mint();
        vm.prank(principal);
        valet.claim(id, agent);
        assertEq(valet.getCapsule(id).holder, agent);
    }

    /// claim() takes an arbitrary address, so the agent can be one nobody here wrote.
    function test_claimAcceptsAForeignAgent() public {
        uint256 id = _mint();
        address someoneElsesAgent = makeAddr("an agent we have never seen");
        vm.prank(principal);
        valet.claim(id, someoneElsesAgent);
        assertEq(valet.getCapsule(id).holder, someoneElsesAgent);
    }

    function test_claimIsSingleUse() public {
        uint256 id = _mint();
        vm.prank(principal);
        valet.claim(id, agent);
        vm.prank(principal);
        vm.expectRevert(Valet.AlreadyClaimed.selector);
        valet.claim(id, stranger);
    }

    function test_strangerCannotClaim() public {
        uint256 id = _mint();
        vm.prank(stranger);
        vm.expectRevert(Valet.NotPrincipal.selector);
        valet.claim(id, stranger);
    }

    // --- the role split ---------------------------------------------------

    function test_holderHasNoPowersBeyondExecuting() public {
        uint256 id = _mint();
        vm.prank(principal);
        valet.claim(id, agent);

        // the agent holds the capability and can still do none of this
        vm.startPrank(agent);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.revoke(id);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.setPausedByIssuer(id, true);
        vm.expectRevert(Valet.NotPrincipal.selector);
        valet.setPausedByPrincipal(id, true);
        vm.stopPrank();
    }

    function test_neitherPartyCanUnpauseTheOther() public {
        uint256 id = _mint();
        vm.prank(principal);
        valet.setPausedByPrincipal(id, true);

        // the issuer cannot clear the principal's pause
        vm.prank(issuer);
        vm.expectRevert(Valet.NotPrincipal.selector);
        valet.setPausedByPrincipal(id, false);

        assertTrue(valet.getCapsule(id).pausedByPrincipal, "still paused");
    }

    function test_issuerRevokes() public {
        uint256 id = _mint();
        vm.prank(issuer);
        valet.revoke(id);
        assertTrue(valet.getCapsule(id).revoked);
    }

    function test_principalCannotRevoke() public {
        uint256 id = _mint();
        vm.prank(principal);
        vm.expectRevert(Valet.NotIssuer.selector);
        valet.revoke(id);
    }
}
