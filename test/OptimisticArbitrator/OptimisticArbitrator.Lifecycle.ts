import {
  ExpandedERC20Ethers,
  MockOracleAncillaryEthers,
  OptimisticOracleV2Ethers,
  StoreEthers,
} from "@uma/contracts-node";
import { OptimisticArbitrator } from "../../typechain";
import { optimisticArbitratorFixture, seedAndApprove, umaEcosystemFixture } from "../fixtures";
import { ethers, expect, SignerWithAddress } from "../utils";
import hre from "hardhat";

let optimisticArbitrator: OptimisticArbitrator, usdc: ExpandedERC20Ethers;
let optimisticOracle: OptimisticOracleV2Ethers, store: StoreEthers, mockOracle: MockOracleAncillaryEthers;
let requester: SignerWithAddress, proposer: SignerWithAddress, disputer: SignerWithAddress;

describe("OptimisticArbitrator: Lifecycle", function () {
  beforeEach(async function () {
    // Load accounts and run fixtures to set up tests.
    [requester, proposer, disputer] = await ethers.getSigners();
    ({ optimisticOracle, mockOracle, store } = await umaEcosystemFixture());
    ({ optimisticArbitrator, usdc } = await optimisticArbitratorFixture());

    const amountToSeedWallets = hre.ethers.utils.parseUnits("100000", await usdc.decimals()); // 10000 USDC

    // Set the final fee in the store
    store.setFinalFee(usdc.address, { rawValue: hre.ethers.utils.parseUnits("1500", await usdc.decimals()) });

    // Mint some fresh tokens for the requester, requester and disputer.
    await seedAndApprove([requester, disputer], usdc, amountToSeedWallets, optimisticArbitrator.address);
    // Approve the Optimistic Oracle to spend bond tokens from the disputer and requester.
    await seedAndApprove([disputer, requester], usdc, amountToSeedWallets, optimisticOracle.address);
  });

  it("Happy path", async function () {
    const requestTimestamp = await optimisticArbitrator.getCurrentTime();
    const customLiveness = 3600; // 1 hour

    const ancillaryData = ethers.utils.toUtf8Bytes(
      `q: title: Will the price of BTC be $18000.00 or more on October 10, 2022?, description: More info. res_data: p1: 0, p2: 1, p3: 0.5, p4: -57896044618658097711785492504343953926634992332820282019728.792003956564819968. Where p1 corresponds to No, p2 to a Yes, p3 to unknown/tie, and p4 to an early request`
    );

    await optimisticArbitrator.requestPrice(
      requestTimestamp,
      ancillaryData,
      usdc.address,
      hre.ethers.utils.parseUnits("20", await usdc.decimals()),
      hre.ethers.utils.parseUnits("500", await usdc.decimals()),
      customLiveness
    );

    // Proposer proposes a yes answer.
    const tx = await optimisticArbitrator.proposePrice(requestTimestamp, ancillaryData, 1);
    const receipt = await tx.wait();

    const block = await ethers.provider.getBlock(receipt.blockNumber);

    // Set time after liveness
    await optimisticArbitrator.setCurrentTime(block.timestamp + customLiveness);

    // Settle and get price
    await optimisticArbitrator.settleAndGetPrice(requestTimestamp, ancillaryData);

    expect((await optimisticArbitrator.getPrice(requestTimestamp, ancillaryData)).toNumber()).to.equal(1);
  });

  it("Dispute with dvm arbitration", async function () {
    const requestTimestamp = await optimisticArbitrator.getCurrentTime();
    const customLiveness = 3600; // 1 hour

    const ancillaryData = ethers.utils.toUtf8Bytes(
      `q: title: Will the price of BTC be $18000.00 or more on October 10, 2022?, description: More info. res_data: p1: 0, p2: 1, p3: 0.5, p4: -57896044618658097711785492504343953926634992332820282019728.792003956564819968. Where p1 corresponds to No, p2 to a Yes, p3 to unknown/tie, and p4 to an early request`
    );

    const balanceBefore = await usdc.balanceOf(requester.address);

    const bond = hre.ethers.utils.parseUnits("0", await usdc.decimals());

    await optimisticArbitrator.requestPrice(
      requestTimestamp,
      ancillaryData,
      usdc.address,
      hre.ethers.utils.parseUnits("20", await usdc.decimals()),
      bond,
      customLiveness
    );

    // Proposer proposes a no anwser
    await optimisticArbitrator.proposePrice(requestTimestamp, ancillaryData, 0);

    // Disputer disputes the proposal
    await optimisticArbitrator.disputePrice(requestTimestamp, ancillaryData);

    // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    const tx = await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      0
    );
    const receipt = await tx.wait();

    // Set time after liveness
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    await optimisticArbitrator.setCurrentTime(block.timestamp + (await optimisticOracle.defaultLiveness()).toNumber());

    // Dispute is resolved by the DVM
    await optimisticOracle.settle(
      optimisticArbitrator.address,
      await optimisticArbitrator.priceIdentifier(),
      requestTimestamp,
      ancillaryData
    );

    const storeFinalFee = await store.computeFinalFee(usdc.address);

    const finalCost = storeFinalFee.rawValue.add(bond.div(2));

    expect(finalCost).to.equal(balanceBefore.sub(await usdc.balanceOf(requester.address)));

    expect(finalCost).to.equal(await usdc.balanceOf(store.address));
  });
});
