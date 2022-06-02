// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/common/implementation/Testable.sol";

import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleInterface.sol";
import "@uma/core/contracts/common/interfaces/ExpandedIERC20.sol";
import "@uma/core/contracts/oracle/implementation/Constants.sol";
import "@uma/core/contracts/financial-templates/common/financial-product-libraries/long-short-pair-libraries/LongShortPairFinancialProductLibrary.sol";

interface EventBasedPredictionMarketInterface {
    // Create a pair of long/short tokens equal in number to tokensToCreate
    function create(uint256 tokensToCreate) external returns (uint256 collateralUsed);

    // Redeems a pair of long and short tokens equal in number to tokensToRedeem.
    // Reverts if oracle hasPrice is true.
    function redeem(uint256 tokensToRedeem) external returns (uint256 collateralReturned);

    // Settle long and/or short tokens in for collateral at a rate informed by the contract settlement.
    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        external
        returns (uint256 collateralReturned);
}

abstract contract EventBasedPredictionMarket is EventBasedPredictionMarketInterface, Testable {
    using SafeERC20 for IERC20;

    bool public receivedSettlementPrice;

    bool public enableEarlyExpiration; // If set, the LSP contract can request to be settled early by calling the OO.
    uint256 public expirationTimestamp;
    string public pairName;
    uint256 public collateralPerPair; // Amount of collateral a pair of tokens is always redeemable for.

    // Number between 0 and 1e18 to allocate collateral between long & short tokens at redemption. 0 entitles each short
    // to collateralPerPair and each long to 0. 1e18 makes each long worth collateralPerPair and short 0.

    // Number between 0 and 1e18 to allocate collateral between long & short tokens at redemption. 0 entitles each short
    // to collateralPerPair and each long to 0. 1e18 makes each long worth collateralPerPair and short 0.
    uint256 public expiryPercentLong;
    bytes32 public priceIdentifier;

    // Price returned from the Optimistic oracle at settlement time.
    int256 public expiryPrice;

    // External contract interfaces.
    IERC20 public collateralToken;
    ExpandedIERC20 public longToken;
    ExpandedIERC20 public shortToken;
    FinderInterface public finder;
    LongShortPairFinancialProductLibrary public financialProductLibrary;

    // Optimistic oracle customization parameters.
    bytes public customAncillaryData;
    uint256 public proposerReward;
    uint256 public optimisticOracleLivenessTime;
    uint256 public optimisticOracleProposerBond;

    // Define the contract's constructor parameters as a struct to enable more variables to be specified.
    struct ConstructorParams {
        string pairName; // Name of the long short pair contract.
        uint256 expirationTimestamp; // Unix timestamp of when the contract will expire.
        uint256 collateralPerPair; // How many units of collateral are required to mint one pair of synthetic tokens.
        bytes32 priceIdentifier; // Price identifier, registered in the DVM for the long short pair.
        // bool enableEarlyExpiration; // Enables the LSP contract to be settled early.
        ExpandedIERC20 longToken; // Token used as long in the LSP. Mint and burn rights needed by this contract.
        ExpandedIERC20 shortToken; // Token used as short in the LSP. Mint and burn rights needed by this contract.
        IERC20 collateralToken; // Collateral token used to back LSP synthetics.
        LongShortPairFinancialProductLibrary financialProductLibrary; // Contract providing settlement payout logic.
        bytes customAncillaryData; // Custom ancillary data to be passed along with the price request to the OO.
        uint256 proposerReward; // Optimistic oracle reward amount, pulled from the caller of the expire function.
        uint256 optimisticOracleLivenessTime; // OO liveness time for price requests.
        uint256 optimisticOracleProposerBond; // OO proposer bond for price requests.
        FinderInterface finder; // DVM finder to find other UMA ecosystem contracts.
        address timerAddress; // Timer used to synchronize contract time in testing. Set to 0x000... in production.
    }

    constructor(ConstructorParams memory params) Testable(params.timerAddress) {
        // During contract construction, set the contract's parameters.
        // If the proposer reward was set then pull it from the caller of the function.
        // requestPrice to OO
        // setEventMarket
        // Set the Optimistic oracle liveness for the price request.
        // Set the Optimistic oracle proposer bond for the price request.

        expirationTimestamp = getCurrentTime(); // Set the request timestamp to the current block timestamp.
        _requestOraclePrice(expirationTimestamp, params.customAncillaryData); // Request the price from the OO.
    }

    // Request a price in the optimistic oracle for a given request timestamp and ancillary data combo. Set the bonds
    // accordingly to the deployer's parameters. Will revert if re-requesting for a previously requested combo.
    function _requestOraclePrice(uint256 _requestTimestamp, bytes memory requestAncillaryData) internal {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // If the proposer reward was set then pull it from the caller of the function.
        if (proposerReward > 0) {
            collateralToken.safeTransferFrom(msg.sender, address(this), proposerReward);
            collateralToken.safeApprove(address(optimisticOracle), proposerReward);
        }
        optimisticOracle.requestPrice(
            priceIdentifier,
            expirationTimestamp,
            requestAncillaryData,
            collateralToken,
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            priceIdentifier,
            expirationTimestamp,
            requestAncillaryData,
            optimisticOracleLivenessTime
        );

        // Set the Optimistic oracle proposer bond for the price request.
        optimisticOracle.setBond(
            priceIdentifier,
            expirationTimestamp,
            requestAncillaryData,
            optimisticOracleProposerBond
        );

        // Make the request an event-based request.
        optimisticOracle.setEventBased(priceIdentifier, expirationTimestamp, requestAncillaryData);
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }
}
