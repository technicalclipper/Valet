// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IKuruOrderBook} from "../interfaces/IKuruOrderBook.sol";

/// @title KuruAdapter — the venue calldata, in one place
/// @notice Valet itself imports no DEX. This builds the bytes a holder passes as
///         `venueData`, and exists so the contract tests, the keeper and the MCP
///         server cannot disagree about how a Kuru order is encoded.
/// @dev Only immediate-settlement orders are expressible here. A resting GTC
///      order fills in a later transaction, which cannot satisfy Valet's
///      guarantee that proceeds reach the beneficiary in the same transaction as
///      the trade — so the policy compiler puts limit-order phrasing in the
///      `refused` bucket, and there is deliberately no helper for it.
library KuruAdapter {
    /// @param quoteSize amount of the quote asset to spend, in its own decimals
    /// @param minOut    floor on the base asset received
    /// @dev isMargin=false keeps settlement direct, with no MarginAccount
    ///      deposit, so custody stays with Valet. isFOK=true removes partial
    ///      fills, which keeps the measured delta unambiguous.
    function marketBuy(uint96 quoteSize, uint256 minOut) internal pure returns (bytes memory) {
        return abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketBuy, (quoteSize, minOut, false, true));
    }

    function marketSell(uint96 size, uint256 minOut) internal pure returns (bytes memory) {
        return abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketSell, (size, minOut, false, true));
    }
}
