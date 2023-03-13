// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uma/core/contracts/common/implementation/ExpandedERC20.sol";
import "@uma/core/contracts/common/implementation/Testable.sol";
import "@uma/core/contracts/common/implementation/AddressWhitelist.sol";
import "@uma/core/contracts/oracle/implementation/Constants.sol";

import "@uma/core/contracts/oracle/interfaces/OptimisticOracleV2Interface.sol";
import "@uma/core/contracts/oracle/interfaces/IdentifierWhitelistInterface.sol";

contract EventBasedPredictionMarket is Testable {
    using SafeERC20 for ExpandedERC20;

    /***************************************************
     *  EVENT BASED PREDICTION MARKET DATA STRUCTURES  *
     ***************************************************/
    bool public priceRequested;
    bool public receivedSettlementPrice;

    uint256 public requestTimestamp;
    string public pairName;

    // Number between 0 and 1e18 to allocate collateral between long & short tokens at redemption. 0 entitles each short
    // to 1e18 and each long to 0. 1e18 makes each long worth 1e18 and short 0.
    uint256 public settlementPrice;

    bytes32 public priceIdentifier = "YES_OR_NO_QUERY";

    // Price returned from the Optimistic oracle at settlement time.
    int256 public expiryPrice;

    // External contract interfaces.
    ExpandedERC20 public collateralToken;
    ExpandedIERC20 public longToken;
    ExpandedIERC20 public shortToken;
    FinderInterface public finder;

    // Optimistic oracle customization parameters.
    bytes public customAncillaryData;
    uint256 public proposerReward = 10e18;
    uint256 public optimisticOracleLivenessTime = 3600; // 1 hour
    uint256 public optimisticOracleProposerBond = 500e18;

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
        require(getOptimisticOracle().hasPrice(address(this), priceIdentifier, requestTimestamp, customAncillaryData));
        _;
    }

    modifier requestInitialized() {
        require(priceRequested, "Price not requested");
        _;
    }

    /**
     * @notice Construct the EventBasedPredictionMarket
     * @param _pairName: Name of the long short pair tokens created for the prediction market.
     * @param _collateralToken: Collateral token used to back LSP synthetics.
     * @param _customAncillaryData: Custom ancillary data to be passed along with the price request to the OO.
     * @param _finder: DVM finder to find other UMA ecosystem contracts.
     * @param _timerAddress: Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        string memory _pairName,
        ExpandedERC20 _collateralToken,
        bytes memory _customAncillaryData,
        FinderInterface _finder,
        address _timerAddress
    ) Testable(_timerAddress) {
        finder = _finder;

        require(_getIdentifierWhitelist().isIdentifierSupported(priceIdentifier), "Identifier not registered");
        require(_getAddressWhitelist().isOnWhitelist(address(_collateralToken)), "Unsupported collateral type");

        collateralToken = _collateralToken;
        customAncillaryData = _customAncillaryData;
        pairName = _pairName;

        requestTimestamp = getCurrentTime(); // Set the request timestamp to the current block timestamp.
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
     * @notice Callback function called by the optimistic oracle when a price requested by this contract is settled.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param price price that was resolved by the escalation process.
     */
    function priceSettled(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 price
    ) external {
        OptimisticOracleV2Interface optimisticOracle = getOptimisticOracle();
        require(msg.sender == address(optimisticOracle), "not authorized");

        require(identifier == priceIdentifier, "same identifier");
        require(keccak256(ancillaryData) == keccak256(customAncillaryData), "same ancillary data");

        // We only want to process the price if it is for the current price request.
        if (timestamp != requestTimestamp) return;

        // Calculate the value of settlementPrice using either 0, 0.5e18, or 1e18 as the expiryPrice.
        if (price >= 1e18) {
            settlementPrice = 1e18;
        } else if (price == 5e17) {
            settlementPrice = 5e17;
        } else {
            settlementPrice = 0;
        }

        receivedSettlementPrice = true;
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
        OptimisticOracleV2Interface optimisticOracle = getOptimisticOracle();
        require(msg.sender == address(optimisticOracle), "not authorized");

        require(timestamp == requestTimestamp, "different timestamps");
        require(identifier == priceIdentifier, "same identifier");
        require(keccak256(ancillaryData) == keccak256(customAncillaryData), "same ancillary data");
        require(refund == proposerReward, "same proposerReward amount");

        requestTimestamp = getCurrentTime();
        _requestOraclePrice();
    }

    /****************************************
     *          POSITION FUNCTIONS          *
     ****************************************/

    /**
     * @notice Creates a pair of long and short tokens equal in number to tokensToCreate. Pulls the required collateral.
     * @param tokensToCreate number of long and short synthetic tokens to create.
     */
    function create(uint256 tokensToCreate) public requestInitialized {
        collateralToken.safeTransferFrom(msg.sender, address(this), tokensToCreate);

        require(longToken.mint(msg.sender, tokensToCreate));
        require(shortToken.mint(msg.sender, tokensToCreate));

        emit TokensCreated(msg.sender, tokensToCreate, tokensToCreate);
    }

    /**
     * @notice Redeems a pair of long and short tokens equal in number to tokensToRedeem.
     * Returns the corresponding collateral amount in a 1 to 1 ratio.
     * @param tokensToRedeem number of long and short synthetic tokens to redeem.
     */
    function redeem(uint256 tokensToRedeem) public {
        require(longToken.burnFrom(msg.sender, tokensToRedeem));
        require(shortToken.burnFrom(msg.sender, tokensToRedeem));

        collateralToken.safeTransfer(msg.sender, tokensToRedeem);

        emit TokensRedeemed(msg.sender, tokensToRedeem, tokensToRedeem);
    }

    /**
     * @notice Settle long and/or short tokens in for collateral at a rate informed by the contract settlement.
     * @param longTokensToRedeem number of long tokens to settle.
     * @param shortTokensToRedeem number of short tokens to settle.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        returns (uint256 collateralReturned)
    {
        require(receivedSettlementPrice, "price not yet resolved");

        require(longToken.burnFrom(msg.sender, longTokensToRedeem));
        require(shortToken.burnFrom(msg.sender, shortTokensToRedeem));

        // settlementPrice is a number between 0 and 1e18. 0 means all collateral goes to short tokens and 1e18 means
        // all collateral goes to the long token. Total collateral returned is the sum of payouts.
        uint256 longCollateralRedeemed = (longTokensToRedeem * settlementPrice) / (1e18);
        uint256 shortCollateralRedeemed = (shortTokensToRedeem * (1e18 - settlementPrice)) / (1e18);

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
        OptimisticOracleV2Interface optimisticOracle = getOptimisticOracle();

        collateralToken.safeApprove(address(optimisticOracle), proposerReward);

        optimisticOracle.requestPrice(
            priceIdentifier,
            requestTimestamp,
            customAncillaryData,
            collateralToken,
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            priceIdentifier,
            requestTimestamp,
            customAncillaryData,
            optimisticOracleLivenessTime
        );

        // Set the Optimistic oracle proposer bond for the price request.
        optimisticOracle.setBond(priceIdentifier, requestTimestamp, customAncillaryData, optimisticOracleProposerBond);

        // Make the request an event-based request.
        optimisticOracle.setEventBased(priceIdentifier, requestTimestamp, customAncillaryData);

        // Enable the priceDisputed and priceSettled callback
        optimisticOracle.setCallbacks(priceIdentifier, requestTimestamp, customAncillaryData, false, true, true);

        priceRequested = true;
    }

    /**
     * @notice Get the optimistic oracle.
     * @return optimistic oracle instance.
     */
    function getOptimisticOracle() internal view returns (OptimisticOracleV2Interface) {
        return OptimisticOracleV2Interface(finder.getImplementationAddress("OptimisticOracleV2")); // TODO OracleInterfaces.OptimisticOracleV2
    }

    /**
     * @notice Get the identifier white list.
     * @return identifier whitelist instance.
     */
    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    /**
     * @notice Get the address whitelist
     * @return address whitelist instance.
     */
    function _getAddressWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }
}
