// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Valet} from "../src/Valet.sol";
import {BeneficiaryMode, Bounds, MintParams} from "../src/ValetTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Puts a local fork into the demo's opening state: a funded vault, a
///         minted capsule for "5 USDC of MON daily for 30 days", claimed by an
///         agent. Run it after every anvil restart so the frontend always has
///         something real to point at.
///
///   VALET=0x... AGENT=0x... forge script script/SeedDemo.s.sol \
///     --rpc-url http://localhost:8545 --private-key $PK --broadcast
contract SeedDemo is Script {
    address constant KURU_MON_USDC = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    function run() external {
        Valet valet = Valet(payable(vm.envAddress("VALET")));
        address agent = vm.envAddress("AGENT");
        address principal = vm.envOr("PRINCIPAL", address(0xB0B));
        uint64 start = uint64(block.timestamp);

        vm.startBroadcast();

        uint256 vaultId = valet.openVault(USDC);
        IERC20(USDC).approve(address(valet), type(uint256).max);
        valet.fundVault(vaultId, 100e6);

        address[] memory targets = new address[](1);
        targets[0] = KURU_MON_USDC;

        uint256 capsuleId = valet.mintCapsule(MintParams({
            vaultId: vaultId,
            principal: principal,
            mode: BeneficiaryMode.PRINCIPAL,
            fixedBeneficiary: address(0),
            assetOut: address(0), // Kuru pays native MON on a buy
            policyHash: keccak256("Buy 5 USDC of MON daily for 30 days, max 1% slippage, MON to bob"),
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

        valet.claim(capsuleId, agent);

        vm.stopBroadcast();

        console.log("vaultId   ", vaultId);
        console.log("capsuleId ", capsuleId);
        console.log("principal ", principal);
        console.log("holder    ", agent);
        console.log("venue     ", KURU_MON_USDC);
    }
}
