// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/common/implementation/AddressWhitelist.sol";
import "@uma/core/contracts/oracle/implementation/Constants.sol";
import "@uma/core/contracts/common/implementation/Testable.sol";
import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleV2Interface.sol";

/**
 * @title Insurance Arbitrator Contract
 * @notice This example implementation allows insurer to issue insurance policy by depositing insured amount,
 * designating the insured beneficiary and describing insured event. At any time anyone can submit claim that the insured
 * event has occurred by posting oracle bonding. Insurance Arbitrator resolves the claim through Optimistic Oracle by
 * passing templated question with insured event description in ancillary data. If the claim is confirmed this contract
 * automatically pays out insurance coverage to the insured beneficiary. If the claim is rejected policy continues to be
 * active ready for the subsequent claim attempts.
 */
contract InsuranceArbitrator is Testable {
    using SafeERC20 for IERC20;

    /******************************************
     *  STATE VARIABLES AND DATA STRUCTURES   *
     ******************************************/

    // Stores state and parameters of insurance policy.
    struct InsurancePolicy {
        bool claimInitiated; // Claim state preventing simultaneous claim attempts.
        string insuredEvent; // Short description of insured event.
        address insuredAddress; // Beneficiary address eligible for insurance compensation.
        IERC20 currency; // Denomination token for insurance coverage.
        uint256 insuredAmount; // Amount of insurance coverage.
    }

    // Tracks raised claims on insurance policies.
    struct Claim {
        bytes32 policyId; // Claimed policy identifier.
        OptimisticOracleV2Interface optimisticOracle; // optimistic oracle instance where claims are resolved.
    }

    // References all active insurance policies by policyId.
    mapping(bytes32 => InsurancePolicy) public insurancePolicies;

    // Maps hash of initiated claims to their policyId and optimistic oracle implementation.
    // This is used in callback function to potentially pay out the beneficiary.
    mapping(bytes32 => Claim) public insuranceClaims;

    // Oracle proposal bond set to 0.1% of claimed insurance coverage.
    uint256 public constant oracleBondPercentage = 1e15;

    // Optimistic oracle liveness set to 24h.
    uint256 public constant optimisticOracleLivenessTime = 3600 * 24;

    // Price identifier to use when requesting claims through Optimistic Oracle.
    bytes32 public constant priceIdentifier = "YES_OR_NO_QUERY";

    // Template for constructing ancillary data. The claim would insert insuredEvent in between when requesting
    // through Optimistic Oracle.
    string constant ancillaryDataHead = 'q:"Had the following insured event occurred as of request timestamp: ';
    string constant ancillaryDataTail = '?"';

    // Finder for UMA contracts.
    FinderInterface public finder;

    uint256 public constant MAX_EVENT_DESCRIPTION_SIZE = 300; // Insured event description should be concise.

    /****************************************
     *                EVENTS                *
     ****************************************/

    event PolicyIssued(
        bytes32 indexed policyId,
        address indexed insurer,
        string insuredEvent,
        address indexed insuredAddress,
        IERC20 currency,
        uint256 insuredAmount
    );
    event ClaimSubmitted(
        uint256 claimTimestamp,
        bytes32 indexed policyId,
        string insuredEvent,
        address indexed insuredAddress,
        IERC20 currency,
        uint256 insuredAmount
    );
    event ClaimAccepted(
        uint256 claimTimestamp,
        bytes32 indexed policyId,
        string insuredEvent,
        address indexed insuredAddress,
        IERC20 currency,
        uint256 insuredAmount
    );
    event ClaimRejected(
        uint256 claimTimestamp,
        bytes32 indexed policyId,
        string insuredEvent,
        address indexed insuredAddress,
        IERC20 currency,
        uint256 insuredAmount
    );

    /**
     * @notice Construct the InsuranceArbitrator
     * @param _finderAddress DVM finder to find other UMA ecosystem contracts.
     */
    constructor(address _finderAddress, address _timerAddress) Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
    }

    /******************************************
     *          INSURANCE FUNCTIONS           *
     ******************************************/

    /**
     * @notice Deposits insuredAmount from the insurer and issues insurance policy to the insured beneficiary.
     * @dev This contract must be approved to spend at least insuredAmount of currency token.
     * @param insuredEvent short description of insured event. Potential verifiers should be able to evaluate whether
     * this event had occurred as of claim time with binary yes/no answer.
     * @param insuredAddress Beneficiary address eligible for insurance compensation.
     * @param currency Denomination token for insurance coverage.
     * @param insuredAmount Amount of insurance coverage.
     * @return policyId Unique identifier of issued insurance policy.
     */
    function issueInsurance(
        string calldata insuredEvent,
        address insuredAddress,
        IERC20 currency,
        uint256 insuredAmount
    ) external returns (bytes32 policyId) {
        require(bytes(insuredEvent).length <= MAX_EVENT_DESCRIPTION_SIZE, "Event description too long");
        require(insuredAddress != address(0), "Invalid insured address");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        require(insuredAmount > 0, "Amount should be above 0");
        policyId = _getPolicyId(block.number, insuredEvent, insuredAddress, currency, insuredAmount);
        require(insurancePolicies[policyId].insuredAddress == address(0), "Policy already issued");

        InsurancePolicy storage newPolicy = insurancePolicies[policyId];
        newPolicy.insuredEvent = insuredEvent;
        newPolicy.insuredAddress = insuredAddress;
        newPolicy.currency = currency;
        newPolicy.insuredAmount = insuredAmount;

        currency.safeTransferFrom(msg.sender, address(this), insuredAmount);

        emit PolicyIssued(policyId, msg.sender, insuredEvent, insuredAddress, currency, insuredAmount);
    }

    /**
     * @notice Anyone can submit insurance claim posting oracle bonding. Only one simultaneous claim per insurance
     * policy is allowed.
     * @dev This contract must be approved to spend at least (insuredAmount * oracleBondPercentage + finalFee) of
     * currency token. This call requests and proposes that insuredEvent had ocured through Optimistic Oracle.
     * @param policyId Identifier of claimed insurance policy.
     */
    function submitClaim(bytes32 policyId) external {
        InsurancePolicy storage claimedPolicy = insurancePolicies[policyId];
        require(claimedPolicy.insuredAddress != address(0), "Insurance not issued");
        require(!claimedPolicy.claimInitiated, "Claim already initiated");

        claimedPolicy.claimInitiated = true;
        uint256 timestamp = getCurrentTime();
        string memory insuredEvent = claimedPolicy.insuredEvent;
        bytes memory ancillaryData = abi.encodePacked(ancillaryDataHead, insuredEvent, ancillaryDataTail);
        bytes32 claimId = _getClaimId(timestamp, ancillaryData);
        Claim storage newClaim = insuranceClaims[claimId];
        newClaim.policyId = policyId;
        OptimisticOracleV2Interface optimisticOracle = _getOptimisticOracle();
        newClaim.optimisticOracle = optimisticOracle;

        // Initiate price request at Optimistic Oracle.
        IERC20 currency = claimedPolicy.currency;
        optimisticOracle.requestPrice(priceIdentifier, timestamp, ancillaryData, currency, 0);

        // Configure price request parameters.
        uint256 insuredAmount = claimedPolicy.insuredAmount;
        uint256 proposerBond = (insuredAmount * oracleBondPercentage) / 1e18;
        uint256 totalBond = optimisticOracle.setBond(priceIdentifier, timestamp, ancillaryData, proposerBond);
        optimisticOracle.setCustomLiveness(priceIdentifier, timestamp, ancillaryData, optimisticOracleLivenessTime);
        optimisticOracle.setCallbacks(priceIdentifier, timestamp, ancillaryData, false, false, true);

        // Propose canonical value representing "True"; i.e. the insurance claim is valid.
        currency.safeTransferFrom(msg.sender, address(this), totalBond);
        currency.safeApprove(address(optimisticOracle), totalBond);
        optimisticOracle.proposePriceFor(
            msg.sender,
            address(this),
            priceIdentifier,
            timestamp,
            ancillaryData,
            int256(1e18)
        );

        emit ClaimSubmitted(timestamp, policyId, insuredEvent, claimedPolicy.insuredAddress, currency, insuredAmount);
    }

    /******************************************
     *           CALLBACK FUNCTIONS           *
     ******************************************/

    /**
     * @notice Callback function called by the Optimistic Oracle when the claim is settled. If the claim is confirmed
     * this pays out insurance coverage to the insured beneficiary and deletes the insurance policy. If the claim is
     * rejected policy claim state is reset so that it is ready for the subsequent claim attempts.
     * @param identifier Price identifier being requested.
     * @param timestamp Timestamp of the price being requested.
     * @param ancillaryData Ancillary data of the price being requested.
     * @param price Price that was resolved by the escalation process.
     */
    function priceSettled(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 price
    ) external {
        bytes32 claimId = _getClaimId(timestamp, ancillaryData);
        require(address(insuranceClaims[claimId].optimisticOracle) == msg.sender, "Unauthorized callback");

        // Claim can be settled only once, thus should be deleted.
        bytes32 policyId = insuranceClaims[claimId].policyId;
        InsurancePolicy storage claimedPolicy = insurancePolicies[policyId];
        string memory insuredEvent = claimedPolicy.insuredEvent;
        delete insuranceClaims[claimId];

        address insuredAddress = claimedPolicy.insuredAddress;
        IERC20 currency = claimedPolicy.currency;
        uint256 insuredAmount = claimedPolicy.insuredAmount;

        // Deletes insurance policy and transfers claim amount if the claim was confirmed.
        if (price == 1e18) {
            delete insurancePolicies[policyId];
            currency.safeTransfer(insuredAddress, insuredAmount);

            emit ClaimAccepted(timestamp, policyId, insuredEvent, insuredAddress, currency, insuredAmount);
            // Otherwise just reset the flag so that repeated claims can be made.
        } else {
            claimedPolicy.claimInitiated = false;

            emit ClaimRejected(timestamp, policyId, insuredEvent, insuredAddress, currency, insuredAmount);
        }
    }

    /******************************************
     *           INTERNAL FUNCTIONS           *
     ******************************************/

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getPolicyId(
        uint256 blockNumber,
        string memory insuredEvent,
        address insuredAddress,
        IERC20 currency,
        uint256 insuredAmount
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(blockNumber, insuredEvent, insuredAddress, currency, insuredAmount));
    }

    function _getClaimId(uint256 timestamp, bytes memory ancillaryData) internal pure returns (bytes32) {
        return keccak256(abi.encode(timestamp, ancillaryData));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleV2Interface) {
        return OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }
}
