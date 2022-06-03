import { SignerWithAddress, expect, Contract, ethers } from "../utils";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { eventBasedPredictionMarketFixture } from "../fixtures/EventBasedPredictionMarket.Fixture";
import { amountToSeedWallets, amountToDeposit } from "../constants";

let eventBasedPredictionMarket: Contract, usdc: Contract, collateralWhitelist: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress;

describe("EventBasedPredictionMarket functions", function () {
  beforeEach(async function () {
    [deployer, depositor] = await ethers.getSigners();
    ({ collateralWhitelist } = await umaEcosystemFixture());
    ({ eventBasedPredictionMarket, usdc } = await eventBasedPredictionMarketFixture());

    // mint some fresh tokens for the depositor.
    await usdc.connect(deployer).mint(depositor.address, amountToSeedWallets);
    await usdc.connect(deployer).mint(eventBasedPredictionMarket.address, amountToSeedWallets);

    // Approve the EventBasedPredictionMarket to spend tokens
    await usdc.connect(depositor).approve(eventBasedPredictionMarket.address, amountToSeedWallets);

    await eventBasedPredictionMarket.connect(depositor).initializeMarket();
  });
  it("EventBasedPredictionMarket deployment works", async function () {});
});
