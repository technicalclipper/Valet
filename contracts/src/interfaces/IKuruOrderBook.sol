// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal surface of a Kuru CLOB market that Valet needs.
/// @dev Only the immediate-settlement calls are used. Resting (GTC) orders are
///      deliberately absent: they fill in a later transaction, which would break
///      Valet's guarantee that proceeds reach the beneficiary in the same tx.
interface IKuruOrderBook {
    /// @param _quoteSize amount of the quote asset to spend
    /// @param _minOut    minimum base asset out, or the call reverts
    /// @param _isMargin  false = settle directly, no MarginAccount deposit
    /// @param _isFOK     true = fill-or-kill, so no partial fill to reason about
    function placeAndExecuteMarketBuy(uint96 _quoteSize, uint256 _minOut, bool _isMargin, bool _isFOK)
        external
        payable
        returns (uint256);

    function placeAndExecuteMarketSell(uint96 _size, uint256 _minOut, bool _isMargin, bool _isFOK)
        external
        payable
        returns (uint256);

    /// @return pricePrecision, sizePrecision, baseAsset, baseDecimals,
    ///         quoteAsset, quoteDecimals, tickSize, minSize, maxSize
    function getMarketParams()
        external
        view
        returns (uint96, uint96, address, uint256, address, uint256, uint96, uint96, uint96);
}

interface IERC20 {
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}
