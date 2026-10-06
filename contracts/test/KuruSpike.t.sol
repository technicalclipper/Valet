// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IKuruOrderBook, IERC20} from "../src/interfaces/IKuruOrderBook.sol";

/// @dev Stand-in for Valet's real execute(): the agent names an allowlisted
///      venue and supplies calldata, the contract never hands over custody, and
///      the proceeds are measured and forwarded to a beneficiary fixed up front.
contract SpikeExecutor {
    address public immutable beneficiary;
    mapping(address => bool) public allowedTarget;

    constructor(address _beneficiary, address _target) {
        beneficiary = _beneficiary;
        allowedTarget[_target] = true;
    }

    receive() external payable {}

    /// @return received native proceeds forwarded to the beneficiary
    function execute(address target, bytes calldata data, address tokenIn, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 received)
    {
        require(allowedTarget[target], "venue not allowlisted");

        uint256 before = address(this).balance;

        IERC20(tokenIn).approve(target, amountIn);
        (bool ok, bytes memory err) = target.call(data);
        require(ok, _reason(err));
        IERC20(tokenIn).approve(target, 0);

        received = address(this).balance - before;
        require(received >= minOut, "below floor");

        (bool sent,) = beneficiary.call{value: received}("");
        require(sent, "payout failed");
    }

    function _reason(bytes memory err) private pure returns (string memory) {
        if (err.length == 0) return "venue call failed";
        return string(err);
    }
}

contract KuruSpikeTest is Test {
    address constant MARKET = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394; // MON-USDC
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant BOB = address(0xB0B);

    SpikeExecutor exec;

    function setUp() public {
        // fork supplied by --fork-url
        exec = new SpikeExecutor(BOB, MARKET);
    }

    function test_marketParams() public view {
        (
            uint96 pricePrec,
            uint96 sizePrec,
            address base,
            uint256 baseDec,
            address quote,
            uint256 quoteDec,
            uint96 tick,
            uint96 minSize,
            uint96 maxSize
        ) = IKuruOrderBook(MARKET).getMarketParams();
        console.log("pricePrecision", pricePrec);
        console.log("sizePrecision", sizePrec);
        console.log("base (0 = native MON)", base);
        console.log("baseDecimals", baseDec);
        console.log("quote", quote);
        console.log("quoteDecimals", quoteDec);
        console.log("tickSize", tick);
        console.log("minSize", minSize);
        console.log("maxSize", maxSize);
        assertEq(quote, USDC, "quote should be USDC");
        assertEq(base, address(0), "base should be native MON");
    }

    /// Spike 0.1 — can a CONTRACT buy native MON with USDC on Kuru, atomically,
    /// with no MarginAccount deposit, and have the proceeds land on a third party?
    function test_contractCanMarketBuyAndPayBeneficiary() public {
        uint96 quoteSize = 5_000_000; // 5 USDC (6 dp)
        deal(USDC, address(exec), quoteSize);

        assertEq(IERC20(USDC).balanceOf(address(exec)), quoteSize, "funded");
        assertEq(BOB.balance, 0, "bob starts empty");

        bytes memory data = abi.encodeCall(
            IKuruOrderBook.placeAndExecuteMarketBuy,
            (quoteSize, uint256(0), false, false) // isMargin=false, isFOK=false
        );

        uint256 received = exec.execute(MARKET, data, USDC, quoteSize, 0);

        console.log("USDC spent      ", quoteSize);
        console.log("MON received    ", received);
        console.log("bob MON balance ", BOB.balance);

        assertGt(received, 0, "no proceeds");
        assertEq(BOB.balance, received, "proceeds must land on the beneficiary");
        assertEq(address(exec).balance, 0, "executor must keep nothing");
    }

    /// Fill-or-kill: Valet wants no partial fills to reason about.
    function test_fillOrKillExecutes() public {
        uint96 quoteSize = 5_000_000;
        deal(USDC, address(exec), quoteSize);
        bytes memory data = abi.encodeCall(
            IKuruOrderBook.placeAndExecuteMarketBuy, (quoteSize, uint256(0), false, true) // isFOK = true
        );
        uint256 received = exec.execute(MARKET, data, USDC, quoteSize, 0);
        console.log("FOK MON received", received);
        assertGt(received, 0, "FOK should fill against a liquid book");
        assertEq(BOB.balance, received, "beneficiary paid");
    }

    /// The slippage floor must bind. Valet's scope assert depends on this.
    function test_floorRevertsWhenUnreachable() public {
        uint96 quoteSize = 5_000_000;
        deal(USDC, address(exec), quoteSize);
        uint256 absurdFloor = 1_000_000 ether; // 1M MON for 5 USDC
        bytes memory data = abi.encodeCall(
            IKuruOrderBook.placeAndExecuteMarketBuy, (quoteSize, absurdFloor, false, true)
        );
        vm.expectRevert();
        exec.execute(MARKET, data, USDC, quoteSize, absurdFloor);
        assertEq(BOB.balance, 0, "nothing moved");
    }

    /// A venue that is not allowlisted cannot be reached at all.
    function test_unallowlistedVenueRefused() public {
        deal(USDC, address(exec), 1_000_000);
        vm.expectRevert(bytes("venue not allowlisted"));
        exec.execute(address(0xDEAD), "", USDC, 1_000_000, 0);
    }
}
