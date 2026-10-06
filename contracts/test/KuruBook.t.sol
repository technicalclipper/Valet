// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";

interface IBook {
    function getL2Book() external view returns (bytes memory);
}

/// @dev Reads live MON-USDC depth. Kept because the demo's fill quality depends
///      on there being a real book, and this is how to check before a demo.
contract KuruBookTest is Test {
    address constant MARKET = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;

    function setUp() public {
        // These suites read the real Kuru book, so they need
        // --fork-url https://rpc.monad.xyz. Skip rather than fail without it, so
        // a plain `forge test` still runs everything that does not need a fork.
        if (block.chainid != 143) {
            vm.skip(true);
            return;
        }
    }

    function test_liveDepth() public {
        bytes memory b = IBook(MARKET).getL2Book();
        console.log("L2 book bytes:", b.length);
        uint256 words = b.length / 32;
        uint256 show = words > 8 ? 8 : words;
        for (uint256 i = 0; i < show; i++) {
            uint256 w;
            assembly { w := mload(add(add(b, 0x20), mul(i, 0x20))) }
            console.log(i, w);
        }
        assertGt(b.length, 64, "book should not be empty");
    }
}
