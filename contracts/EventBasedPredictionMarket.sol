// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/common/implementation/ExpandedERC20.sol";
import "@uma/core/contracts/common/implementation/FixedPoint.sol";
import "@uma/core/contracts/common/implementation/Testable.sol";
import "@uma/core/contracts/oracle/implementation/Constants.sol";

import "@uma/core/contracts/oracle/interfaces/FinderInterface.sol";
import "@uma/core/contracts/oracle/interfaces/OptimisticOracleInterface.sol";

// TODO use OptimisticOracleInterface from @uma/core once it's updated with setEventBased
interface OptimisticOracleInterfaceEventBased {
    function setEventBased(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external;
}

contract EventBasedPredictionMarket is Testable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for ExpandedERC20;

    /***************************************************
     *  EVENT BASED PREDICTION MARKET DATA STRUCTURES  *
     ***************************************************/
    // Constants
    uint256 ONE_ETHER = 1 ether;

    bool public priceRequested;
    bool public receivedSettlementPrice;

    uint256 public expirationTimestamp;
    string public pairName;
    uint256 public collateralPerPair = ONE_ETHER; // Amount of collateral a pair of tokens is always redeemable for.

    // Number between 0 and 1e18 to allocate collateral between long & short tokens at redemption. 0 entitles each short
    // to collateralPerPair and each long to 0. 1e18 makes each long worth collateralPerPair and short 0.
    uint256 public expiryPercentLong;
    bytes32 public priceIdentifier;

    // Price returned from the Optimistic oracle at settlement time.
    int256 public expiryPrice;
    int256 public strikePrice = int256(ONE_ETHER);

    // External contract interfaces.
    ExpandedERC20 public collateralToken;
    ExpandedIERC20 public longToken;
    ExpandedIERC20 public shortToken;
    FinderInterface public finder;

    // Optimistic oracle customization parameters.
    bytes public customAncillaryData;
    uint256 public proposerReward = 10 ether;
    uint256 public optimisticOracleLivenessTime = 3600; // 1 hour
    uint256 public optimisticOracleProposerBond = 500 ether;

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
        require(_getOO().hasPrice(address(this), priceIdentifier, expirationTimestamp, customAncillaryData));
        _;
    }

    modifier requestInitialized() {
        require(priceRequested, "Price not requested");
        _;
    }

    /**
     * @notice Construct the EventBasedPredictionMarket
     * @param _pairName: Name of the long short pair tokens created for the prediction market.
     * @param _priceIdentifier: Price identifier, registered in the DVM for the long short pair.
     * @param _collateralToken: Collateral token used to back LSP synthetics.
     * @param _customAncillaryData: Custom ancillary data to be passed along with the price request to the OO.
     * @param _finder: DVM finder to find other UMA ecosystem contracts.
     * @param _timerAddress: Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        string memory _pairName,
        bytes32 _priceIdentifier,
        ExpandedERC20 _collateralToken,
        bytes memory _customAncillaryData,
        FinderInterface _finder,
        address _timerAddress
    ) Testable(_timerAddress) {
        expirationTimestamp = getCurrentTime(); // Set the request timestamp to the current block timestamp.

        // Holding long tokens gives the owner exposure to the long position,
        // i.e. the case where the answer to the prediction market question is YES.
        longToken = new ExpandedERC20(string(abi.encodePacked(_pairName, " Long Token")), "PLT", 18);
        // Holding short tokens gives the owner exposure to the short position,
        // i.e. the case where the answer to the prediction market question is NO.
        shortToken = new ExpandedERC20(string(abi.encodePacked(_pairName, " Short Token")), "PST", 18);

        // Add burner and minter required roles to the long and short tokens.
        longToken.addMinter(address(this));
        shortToken.addMinter(address(this));
        longToken.addBurner(address(this));
        shortToken.addBurner(address(this));

        finder = _finder;

        collateralToken = _collateralToken;
        customAncillaryData = _customAncillaryData;
        priceIdentifier = _priceIdentifier;
        pairName = _pairName;
    }

    /**
     * @notice Initialize the market by requesting the price from the optimistic oracle.
     * The caller must have sufficient balance to pay the proposer reward and approve the contract to spend the collateral.
     */
    function initializeMarket() public {
        // If the proposer reward was set then pull it from the caller of the function.
        if (proposerReward > 0) {
            collateralToken.safeTransferFrom(msg.sender, address(this), proposerReward);
        }
        _requestOraclePrice();
    }

    /**
     * @notice Callback function called by the optimistic oracle when a price requested by this contract is disputed.
     * @param identifier The identifier of the price request.
     * @param timestamp The timestamp of the price request.
     * @param ancillaryData Custom ancillary data to be passed along with the price request to the OO.
     * @param refund The amount of collateral refunded to the caller of the price request.
     */
    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund
    ) external {
        OptimisticOracleInterface optimisticOracle = _getOO();
        require(msg.sender == address(optimisticOracle), "not authorized");

        expirationTimestamp = getCurrentTime();
        require(timestamp <= expirationTimestamp, "different timestamps");
        require(identifier == priceIdentifier, "same identifier");
        require(keccak256(ancillaryData) == keccak256(customAncillaryData), "same ancillary data");
        require(refund == proposerReward, "same proposerReward amount");

        _requestOraclePrice();
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
    function create(uint256 tokensToCreate) public requestInitialized returns (uint256 collateralUsed) {
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
    function redeem(uint256 tokensToRedeem) public returns (uint256 collateralReturned) {
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

    /**
     * @notice Request a price in the optimistic oracle for a given request timestamp and ancillary data combo. Set the bonds
     * accordingly to the deployer's parameters. Will revert if re-requesting for a previously requested combo.
     */
    function _requestOraclePrice() internal {
        OptimisticOracleInterface optimisticOracle = _getOO();

        collateralToken.safeApprove(address(optimisticOracle), proposerReward);

        optimisticOracle.requestPrice(
            priceIdentifier,
            expirationTimestamp,
            customAncillaryData,
            collateralToken,
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            priceIdentifier,
            expirationTimestamp,
            customAncillaryData,
            optimisticOracleLivenessTime
        );

        // Set the Optimistic oracle proposer bond for the price request.
        optimisticOracle.setBond(
            priceIdentifier,
            expirationTimestamp,
            customAncillaryData,
            optimisticOracleProposerBond
        );

        // Make the request an event-based request.
        OptimisticOracleInterfaceEventBased(address(optimisticOracle)).setEventBased(
            priceIdentifier,
            expirationTimestamp,
            customAncillaryData
        );

        priceRequested = true;
    }

    /**
     * @notice Returns a number between 0 and 1e18 to indicate how much collateral each long and short token are entitled
     * to per collateralPerPair.
     * @param _expiryPrice price from the optimistic oracle for the LSP price identifier.
     * @return expiryPercentLong to indicate how much collateral should be sent between long and short tokens.
     */
    function percentageLongCollAtExpiry(int256 _expiryPrice) internal view returns (uint256) {
        if (_expiryPrice >= strikePrice) return FixedPoint.fromUnscaledUint(1).rawValue;
        else return FixedPoint.fromUnscaledUint(0).rawValue;
    }

    /**
     * @notice Fetch the optimistic oracle expiration price. If the oracle has the price for the provided expiration timestamp
     * and customData combo then store this. If there is no price revert.
     */
    function getExpirationPrice() internal hasPrice {
        expiryPrice = _getOP(expirationTimestamp, customAncillaryData);

        // Finally, compute the value of expiryPercentLong based on the expiryPrice. Cap the return value at 1e18 as
        // this should, by definition, between 0 and 1e18.
        expiryPercentLong = percentageLongCollAtExpiry(expiryPrice);
        expiryPercentLong = expiryPercentLong < ONE_ETHER ? expiryPercentLong : ONE_ETHER;

        receivedSettlementPrice = true;
    }

    /**
     * @notice Get the optimistic oracle.
     * @return optimistic oracle instance.
     */
    function _getOO() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    /**
     * @notice Return the oracle price for a given request timestamp and ancillary data combo.
     * @param requestTimestamp timestamp of the request.
     * @param requestAncillaryData ancillary data of the request.
     * @return oraclePrice price for the request.
     */
    function _getOP(uint256 requestTimestamp, bytes memory requestAncillaryData) internal returns (int256) {
        return _getOO().settleAndGetPrice(priceIdentifier, requestTimestamp, requestAncillaryData);
    }
}
