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
 * @notice This contract enables assertions to be made to the Optimistic Oracle and assertions to be ratified by the UMA
 *  Data Verification Mechanism. An assertion consists of using the requestPrice and proposePrice methods of the OptimisticOracle to
 *  confirm or deny the response to a question. To ratify an assertion, an initial assertion must be made and disputed, such that the
 *  question is escalated to the DVM, where UMA token holders vote on it.
 * @dev This contract is stateless and solely encapsulates the DVM's functionality to leverage the Optimistic Arbitrator pattern.
 * @dev The Optimistic Oracle's functions are called on behalf of the caller, hence this contract will neither hold nor receive funds
 *  from these actions. The Optimistic Oracle in this design is used to handle all bond payouts based on the outcome of the DVM vote.
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
     * @param _currency collateral token used to pay fees.
     */
    constructor(address _finderAddress, address _currency) {
        finder = FinderInterface(_finderAddress);
        currency = IERC20(_currency);
        oo = OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }

    /**
     * @notice Makes an assertion to the Optimistic Oracle.
     * @dev The Optimistic Oracle price proposal is submitted on behalf of the caller, therefore only the caller,
     *  and not the Optimist Arbitrator, will hold or receive funds.
     * @param timestamp timestamp of the assertion
     * @param ancillaryData ancillary data representing additional args being passed with the assertion.
     * @param assertedValue value being proposed.
     * expects to not being disputed.
     * @param bond custom proposal bond to set for request. If set to 0, the bond pulled from the caller equals the finalFee.
     * @param liveness custom proposal liveness to set for request, if set to 0, defaults to the default liveness value.
     */
    function makeAssertion(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 assertedValue,
        uint256 bond,
        uint64 liveness
    ) public {
        _pullAndApprove(bond + _getStore().computeFinalFee(address(currency)).rawValue);
        _makeAssertion(timestamp, ancillaryData, assertedValue, bond, liveness);
    }

    /**
     * @notice Ratifies an existing assertion to the DVM by disputing the proposed answer to the question.
     * @dev If the proposer and disputer are the same address then the final cost of rafiying an assertion in collateral
     *  token is equal to the final fee + bond / 2.
     * @dev The Optimistic Oracle price dispute is submitted on behalf of the caller, therefore only the caller,
     *  and not the Optimist Arbitrator, will hold or receive funds.
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
        _pullAndApprove(request.requestSettings.bond + _getStore().computeFinalFee(address(currency)).rawValue);
        oo.disputePriceFor(msg.sender, address(this), priceIdentifier, timestamp, ancillaryData);
    }

    /**
     * @notice Assert and ratifies a question to the DVM.
     * @dev The proposer and disputer are the same address so the final cost of asserting and ratifying in collateral token
     *  is equal to the final fee as we set the bond to 0.
     * @dev The Optimistic Oracle price proposal and dispute are submitted on behalf of the caller, therefore only the caller,
     *  and not the Optimist Arbitrator, will hold or receive funds.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     */
    function assertAndRatify(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 assertedValue
    ) public {
        _pullAndApprove(2 * _getStore().computeFinalFee(address(currency)).rawValue);
        _makeAssertion(timestamp, ancillaryData, assertedValue, 0, 0);
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
        int256 assertedValue,
        uint256 bond,
        uint64 liveness
    ) private {
        oo.requestPrice(priceIdentifier, timestamp, ancillaryData, currency, 0);
        oo.setBond(priceIdentifier, timestamp, ancillaryData, bond);
        if (liveness > 0) oo.setCustomLiveness(priceIdentifier, timestamp, ancillaryData, liveness);
        oo.proposePriceFor(
            address(msg.sender),
            address(this),
            priceIdentifier,
            timestamp,
            ancillaryData,
            assertedValue
        );
    }

    // Pulls amount of collateral tokens from sender and approves the Optimistic Oracle to spend them.
    function _pullAndApprove(uint256 amount) private {
        currency.safeTransferFrom(msg.sender, address(this), amount);
        currency.approve(address(oo), amount);
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }
}
