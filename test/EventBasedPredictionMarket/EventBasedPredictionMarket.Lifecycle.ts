import { OptimisticOracleV2Ethers, MockOracleAncillaryEthers } from "@uma/contracts-node";
import { EventBasedPredictionMarket, ExpandedERC20 } from "../../typechain";
import { amountToSeedWallets, MIN_INT_VALUE } from "../constants";
import { umaEcosystemFixture, eventBasedPredictionMarketFixture, seedAndApprove } from "../fixtures";
import { Contract, ethers, expect, SignerWithAddress, toWei } from "../utils";
import { proposeAndSettleOptimisticOraclePrice } from "./helpers";

let eventBasedPredictionMarket: EventBasedPredictionMarket, usdc: Contract;
let optimisticOracle: OptimisticOracleV2Ethers, longToken: ExpandedERC20, shortToken: ExpandedERC20;
let deployer: SignerWithAddress, sponsor: SignerWithAddress, holder: SignerWithAddress, disputer: SignerWithAddress;

describe("EventBasedPredictionMarket: Lifecycle", function () {
  beforeEach(async function () {
    // Load accounts and run fixtures to set up tests.
    [deployer, sponsor, holder, disputer] = await ethers.getSigners();
    ({ optimisticOracle } = await umaEcosystemFixture());
    ({ eventBasedPredictionMarket, usdc, longToken, shortToken } = await eventBasedPredictionMarketFixture());

    // Mint some fresh tokens for the sponsor, deployer and disputer.
    await seedAndApprove([sponsor, deployer, disputer], usdc, amountToSeedWallets, eventBasedPredictionMarket.address);
    // Approve the Optimistic Oracle to spend bond tokens from the disputer and deployer.
    await seedAndApprove([disputer, deployer], usdc, amountToSeedWallets, optimisticOracle.address);
    // Initalize the market.
    await eventBasedPredictionMarket.initializeMarket();
  });

  it("Event-based mint, redeem and expire lifecycle", async function () {
    // Create some sponsor tokens. Send half to the holder account.
    expect(await usdc.balanceOf(sponsor.address)).to.equal(amountToSeedWallets);
    expect(await longToken.balanceOf(sponsor.address)).to.equal(0);
    expect(await shortToken.balanceOf(sponsor.address)).to.equal(0);

    await eventBasedPredictionMarket.connect(sponsor).create(toWei(100));
    expect(await longToken.balanceOf(sponsor.address)).to.equal(toWei(100));
    expect(await shortToken.balanceOf(sponsor.address)).to.equal(toWei(100));
    expect(await usdc.balanceOf(sponsor.address)).to.equal(amountToSeedWallets.sub(toWei(100)));

    // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
    await longToken.connect(sponsor).transfer(holder.address, toWei("50"));

    // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
    await eventBasedPredictionMarket.connect(sponsor).redeem(toWei("25"));

    // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
    expect(await usdc.balanceOf(sponsor.address)).to.equal(amountToSeedWallets.sub(toWei(100)).add(toWei(25))); // -100 after mint + 25 redeemed.
    expect(await longToken.balanceOf(sponsor.address)).to.equal(toWei("25"));
    expect(await shortToken.balanceOf(sponsor.address)).to.equal(toWei("75"));

    // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
    await expect(eventBasedPredictionMarket.connect(holder).redeem(toWei(25))).to.be.revertedWith(
      "VM Exception while processing transaction: reverted with reason string 'ERC20: burn amount exceeds balance'"
    );

    // Propose and settle the optimistic oracle price.
    // In this case we are answering a YES_OR_NO_QUERY price request with a YES answer.
    await proposeAndSettleOptimisticOraclePrice(toWei(1), eventBasedPredictionMarket, optimisticOracle);

    // The EventBasedPredictionMarket should have received the settlement price with the priceSettled callback.
    expect(await eventBasedPredictionMarket.receivedSettlementPrice()).to.equal(true);

    // Holder redeems his long tokens.
    await eventBasedPredictionMarket.connect(holder).settle(toWei("50"), 0);
    expect(await eventBasedPredictionMarket.receivedSettlementPrice()).to.equal(true);
    expect(await usdc.balanceOf(holder.address)).to.equal(toWei(50)); // holder should have gotten 1 collateral per synthetic.
    expect(await longToken.balanceOf(holder.address)).to.equal(0); // the long tokens should have been burned.

    // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short.
    // Long tokens should return 25 collateral.
    // Short tokens should return 0 collateral.
    const initialSponsorBalance = await usdc.balanceOf(sponsor.address);
    await eventBasedPredictionMarket.connect(sponsor).settle(toWei("25"), toWei("75"));
    expect(await usdc.balanceOf(sponsor.address)).to.equal(initialSponsorBalance.add(toWei(25)));
    expect(await longToken.balanceOf(sponsor.address)).to.equal(0);
    expect(await shortToken.balanceOf(sponsor.address)).to.equal(0);

    // long short pair should have no collateral left in it as everything has been redeemed.
    expect(await usdc.balanceOf(eventBasedPredictionMarket.address)).to.equal(0);
  });

  it("Early expiring is not allowed", async function () {
    const ancillaryData = await eventBasedPredictionMarket.customAncillaryData();
    const identifier = await eventBasedPredictionMarket.priceIdentifier();
    const requestTimestamp = await eventBasedPredictionMarket.requestTimestamp();

    await expect(
      optimisticOracle.proposePrice(
        eventBasedPredictionMarket.address,
        identifier,
        requestTimestamp,
        ancillaryData,
        MIN_INT_VALUE
      )
    ).to.be.revertedWith(
      "VM Exception while processing transaction: reverted with reason string 'Cannot propose 'too early''"
    );
  });

  it("EventBasedPredictionMarket lifecycle events", async function () {
    await eventBasedPredictionMarket.connect(sponsor).create(toWei(100));

    const createEvents = await eventBasedPredictionMarket.queryFilter(
      eventBasedPredictionMarket.filters.TokensCreated()
    );
    expect(createEvents[0].args.sponsor === sponsor.address);

    // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
    await longToken.connect(sponsor).transfer(holder.address, toWei("50"));

    // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
    await eventBasedPredictionMarket.connect(sponsor).redeem(toWei("25"));

    const tokensRedeemedEvents = await eventBasedPredictionMarket.queryFilter(
      eventBasedPredictionMarket.filters.TokensRedeemed()
    );
    expect(tokensRedeemedEvents[0].args.sponsor === sponsor.address);

    await proposeAndSettleOptimisticOraclePrice(toWei(1), eventBasedPredictionMarket, optimisticOracle);

    // Holder redeems his long tokens.
    await eventBasedPredictionMarket.connect(holder).settle(toWei("50"), 0);

    const positionSettledEvents = await eventBasedPredictionMarket.queryFilter(
      eventBasedPredictionMarket.filters.PositionSettled()
    );
    expect(positionSettledEvents[0].args.sponsor === holder.address);
  });
});
