import { OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { EventBasedPredictionMarket, ExpandedERC20 } from "../../typechain";
import { amountToSeedWallets } from "../constants";
import { umaEcosystemFixture, eventBasedPredictionMarketFixture, seedAndApprove } from "../fixtures";
import { Contract, ethers, expect, SignerWithAddress, toWei } from "../utils";
import { proposeAndSettleOptimisticOraclePrice } from "./helpers";

let eventBasedPredictionMarket: EventBasedPredictionMarket, usdc: Contract;
let optimisticOracle: OptimisticOracleV2Ethers, longToken: ExpandedERC20, shortToken: ExpandedERC20;
let deployer: SignerWithAddress, sponsor: SignerWithAddress, holder: SignerWithAddress, disputer: SignerWithAddress;

describe("EventBasedPredictionMarket: Unresolved", function () {
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

  it("Unresolved questions pay back 0.5 units of collateral for long and short tokens", async function () {
    await eventBasedPredictionMarket.connect(sponsor).create(toWei(100));
    expect(await longToken.balanceOf(sponsor.address)).to.equal(toWei(100));
    expect(await shortToken.balanceOf(sponsor.address)).to.equal(toWei(100));

    // Propose and settle the optimistic oracle price.
    // In this case we propose as a price that the answer cannot be solved.
    await proposeAndSettleOptimisticOraclePrice(toWei("0.5"), eventBasedPredictionMarket, optimisticOracle);

    // Sponsor redeems his long tokens.
    await eventBasedPredictionMarket.connect(sponsor).settle(toWei("100"), 0);
    expect(await usdc.balanceOf(sponsor.address)).to.equal(amountToSeedWallets.sub(toWei(50)));
    expect(await longToken.balanceOf(holder.address)).to.equal(0);

    // Sponsor redeems his short tokens.
    await eventBasedPredictionMarket.connect(sponsor).settle(0, toWei("100"));
    expect(await usdc.balanceOf(sponsor.address)).to.equal(amountToSeedWallets);
    expect(await shortToken.balanceOf(holder.address)).to.equal(0);
  });
});
