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
    const currentTime = await optimisticArbitrator.getCurrentTime();
    const customLiveness = 3600; // 1 hour

    const ancillaryData = ethers.utils.toUtf8Bytes(
      `q: title: Will the price of BTC be $18000.00 or more on October 10, 2022?, description: More info. res_data: p1: 0, p2: 1, p3: 0.5, p4: -57896044618658097711785492504343953926634992332820282019728.792003956564819968. Where p1 corresponds to No, p2 to a Yes, p3 to unknown/tie, and p4 to an early request`
    );

    await optimisticArbitrator.requestPrice(
      currentTime,
      ancillaryData,
      usdc.address,
      hre.ethers.utils.parseUnits("20", await usdc.decimals()),
      hre.ethers.utils.parseUnits("500", await usdc.decimals()),
      customLiveness
    );

    // Proposer proposes a yes answer.
    const tx = await optimisticArbitrator.proposePrice(currentTime, ancillaryData, 1);
    const receipt = await tx.wait();

    const block = await ethers.provider.getBlock(receipt.blockNumber);

    // Set time after liveness
    await optimisticArbitrator.setCurrentTime(block.timestamp + customLiveness);

    // static call arbitrator settleAndGetPrice
    const price = await optimisticArbitrator.callStatic.settleAndGetPrice(currentTime, ancillaryData, {
      from: requester.address,
    });

    // price should be 1
    expect(price).to.equal(1);
  });
});
