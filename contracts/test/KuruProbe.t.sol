// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IKuruOrderBook, IERC20} from "../src/interfaces/IKuruOrderBook.sol";

interface IBook {
    function getL2Book() external view returns (bytes memory);
    function bestBidAsk() external view returns (uint256, uint256);
}

contract KuruProbeTest is Test {
    address constant MARKET = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    function test_book() public view {
        bytes memory b = IBook(MARKET).getL2Book();
        console.log("L2 book bytes:", b.length);
        // book is packed; print the first words to infer scale
        uint256 n = b.length / 32;
        if (n > 10) n = 10;
        for (uint256 i = 0; i < n; i++) {
            uint256 w;
            assembly { w := mload(add(add(b, 0x20), mul(i, 0x20))) }
            console.log(i, w);
        }
    }

    /// sweep quoteSize magnitudes to find the unit the market expects
    function test_sweepBuySizes() public {
        uint96[7] memory sizes = [
            uint96(1e6),      // 1 USDC raw
            uint96(5e6),      // 5 USDC raw
            uint96(100e6),    // 100 USDC raw
            uint96(1e8),      // pricePrecision
            uint96(1e10),     // sizePrecision
            uint96(2e12),     // minSize
            uint96(5e12)
        ];
        for (uint256 i = 0; i < sizes.length; i++) {
            uint96 qs = sizes[i];
            address probe = address(uint160(0xBEEF00 + i + 1));
            deal(USDC, probe, uint256(qs));
            vm.startPrank(probe);
            IERC20(USDC).approve(MARKET, uint256(qs));
            (bool ok, bytes memory err) =
                MARKET.call(abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketBuy, (qs, uint256(0), false, false)));
            vm.stopPrank();
            console.log("--- quoteSize", qs);
            console.log("    ok:", ok);
            console.log("    MON out:", probe.balance);
            if (!ok) console.log("    errlen:", err.length);
        }
    }
}
