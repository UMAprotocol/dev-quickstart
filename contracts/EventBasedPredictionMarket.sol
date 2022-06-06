// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/common/implementation/Testable.sol";
import "@uma/core/contracts/common/implementation/Lockable.sol";
import "@uma/core/contracts/common/implementation/ExpandedERC20.sol";
import "@uma/core/contracts/common/implementation/FixedPoint.sol";

import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleInterface.sol";
import "@uma/core/contracts/common/interfaces/ExpandedIERC20.sol";
import "@uma/core/contracts/oracle/implementation/Constants.sol";
import "@uma/core/contracts/financial-templates/common/financial-product-libraries/long-short-pair-libraries/BinaryOptionLongShortPairFinancialProductLibrary.sol";

// TODO use OptimisticOracleInterface from @uma/core once it's updated with setEventBased
interface OptimisticOracleInterfaceEventBased {
    function setEventBased(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external;
}

contract EventBasedPredictionMarket is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /*************************************
     *  EVENT BASED PREDICTION MARKET DATA STRUCTURES  *
     *************************************/

    bool public receivedSettlementPrice;

    uint256 public expirationTimestamp;
    string public pairName;
    uint256 public collateralPerPair = 1 ether; // Amount of collateral a pair of tokens is always redeemable for.

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
    BinaryOptionLongShortPairFinancialProductLibrary public financialProductLibrary;

    // Optimistic oracle customization parameters.
    bytes public customAncillaryData;
    uint256 public proposerReward = 10;
    uint256 public optimisticOracleLivenessTime = 60;
    uint256 public optimisticOracleProposerBond = 100;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event TokensCreated(address indexed sponsor, uint256 indexed collateralUsed, uint256 indexed tokensMinted);
    event TokensRedeemed(address indexed sponsor, uint256 indexed collateralReturned, uint256 indexed tokensRedeemed);
    event PositionSettled(address indexed sponsor, uint256 collateralReturned, uint256 longTokens, uint256 shortTokens);

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier hasPrice() {
        require(
            _getOptimisticOracle().hasPrice(address(this), priceIdentifier, expirationTimestamp, customAncillaryData),
            "Only callable if the optimistic oracle has a price for this identifier."
        );
        _;
    }

    modifier priceRequested() {
        require(
            _getOptimisticOracle().getState(address(this), priceIdentifier, expirationTimestamp, customAncillaryData) >
                OptimisticOracleInterface.State.Invalid,
            "Price not requested"
        );
        _;
    }

    // Define the contract's constructor parameters as a struct to enable more variables to be specified.
    struct ConstructorParams {
        string pairName;
        bytes32 priceIdentifier; // Price identifier, registered in the DVM for the long short pair.
        IERC20 collateralToken; // Collateral token used to back LSP synthetics.
        BinaryOptionLongShortPairFinancialProductLibrary financialProductLibrary; // Contract providing settlement payout logic.
        bytes customAncillaryData; // Custom ancillary data to be passed along with the price request to the OO.
        FinderInterface finder; // DVM finder to find other UMA ecosystem contracts.
        address timerAddress; // Timer used to synchronize contract time in testing. Set to 0x000... in production.
    }

    constructor(ConstructorParams memory params) Testable(params.timerAddress) {
        expirationTimestamp = getCurrentTime(); // Set the request timestamp to the current block timestamp.

        longToken = new ExpandedERC20(string(abi.encodePacked(params.pairName, " Long Token")), "PLT", 18);
        shortToken = new ExpandedERC20(string(abi.encodePacked(params.pairName, " Short Token")), "PST", 18);

        // Add burner and minter roles to the long and short tokens.
        longToken.addMinter(address(this));
        shortToken.addMinter(address(this));
        longToken.addBurner(address(this));
        shortToken.addBurner(address(this));

        finder = params.finder;

        collateralToken = params.collateralToken;
        financialProductLibrary = params.financialProductLibrary;
        customAncillaryData = params.customAncillaryData;
        priceIdentifier = params.priceIdentifier;
        pairName = params.pairName;
    }

    // Requests the price from the optimistic oracle
    // The caller must have sufficient balance to pay the proposer reward and approve the contract to spend the collateral.
    function initializeMarket() public {
        _requestOraclePrice(customAncillaryData);
    }

    // Request a price in the optimistic oracle for a given request timestamp and ancillary data combo. Set the bonds
    // accordingly to the deployer's parameters. Will revert if re-requesting for a previously requested combo.
    function _requestOraclePrice(bytes memory requestAncillaryData) internal {
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
        OptimisticOracleInterfaceEventBased(address(optimisticOracle)).setEventBased(
            priceIdentifier,
            expirationTimestamp,
            requestAncillaryData
        );
    }

    /****************************************
     *          POSITION FUNCTIONS          *
     ****************************************/

    /**
     * @notice Creates a pair of long and short tokens equal in number to tokensToCreate. Pulls the required collateral
     * amount into this contract, defined by the collateralPerPair value.
     * @dev The caller must approve this contract to transfer `tokensToCreate * collateralPerPair` amount of collateral.
     * @param tokensToCreate number of long and short synthetic tokens to create.
     * @return collateralUsed total collateral used to mint the synthetics.
     */
    function create(uint256 tokensToCreate) public priceRequested nonReentrant returns (uint256 collateralUsed) {
        // Note the use of mulCeil to prevent small collateralPerPair causing rounding of collateralUsed to 0 enabling
        // callers to mint dust LSP tokens without paying any collateral.
        collateralUsed = FixedPoint.Unsigned(tokensToCreate).mulCeil(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralUsed);

        require(longToken.mint(msg.sender, tokensToCreate));
        require(shortToken.mint(msg.sender, tokensToCreate));

        emit TokensCreated(msg.sender, collateralUsed, tokensToCreate);
    }

    /**
     * @notice Redeems a pair of long and short tokens equal in number to tokensToRedeem. Returns the commensurate
     * amount of collateral to the caller for the pair of tokens, defined by the collateralPerPair value.
     * @dev This contract must have the `Burner` role for the `longToken` and `shortToken` in order to call `burnFrom`.
     * @dev The caller does not need to approve this contract to transfer any amount of `tokensToRedeem` since long
     * and short tokens are burned, rather than transferred, from the caller.
     * @dev This method can be called either pre or post expiration.
     * @param tokensToRedeem number of long and short synthetic tokens to redeem.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function redeem(uint256 tokensToRedeem) public nonReentrant returns (uint256 collateralReturned) {
        require(longToken.burnFrom(msg.sender, tokensToRedeem));
        require(shortToken.burnFrom(msg.sender, tokensToRedeem));

        collateralReturned = FixedPoint.Unsigned(tokensToRedeem).mul(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransfer(msg.sender, collateralReturned);

        emit TokensRedeemed(msg.sender, collateralReturned, tokensToRedeem);
    }

    /**
     * @notice Settle long and/or short tokens in for collateral at a rate informed by the contract settlement.
     * @dev Uses financialProductLibrary to compute the redemption rate between long and short tokens.
     * @dev This contract must have the `Burner` role for the `longToken` and `shortToken` in order to call `burnFrom`.
     * @dev The caller does not need to approve this contract to transfer any amount of `tokensToRedeem` since long
     * and short tokens are burned, rather than transferred, from the caller.
     * @dev This function can be called before or after expiration to facilitate early expiration. If a price has
     * not yet been resolved for either normal or early expiration yet then it will revert.
     * @param longTokensToRedeem number of long tokens to settle.
     * @param shortTokensToRedeem number of short tokens to settle.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        nonReentrant
        returns (uint256 collateralReturned)
    {
        // Get the settlement price and store it. Also sets expiryPercentLong to inform settlement. Reverts if either:
        // a) the price request has not resolved (either a normal expiration call or early expiration call) or b) If the
        // the contract was attempted to be settled early but the price returned is the ignore oracle price.
        // Note that we use the bool receivedSettlementPrice over checking for price != 0 as 0 is a valid price.
        if (!receivedSettlementPrice) getExpirationPrice();

        require(longToken.burnFrom(msg.sender, longTokensToRedeem));
        require(shortToken.burnFrom(msg.sender, shortTokensToRedeem));

        // expiryPercentLong is a number between 0 and 1e18. 0 means all collateral goes to short tokens and 1e18 means
        // all collateral goes to the long token. Total collateral returned is the sum of payouts.
        uint256 longCollateralRedeemed = FixedPoint
            .Unsigned(longTokensToRedeem)
            .mul(FixedPoint.Unsigned(collateralPerPair))
            .mul(FixedPoint.Unsigned(expiryPercentLong))
            .rawValue;
        uint256 shortCollateralRedeemed = FixedPoint
            .Unsigned(shortTokensToRedeem)
            .mul(FixedPoint.Unsigned(collateralPerPair))
            .mul(FixedPoint.fromUnscaledUint(1).sub(FixedPoint.Unsigned(expiryPercentLong)))
            .rawValue;

        collateralReturned = longCollateralRedeemed + shortCollateralRedeemed;
        collateralToken.safeTransfer(msg.sender, collateralReturned);

        emit PositionSettled(msg.sender, collateralReturned, longTokensToRedeem, shortTokensToRedeem);
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // Return the oracle price for a given request timestamp and ancillary data combo.
    function _getOraclePrice(uint256 requestTimestamp, bytes memory requestAncillaryData) internal returns (int256) {
        return _getOptimisticOracle().settleAndGetPrice(priceIdentifier, requestTimestamp, requestAncillaryData);
    }

    // Fetch the optimistic oracle expiration price. If the oracle has the price for the provided expiration timestamp
    // and customData combo then return this. Else, try fetch the price on the early expiration ancillary data. If
    // there is no price for either, revert. If the early expiration price is the ignore price will also revert.
    function getExpirationPrice() internal hasPrice {
        expiryPrice = _getOraclePrice(expirationTimestamp, customAncillaryData);

        // Finally, compute the value of expiryPercentLong based on the expiryPrice. Cap the return value at 1e18 as
        // this should, by definition, between 0 and 1e18.
        expiryPercentLong = Math.min(
            financialProductLibrary.percentageLongCollateralAtExpiry(expiryPrice),
            FixedPoint.fromUnscaledUint(1).rawValue
        );

        receivedSettlementPrice = true;
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }
}
