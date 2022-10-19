// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/oracle/interfaces/StoreInterface.sol";
import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleV2Interface.sol";

import "@uma/core/contracts/oracle/implementation/Constants.sol";

/**
 * @title Optimistic Arbitrator
 * @notice This contract enables assertions to be made to the Optimistic Oracle and assertions to be ratified
 * by the UMA Data Verification Mechanism. An assertion consists of using the requestPrice and proposePrice
 * methods of the OptimisticOracle to confirm or deny the response to a question. To ratify an assertion,
 * an initial assertion must be made and disputed, such that the question is scaled to the DVM, where UMA token
 * holders vote on it.
 */
contract OptimisticArbitrator {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder;

    OptimisticOracleV2Interface public immutable oo;

    IERC20 public immutable currency;

    bytes32 public priceIdentifier = "YES_OR_NO_QUERY";

    /**
     * @notice Constructor.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     * @param _currency collateral token used to pay rewards and fees.
     */
    constructor(address _finderAddress, address _currency) {
        finder = FinderInterface(_finderAddress);
        currency = IERC20(_currency);
        oo = OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }

    /**
     * @notice Makes an assertion to the Optimistic Oracle.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     * @param proposedPrice price being proposed.
     * @param reward reward offered to a successful proposer. Note: this can be 0, which could make sense if the caller
     * expects to not being disputed.
     * @param bond custom proposal bond to set for request. If set to 0, defaults to the final fee.
     * @param liveness custom proposal liveness to set for request, if set to 0, defaults to the default liveness value.
     */
    function makeAssertion(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice,
        uint256 reward,
        uint256 bond,
        uint64 liveness
    ) public {
        uint256 totalAmount = reward + bond + _getStore().computeFinalFee(address(currency)).rawValue;
        _pullAndApprove(totalAmount);

        _makeAssertion(timestamp, ancillaryData, proposedPrice, reward, bond, liveness);
    }

    /**
     * @notice Ratifies an existing assertion to the DVM by disputing the proposed answer to the question.
     * @dev The cost of rafiying an assertion in collateral token is equal to the final fee + bond / 2.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     */
    function ratifyAssertion(uint256 timestamp, bytes memory ancillaryData) public {
        OptimisticOracleV2Interface.Request memory request = oo.getRequest(
            address(this),
            priceIdentifier,
            timestamp,
            ancillaryData
        );

        uint256 totalAmount = request.requestSettings.bond + _getStore().computeFinalFee(address(currency)).rawValue;
        _pullAndApprove(totalAmount);

        oo.disputePriceFor(msg.sender, address(this), priceIdentifier, timestamp, ancillaryData);
    }

    /**
     * @notice Assert and ratifies a question to the DVM.
     * @dev The cost of asserting and ratifying in collateral token is equal to the final fee as we set the bond to 0.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     */
    function assertAndRatify(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) public {
        uint256 totalAmount = 2 * _getStore().computeFinalFee(address(currency)).rawValue;
        _pullAndApprove(totalAmount);

        _makeAssertion(timestamp, ancillaryData, proposedPrice, 0, 0, 0);
        oo.disputePriceFor(msg.sender, address(this), priceIdentifier, timestamp, ancillaryData);
    }

    /**
     * @notice Returns the result of an assertion if it has been resolved.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     */
    function getResult(uint256 timestamp, bytes memory ancillaryData) external view returns (int256) {
        require(oo.hasPrice(address(this), priceIdentifier, timestamp, ancillaryData), "Price not resolved");
        return oo.getRequest(address(this), priceIdentifier, timestamp, ancillaryData).resolvedPrice;
    }

    /**
     * @notice Settles the assertion an returns the result.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     */
    function settleAndGetResult(uint256 timestamp, bytes memory ancillaryData) external returns (int256) {
        return oo.settleAndGetPrice(priceIdentifier, timestamp, ancillaryData);
    }

    // Makes an assertion to the Optimistic Oracle by requesting a price and proposing a price.
    // If the liveness is set to 0, the default liveness value is used.
    function _makeAssertion(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice,
        uint256 reward,
        uint256 bond,
        uint64 liveness
    ) private {
        oo.requestPrice(priceIdentifier, timestamp, ancillaryData, currency, reward);
        oo.setBond(priceIdentifier, timestamp, ancillaryData, bond);
        if (liveness > 0) oo.setCustomLiveness(priceIdentifier, timestamp, ancillaryData, liveness);
        oo.proposePriceFor(
            address(msg.sender),
            address(this),
            priceIdentifier,
            timestamp,
            ancillaryData,
            proposedPrice
        );
    }

    // Pulls and amount of collateral tokens from sender and approves the Optimistic Oracle to spend them.
    function _pullAndApprove(uint256 amount) private {
        currency.safeTransferFrom(msg.sender, address(this), amount);
        currency.approve(address(oo), amount);
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }
}
