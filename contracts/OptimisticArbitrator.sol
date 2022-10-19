// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/oracle/interfaces/StoreInterface.sol";
import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleV2Interface.sol";

import "@uma/core/contracts/oracle/implementation/Constants.sol";

contract OptimisticArbitrator {
    using SafeERC20 for IERC20;

    FinderInterface public finder;

    IERC20 public currency; // collateral token used to bond requests and pay rewards.

    bytes32 public priceIdentifier = "YES_OR_NO_QUERY";

    constructor(address _finderAddress, address _currency) {
        finder = FinderInterface(_finderAddress);
        currency = IERC20(_currency);
    }

    function makeAssertion(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice,
        uint256 reward,
        uint256 bond,
        uint64 liveness
    ) public {
        OptimisticOracleV2Interface oo = _getOptimisticOracle();

        uint256 totalAmount = reward + bond + _getStore().computeFinalFee(address(currency)).rawValue;
        _pullAndApprove(address(oo), totalAmount);

        _makeAssertion(timestamp, ancillaryData, proposedPrice, reward, bond, liveness, oo);
    }

    function ratifyAssertion(uint256 timestamp, bytes memory ancillaryData) public {
        OptimisticOracleV2Interface oo = _getOptimisticOracle();
        OptimisticOracleV2Interface.Request memory request = oo.getRequest(
            address(this),
            priceIdentifier,
            timestamp,
            ancillaryData
        );
        uint256 totalAmount = request.reward +
            request.requestSettings.bond +
            _getStore().computeFinalFee(address(currency)).rawValue;
        _pullAndApprove(address(oo), totalAmount);
        oo.disputePriceFor(msg.sender, address(this), priceIdentifier, timestamp, ancillaryData);
    }

    function assertAndRatify(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice,
        uint256 reward,
        uint256 bond,
        uint64 liveness
    ) public {
        OptimisticOracleV2Interface oo = _getOptimisticOracle();
        uint256 totalAmount = reward + 2 * (bond + _getStore().computeFinalFee(address(currency)).rawValue);
        _pullAndApprove(address(oo), totalAmount);

        _makeAssertion(timestamp, ancillaryData, proposedPrice, reward, bond, liveness, oo);
        oo.disputePriceFor(msg.sender, address(this), priceIdentifier, timestamp, ancillaryData);
    }

    function getTruth(uint256 timestamp, bytes memory ancillaryData) public view returns (int256) {
        OptimisticOracleV2Interface oo = _getOptimisticOracle();
        return oo.getRequest(address(this), priceIdentifier, timestamp, ancillaryData).resolvedPrice;
    }

    function getCurrentTime() public view returns (uint256) {
        return block.timestamp;
    }

    function _makeAssertion(
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice,
        uint256 reward,
        uint256 bond,
        uint64 liveness,
        OptimisticOracleV2Interface oo
    ) private {
        oo.requestPrice(priceIdentifier, timestamp, ancillaryData, currency, reward);
        oo.setBond(priceIdentifier, timestamp, ancillaryData, bond);
        oo.setCustomLiveness(priceIdentifier, timestamp, ancillaryData, liveness);
        oo.proposePriceFor(
            address(msg.sender),
            address(this),
            priceIdentifier,
            timestamp,
            ancillaryData,
            proposedPrice
        );
    }

    function _pullAndApprove(address recipient, uint256 amount) private {
        currency.safeTransferFrom(msg.sender, address(this), amount);
        currency.approve(address(recipient), amount);
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleV2Interface) {
        return OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }
}
