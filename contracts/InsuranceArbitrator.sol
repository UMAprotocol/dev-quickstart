// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";

/**
 * @title Insurance Arbitrator Contract
 * @notice This example implementation allows insurer to issue insurance policy by depositing insured amount,
 * designating the insured beneficiary and describing insured event. At any time anyone can submit claim that the insured
 * event has occurred by posting oracle bonding. Insurance Arbitrator resolves the claim through Optimistic Oracle by
 * passing templated question with insured event description in ancillary data. If the claim is confirmed this contract
 * automatically pays out insurance coverage to the insured beneficiary. If the claim is rejected policy continues to be
 * active ready for the subsequent claim attempts.
 */
contract InsuranceArbitrator {
    /******************************************
     *  STATE VARIABLES AND DATA STRUCTURES   *
     ******************************************/

    // Stores state and parameters of insurance policy.
    struct InsurancePolicy {
        // Claim state preventing simultaneous claim attempts.
        bool claimInitiated;
        // Short description of insured event.
        string insuredEvent;
        // Beneficiary address eligible for insurance compensation.
        address insuredAddress;
        // Denomination token for insurance coverage.
        address currency;
        // Amount of insurance coverage.
        uint256 insuredAmount;
    }

    // References all active insurance policies by `policyId`.
    mapping(bytes32 => InsurancePolicy) insurancePolicies;

    // Maps hash of initiated claims to their `policyId`.
    // This is used in callback function to potentially pay out the beneficiary.
    mapping(bytes32 => bytes32) insuranceClaims;

    // Oracle proposal bond set to 0.1% of claimed insurance coverage.
    uint256 constant oracleBondPercentage = 10e15;

    // Optimistic oracle liveness set to 24h.
    uint256 constant optimisticOracleLivenessTime = 3600 * 24;

    // Price identifier to use when requesting claims through Optimistic Oracle.
    bytes32 constant priceIdentifier = "YES_OR_NO_QUERY";

    // Template for constructing ancillary data. The claim would insert `insuredEvent` in between when requesting
    // through Optimistic Oracle.
    string constant ancillaryDataHead = 'q:"Had the following insured event occurred as of request timestamp: ';
    string constant ancillaryDataTail = '?"';

    // Finder for UMA contracts.
    FinderInterface public finder;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event policyIssued(
        bytes32 indexed policyId,
        address indexed insurer,
        string insuredEvent,
        address indexed insuredAddress,
        address currency,
        uint256 insuredAmount
    );
    event claimSubmitted(
        uint256 claimTimestamp,
        bytes32 indexed policyId,
        address indexed insurer,
        string insuredEvent,
        address indexed insuredAddress,
        address currency,
        uint256 insuredAmount
    );
    event claimAccepted(
        uint256 claimTimestamp,
        bytes32 indexed policyId,
        address indexed insurer,
        string insuredEvent,
        address indexed insuredAddress,
        address currency,
        uint256 insuredAmount
    );
    event claimRejected(
        uint256 claimTimestamp,
        bytes32 indexed policyId,
        address indexed insurer,
        string insuredEvent,
        address indexed insuredAddress,
        address currency,
        uint256 insuredAmount
    );

    /**
     * @notice Construct the InsuranceArbitrator
     * @param _finderAddress DVM finder to find other UMA ecosystem contracts.
     */
    constructor(address _finderAddress) {}

    /******************************************
     *          INSURANCE FUNCTIONS           *
     ******************************************/

    /**
     * @notice Deposits `insuredAmount` from the insurer and issues insurance policy to the insured beneficiary.
     * @dev This contract must be approved to spend at least `insuredAmount` of `currency` token.
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
        address currency,
        uint256 insuredAmount
    ) external returns (bytes32 policyId) {}

    /**
     * @notice Anyone can submit insurance claim posting oracle bonding. Only one simultaneous claim per insurance
     * policy is allowed.
     * @dev This contract must be approved to spend at least `insuredAmount` * `oracleBondPercentage` + `finalFee` of
     * `currency` token. This call requests and proposes that `insuredEvent` had ocured through Optimistic Oracle.
     * @param policyId Identifier of claimed insurance policy.
     */
    function submitClaim(bytes32 policyId) external {}

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
    ) external {}
}
