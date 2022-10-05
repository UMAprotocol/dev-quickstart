import { OptimisticOracleV2Ethers, MockOracleAncillaryEthers } from "@uma/contracts-node";
import { EventBasedPredictionMarket } from "../../typechain";
import { amountToSeedWallets } from "../constants";
import { umaEcosystemFixture, eventBasedPredictionMarketFixture, seedAndApprove } from "../fixtures";
import { Contract, ethers, expect, SignerWithAddress, toWei } from "../utils";
import { proposeAndSettleOptimisticOraclePrice } from "./helpers";

let eventBasedPredictionMarket: EventBasedPredictionMarket, usdc: Contract;
let optimisticOracle: OptimisticOracleV2Ethers, mockOracle: MockOracleAncillaryEthers;
let deployer: SignerWithAddress, sponsor: SignerWithAddress, holder: SignerWithAddress, disputer: SignerWithAddress;

describe("EventBasedPredictionMarket: Dispute", function () {
  beforeEach(async function () {
    // Load accounts and run fixtures to set up tests.
    [deployer, sponsor, holder, disputer] = await ethers.getSigners();
    ({ optimisticOracle, mockOracle } = await umaEcosystemFixture());
    ({ eventBasedPredictionMarket, usdc } = await eventBasedPredictionMarketFixture());

    // Mint some fresh tokens for the sponsor, deployer and disputer.
    await seedAndApprove([sponsor, deployer, disputer], usdc, amountToSeedWallets, eventBasedPredictionMarket.address);
    // Approve the Optimistic Oracle to spend bond tokens from the disputer and deployer.
    await seedAndApprove([disputer, deployer], usdc, amountToSeedWallets, optimisticOracle.address);
    // Initalize the market.
    await eventBasedPredictionMarket.initializeMarket();
  });

  it("Event-based dispute workflow with auto re-request on dispute", async function () {
    const requestSubmissionTimestamp = await eventBasedPredictionMarket.requestTimestamp();
    const proposalSubmissionTimestamp = parseInt(requestSubmissionTimestamp.toString()) + 100;
    await optimisticOracle.setCurrentTime(proposalSubmissionTimestamp);

    const ancillaryData = await eventBasedPredictionMarket.customAncillaryData();
    const identifier = await eventBasedPredictionMarket.priceIdentifier();
    const requestTimestamp = await eventBasedPredictionMarket.requestTimestamp();

    await optimisticOracle.proposePrice(
      eventBasedPredictionMarket.address,
      identifier,
      requestTimestamp,
      ancillaryData,
      0
    );

    const disputeSubmissionTimestamp = proposalSubmissionTimestamp + 100;
    await optimisticOracle.setCurrentTime(disputeSubmissionTimestamp);
    await optimisticOracle
      .connect(disputer)
      .disputePrice(eventBasedPredictionMarket.address, identifier, requestTimestamp, ancillaryData);

    // Check that the price has been re-requested with a new expiration timestamp corresponding to the dispute timestamp.
    expect(await eventBasedPredictionMarket.requestTimestamp()).to.equal(disputeSubmissionTimestamp);
    expect(await usdc.balanceOf(eventBasedPredictionMarket.address)).to.equal(0);

    // Sponsor creates some Long short tokens
    await eventBasedPredictionMarket.connect(sponsor).create(toWei(100));

    // Propose and settle a new undisputed price
    await proposeAndSettleOptimisticOraclePrice(toWei(1), eventBasedPredictionMarket, optimisticOracle);

    // Check that the price has been settled and Long short tokens can be refunded.
    const sponsorInitialBalance = await usdc.balanceOf(sponsor.address);
    await eventBasedPredictionMarket.connect(sponsor).settle(toWei("100"), toWei("0"));
    expect(await usdc.balanceOf(sponsor.address)).to.equal(sponsorInitialBalance.add(toWei(100)));
  });

  it("Rejected disputed price requests are not processed but can settle in OOV2", async function () {
    const requestSubmissionTimestamp = await eventBasedPredictionMarket.requestTimestamp();
    const proposalSubmissionTimestamp = parseInt(requestSubmissionTimestamp.toString()) + 100;
    await optimisticOracle.setCurrentTime(proposalSubmissionTimestamp);

    const ancillaryData = await eventBasedPredictionMarket.customAncillaryData();
    const identifier = await eventBasedPredictionMarket.priceIdentifier();
    const requestTimestamp = await eventBasedPredictionMarket.requestTimestamp();

    // Sponsor creates some Long short tokens
    await eventBasedPredictionMarket.connect(sponsor).create(toWei(100));

    await optimisticOracle.proposePrice(
      eventBasedPredictionMarket.address,
      identifier,
      requestTimestamp,
      ancillaryData,
      0
    );

    const disputeSubmissionTimestamp = proposalSubmissionTimestamp + 100;
    await optimisticOracle.setCurrentTime(disputeSubmissionTimestamp);
    await optimisticOracle
      .connect(disputer)
      .disputePrice(eventBasedPredictionMarket.address, identifier, requestTimestamp, ancillaryData);

    // Check that the price has been re-requested with a new expiration timestamp corresponding to the dispute timestamp.
    expect(await eventBasedPredictionMarket.requestTimestamp()).to.equal(disputeSubmissionTimestamp);

    // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(identifier, disputedPriceRequest.args.time, disputedPriceRequest.args.ancillaryData, 0);

    // The original price request is not processed anymore as a second price request has been added.
    await optimisticOracle.settle(eventBasedPredictionMarket.address, identifier, requestTimestamp, ancillaryData);
    const settled = await eventBasedPredictionMarket.receivedSettlementPrice();
    expect(settled).to.equal(false);

    // Finally, the second price request to the OO is proposed and settled.
    const previousSettlePrice = await eventBasedPredictionMarket.settlementPrice();
    await proposeAndSettleOptimisticOraclePrice(toWei(0), eventBasedPredictionMarket, optimisticOracle);
    expect(await eventBasedPredictionMarket.settlementPrice()).to.equal(previousSettlePrice);

    // Check that the price has been settled and Long short tokens can be refunded.
    const sponsorInitialBalance = await usdc.balanceOf(sponsor.address);
    await eventBasedPredictionMarket.connect(sponsor).settle(toWei("0"), toWei("100"));
    expect(await usdc.balanceOf(sponsor.address)).to.equal(sponsorInitialBalance.add(toWei(100)));
  });
});
