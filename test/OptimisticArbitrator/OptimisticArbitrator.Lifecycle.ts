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
let deployer: SignerWithAddress, ancillaryData: Uint8Array, liveness: number;

const YES_ANSWER = ethers.utils.parseEther("1");

describe("OptimisticArbitrator: Lifecycle", function () {
  beforeEach(async function () {
    // Load accounts and run fixtures to set up tests.
    [deployer] = await ethers.getSigners();
    ({ optimisticOracle, mockOracle, store } = await umaEcosystemFixture());
    ({ optimisticArbitrator, usdc } = await optimisticArbitratorFixture());

    const amountToSeedWallets = ethers.utils.parseUnits("100000", await usdc.decimals()); // 10000 USDC

    liveness = 3600; // 1 hour

    ancillaryData = ethers.utils.toUtf8Bytes(
      `q: The price of BTC was above 18000 USD for the duration of October 10 2022 UTC time considering top 5 volume weighted markets`
    );

    // Set the final fee in the store
    await store.setFinalFee(usdc.address, { rawValue: ethers.utils.parseUnits("1500", await usdc.decimals()) });

    // Mint some fresh tokens for the deployer.
    await seedAndApprove([deployer], usdc, amountToSeedWallets, optimisticArbitrator.address);
  });

  it("Assert happy path", async function () {
    // get block timestamp
    const requestTimestamp = await (await ethers.provider.getBlock("latest")).timestamp;
    await optimisticOracle.setCurrentTime(requestTimestamp);

    const balanceBefore = await usdc.balanceOf(deployer.address);

    const tx = await optimisticArbitrator.makeAssertion(
      requestTimestamp,
      ancillaryData,
      YES_ANSWER,
      ethers.utils.parseUnits("500", await usdc.decimals()),
      liveness
    );

    const receipt = await tx.wait();

    const block = await ethers.provider.getBlock(receipt.blockNumber);

    // Set time after liveness
    await optimisticOracle.setCurrentTime(block.timestamp + liveness * 20);

    optimisticArbitrator.settleAndGetResult(requestTimestamp, ancillaryData);

    expect(await (await optimisticArbitrator.getResult(requestTimestamp, ancillaryData)).eq(YES_ANSWER));
    expect(await usdc.balanceOf(deployer.address)).to.equal(balanceBefore);
  });

  it("Assert then ratify", async function () {
    const requestTimestamp = await (await ethers.provider.getBlock("latest")).timestamp;
    await optimisticOracle.setCurrentTime(requestTimestamp);

    const balanceBefore = await usdc.balanceOf(deployer.address);

    const bond = ethers.utils.parseUnits("500", await usdc.decimals());

    await optimisticArbitrator.makeAssertion(requestTimestamp, ancillaryData, YES_ANSWER, bond, liveness);

    await optimisticArbitrator.ratifyAssertion(requestTimestamp, ancillaryData);

    // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      0
    );

    await optimisticArbitrator.settleAndGetResult(requestTimestamp, ancillaryData);

    expect((await optimisticArbitrator.getResult(requestTimestamp, ancillaryData)).eq(0));

    const expectedCost = await (await store.finalFees(usdc.address)).add(bond.div(2));
    expect(await usdc.balanceOf(deployer.address)).to.equal(balanceBefore.sub(expectedCost));
  });

  it("Assert and ratify", async function () {
    const requestTimestamp = await (await ethers.provider.getBlock("latest")).timestamp;
    await optimisticOracle.setCurrentTime(requestTimestamp);
    const balanceBefore = await usdc.balanceOf(deployer.address);

    await optimisticArbitrator.assertAndRatify(requestTimestamp, ancillaryData, YES_ANSWER);

    // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      YES_ANSWER
    );

    optimisticArbitrator.settleAndGetResult(requestTimestamp, ancillaryData);

    expect(await (await optimisticArbitrator.getResult(requestTimestamp, ancillaryData)).eq(YES_ANSWER));
    const expectedCost = await await store.finalFees(usdc.address);
    expect(await usdc.balanceOf(deployer.address)).to.equal(balanceBefore.sub(expectedCost));
  });
});
