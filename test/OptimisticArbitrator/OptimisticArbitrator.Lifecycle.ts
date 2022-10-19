import {
  ExpandedERC20Ethers,
  MockOracleAncillaryEthers,
  OptimisticOracleV2Ethers,
  StoreEthers,
} from "@uma/contracts-node";
import { OptimisticArbitrator } from "../../typechain";
import { optimisticArbitratorFixture, seedAndApprove, umaEcosystemFixture } from "../fixtures";
import { ethers, expect, SignerWithAddress } from "../utils";

let optimisticArbitrator: OptimisticArbitrator, usdc: ExpandedERC20Ethers;
let optimisticOracle: OptimisticOracleV2Ethers, store: StoreEthers, mockOracle: MockOracleAncillaryEthers;
let deployer: SignerWithAddress;

describe("OptimisticArbitrator: Lifecycle", function () {
  beforeEach(async function () {
    // Load accounts and run fixtures to set up tests.
    [deployer] = await ethers.getSigners();
    ({ optimisticOracle, mockOracle, store } = await umaEcosystemFixture());
    ({ optimisticArbitrator, usdc } = await optimisticArbitratorFixture());

    const amountToSeedWallets = ethers.utils.parseUnits("100000", await usdc.decimals()); // 10000 USDC

    // Set the final fee in the store
    store.setFinalFee(usdc.address, { rawValue: ethers.utils.parseUnits("1500", await usdc.decimals()) });

    // Mint some fresh tokens for the deployer.
    await seedAndApprove([deployer], usdc, amountToSeedWallets, optimisticArbitrator.address);
  });

  it("Happy path", async function () {
    const requestTimestamp = await optimisticArbitrator.getCurrentTime();
    await optimisticOracle.setCurrentTime(requestTimestamp);

    const balanceBefore = await usdc.balanceOf(deployer.address);

    const liveness = 3600; // 1 hour

    const ancillaryData = ethers.utils.toUtf8Bytes(
      `q: title: Will the price of BTC be $18000.00 or more on October 10, 2022?, description: More info. res_data: p1: 0, p2: 1, p3: 0.5, p4: -57896044618658097711785492504343953926634992332820282019728.792003956564819968. Where p1 corresponds to No, p2 to a Yes, p3 to unknown/tie, and p4 to an early request`
    );

    const tx = await optimisticArbitrator.makeAssertion(
      requestTimestamp,
      ancillaryData,
      1,
      ethers.utils.parseUnits("20", await usdc.decimals()),
      ethers.utils.parseUnits("500", await usdc.decimals()),
      liveness
    );

    const receipt = await tx.wait();

    const block = await ethers.provider.getBlock(receipt.blockNumber);

    // Set time after liveness
    await optimisticOracle.setCurrentTime(block.timestamp + liveness * 20);

    await optimisticOracle.settle(
      optimisticArbitrator.address,
      await optimisticArbitrator.priceIdentifier(),
      requestTimestamp,
      ancillaryData
    );

    expect((await optimisticArbitrator.getTruth(requestTimestamp, ancillaryData)).toNumber()).to.equal(1);
    expect(await usdc.balanceOf(deployer.address)).to.equal(balanceBefore);
  });

  it("Assert then ratify", async function () {
    const requestTimestamp = await optimisticArbitrator.getCurrentTime();
    await optimisticOracle.setCurrentTime(requestTimestamp);

    const balanceBefore = await usdc.balanceOf(deployer.address);

    const bond = ethers.utils.parseUnits("500", await usdc.decimals());

    const liveness = 3600; // 1 hour

    const ancillaryData = ethers.utils.toUtf8Bytes(
      `q: title: Will the price of BTC be $18000.00 or more on October 10, 2022?, description: More info. res_data: p1: 0, p2: 1, p3: 0.5, p4: -57896044618658097711785492504343953926634992332820282019728.792003956564819968. Where p1 corresponds to No, p2 to a Yes, p3 to unknown/tie, and p4 to an early request`
    );

    await optimisticArbitrator.makeAssertion(
      requestTimestamp,
      ancillaryData,
      1,
      ethers.utils.parseUnits("20", await usdc.decimals()),
      bond,
      liveness
    );

    await optimisticArbitrator.ratifyAssertion(requestTimestamp, ancillaryData);

    // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      0
    );

    await optimisticOracle.settle(
      optimisticArbitrator.address,
      await optimisticArbitrator.priceIdentifier(),
      requestTimestamp,
      ancillaryData
    );

    expect((await optimisticArbitrator.getTruth(requestTimestamp, ancillaryData)).toNumber()).to.equal(0);

    const expectedCost = await (await store.finalFees(usdc.address)).add(bond.div(2));
    expect(await usdc.balanceOf(deployer.address)).to.equal(balanceBefore.sub(expectedCost));
  });

  it("Assert and ratify", async function () {
    const requestTimestamp = await optimisticArbitrator.getCurrentTime();
    await optimisticOracle.setCurrentTime(requestTimestamp);

    const liveness = 3600; // 1 hour

    const ancillaryData = ethers.utils.toUtf8Bytes(
      `q: title: Will the price of BTC be $18000.00 or more on October 10, 2022?, description: More info. res_data: p1: 0, p2: 1, p3: 0.5, p4: -57896044618658097711785492504343953926634992332820282019728.792003956564819968. Where p1 corresponds to No, p2 to a Yes, p3 to unknown/tie, and p4 to an early request`
    );

    await optimisticArbitrator.assertAndRatify(
      requestTimestamp,
      ancillaryData,
      1,
      ethers.utils.parseUnits("20", await usdc.decimals()),
      ethers.utils.parseUnits("500", await usdc.decimals()),
      liveness
    );

    // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      1
    );

    await optimisticOracle.settle(
      optimisticArbitrator.address,
      await optimisticArbitrator.priceIdentifier(),
      requestTimestamp,
      ancillaryData
    );

    expect((await optimisticArbitrator.getTruth(requestTimestamp, ancillaryData)).toNumber()).to.equal(1);
  });
});
