// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/oracle/interfaces/StoreInterface.sol";
import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/IdentifierWhitelistInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleV2Interface.sol";

import "@uma/core/contracts/common/implementation/AddressWhitelist.sol";
import "@uma/core/contracts/oracle/implementation/Constants.sol";
import "@uma/core/contracts/common/implementation/Testable.sol";

/**
 * @title Internal Optimistic Oracle
 * @notice This contract implements the Optimistic Oracle's (OO) internal escalation game logic for price requests and price proposals
 * locally. The disputes are escalated through the canonical Optimistic Oracle to the UMA's Data Verification Mechanism. The Internal
 * Optimistic Oracle (IOO) contract is meant to be utilised as a type of OO that permits customized escalation game logic and
 * custom price data structures. This IOO is intended to be the simplest implementation possible, allowing it to serve as a starting
 * point for any project that can benefit from these functionalities.
 */
contract InternalOptimisticOracle is Testable {
    using SafeERC20 for IERC20;

    struct Request {
        address proposer; // Address of the proposer.
        address disputer; // Address of the disputer.
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        bool settled; // True if the request is settled.
        uint256 proposedPrice; // Price that the proposer submitted.
        uint256 reward; // Amount of the currency to pay to the proposer on settlement.
        uint256 finalFee; // Final fee to pay to the Store upon request to the DVM.
        uint256 bond; // Bond that the proposer and disputer must pay on top of the final fee.
        uint64 liveness; // Custom liveness value set by the requester.
        uint64 expirationTime; // Time at which the request auto-settles without a dispute.
    }

    FinderInterface public immutable finder;

    OptimisticOracleV2Interface public immutable oo;

    IERC20 public immutable currency;

    bytes32 public constant priceIdentifier = "YES_OR_NO_QUERY";

    mapping(bytes32 => Request) public requests;

    /**
     * @notice Constructor.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     * @param _currency collateral token used to pay fees.
     * @param _timerAddress address of the timer contract. Only for testing, should be 0x0 in prod.
     */
    constructor(
        address _finderAddress,
        address _currency,
        address _timerAddress
    ) Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
        currency = IERC20(_currency);
        oo = OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }

    /**
     * @notice Requests a price from the Internal Optimistic Oracle.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0, which could
     * make sense if the contract requests and proposes the value in the same call or provides its own reward system.
     * @param bond custom proposal bond to set for request. If set to 0, defaults to the final fee.
     * @param liveness custom proposal liveness to set for request.
     */
    function requestPrice(
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 reward,
        uint256 bond,
        uint64 liveness
    ) public {
        bytes32 requestId = _getId(msg.sender, timestamp, ancillaryData);
        require(address(requests[requestId].currency) == address(0), "Request already initialized");
        require(_getIdentifierWhitelist().isIdentifierSupported(priceIdentifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        require(timestamp <= getCurrentTime(), "Timestamp in future");

        requests[requestId] = Request({
            proposer: address(0),
            disputer: address(0),
            currency: currency,
            settled: false,
            proposedPrice: 0,
            reward: reward,
            finalFee: _getFinalFee(),
            bond: bond,
            liveness: liveness,
            expirationTime: 0
        });

        if (reward > 0) currency.safeTransferFrom(msg.sender, address(this), reward);
    }

    /**
     * @notice Proposes a price value on a requested price.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param proposedPrice price being proposed.
     */
    function proposePrice(
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 proposedPrice
    ) public {
        Request storage request = requests[_getId(msg.sender, timestamp, ancillaryData)];
        require(address(request.currency) != address(0), "Price not requested");
        require(request.proposer == address(0), "Price already proposed");

        request.proposer = msg.sender;
        request.proposedPrice = proposedPrice;
        request.expirationTime = uint64(getCurrentTime()) + request.liveness;

        // If the final fee gets updated between the time the request is made and the time the propose is made, update it
        _updateFinalFee(request);

        request.currency.safeTransferFrom(msg.sender, address(this), request.bond + request.finalFee);
    }

    /**
     * @notice Disputes a price value on a requested price.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function disputePrice(uint256 timestamp, bytes memory ancillaryData) public {
        bytes32 requestId = _getId(msg.sender, timestamp, ancillaryData);
        Request storage request = requests[requestId];
        require(request.proposer != address(0), "No proposed price to dispute");
        require(request.disputer == address(0), "Proposal already disputed");
        require(uint64(getCurrentTime()) < request.expirationTime, "Proposal past liveness");

        request.disputer = msg.sender;

        // If the final fee gets increased between the time the request is made and the time the dispute is made, the
        // disputer will have to pay the final fee increase x2. This is a very rare edge case that we are willing to accept.
        int256 finalFeeDifference = _updateFinalFee(request);
        uint256 finalFeeIncrease = finalFeeDifference > 0 ? uint256(finalFeeDifference) : 0;

        request.currency.safeTransferFrom(
            msg.sender,
            address(this),
            request.bond + request.finalFee + finalFeeIncrease
        );

        request.currency.approve(
            address(oo),
            2 * (request.bond + request.finalFee) + finalFeeIncrease + request.reward
        );

        bytes memory disputeAncillaryData = _getDisputeAncillaryData(requestId);
        oo.requestPrice(priceIdentifier, timestamp, disputeAncillaryData, request.currency, request.reward);
        oo.setBond(priceIdentifier, timestamp, disputeAncillaryData, request.bond);
        oo.proposePriceFor(request.proposer, address(this), priceIdentifier, timestamp, disputeAncillaryData, 1e18);
        oo.disputePriceFor(msg.sender, address(this), priceIdentifier, timestamp, disputeAncillaryData);

        // If the final fee has decreased, refund the excess to the proposer.
        if (finalFeeDifference < 0) request.currency.safeTransfer(request.proposer, uint256(-finalFeeDifference));
    }

    /**
     * @notice Settles a price value on a requested price. Will revert if the price is not resolved.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function settleAndGetPrice(uint256 timestamp, bytes memory ancillaryData) public returns (uint256) {
        bytes32 requestId = _getId(msg.sender, timestamp, ancillaryData);
        Request storage request = requests[requestId];
        require(address(request.currency) != address(0), "Price not requested");
        require(request.proposer != address(0), "No proposed price to settle");
        require(!request.settled, "Price already settled");

        if (request.disputer != address(0)) {
            require(
                oo.settleAndGetPrice(priceIdentifier, timestamp, _getDisputeAncillaryData(requestId)) == 1e18,
                "Price not resolved correctly"
            );
        } else {
            require(uint64(getCurrentTime()) > request.expirationTime, "Proposal not passed liveness");
            request.currency.safeTransfer(request.proposer, request.bond + request.finalFee + request.reward);
        }

        request.settled = true;

        return request.proposedPrice;
    }

    /**
     * @notice Returns the price proposed for a given request, or reverts if the price is not available.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function getPrice(uint256 timestamp, bytes memory ancillaryData) public view returns (uint256) {
        Request storage request = requests[_getId(msg.sender, timestamp, ancillaryData)];
        require(request.settled == true, "Request not settled");
        return request.proposedPrice;
    }

    // This function must return a bytes value with length that is shorter than or equal to oo.OO_ANCILLARY_DATA_LIMIT=8139
    // See the OptimisticOracleV2 implementation for more details.
    function _getDisputeAncillaryData(bytes32 queryId) public view returns (bytes memory) {
        return
            abi.encodePacked(
                'q: "Is the proposed price to the request with ID: ',
                queryId,
                " in the following contract: ",
                address(this),
                ' valid?"'
            );
    }

    function _updateFinalFee(Request storage request) internal returns (int256 difference) {
        uint256 newFinalFee = _getFinalFee();
        difference = int256(newFinalFee) - int256(request.finalFee);
        if (difference != 0) {
            request.finalFee = newFinalFee;
        }
    }

    function _getId(
        address requester,
        uint256 timestamp,
        bytes memory ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(requester, timestamp, ancillaryData));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getFinalFee() internal view returns (uint256) {
        return
            StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store))
                .computeFinalFee(address(currency))
                .rawValue;
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }
}
