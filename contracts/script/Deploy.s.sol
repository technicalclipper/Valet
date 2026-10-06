// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Valet} from "../src/Valet.sol";

/// @notice Deploys Valet.
/// @dev Against a local anvil fork of Monad mainnet for development, and against
///      Monad mainnet itself for the demo. Monad testnet is deliberately not a
///      target: Kuru is not deployed there, so every trade would be a mock and
///      the thing worth demonstrating would be the thing not being tested.
///
///   anvil --fork-url https://rpc.monad.xyz --port 8545
///   forge script script/Deploy.s.sol --rpc-url http://localhost:8545 \
///     --private-key $PK --broadcast
contract Deploy is Script {
    function run() external returns (Valet valet) {
        vm.startBroadcast();
        valet = new Valet();
        vm.stopBroadcast();

        console.log("Valet            ", address(valet));
        console.log("chainid          ", block.chainid);
        console.log("ESCALATION_TYPEHASH");
        console.logBytes32(valet.ESCALATION_TYPEHASH());
    }
}
