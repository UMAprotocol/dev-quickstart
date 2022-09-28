import { SignerWithAddress, expect, Contract, ethers } from "../utils";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { optimisticDepositBoxFixture } from "../fixtures/OptimisticDepositBox.Fixture";
import { amountToSeedWallets, amountToDeposit, amountToWithdraw, zeroBytes, mockPrice, identifier } from "../constants";

let optimisticDepositBox: Contract, usdc: Contract, optimisticOracle: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress, proposer: SignerWithAddress;

describe("Optimistic Deposit Box: Proposal", function () {
  beforeEach(async function () {
    [deployer, depositor, proposer] = await ethers.getSigners();
    ({ optimisticOracle } = await umaEcosystemFixture());
    ({ optimisticDepositBox, usdc } = await optimisticDepositBoxFixture());

    // mint some fresh tokens for the depositor.
    await usdc.connect(deployer).mint(depositor.address, amountToSeedWallets);
    // Approve the OptimisticDepositBox to spend tokens
    await usdc.connect(depositor).approve(optimisticDepositBox.address, amountToSeedWallets);
    // deposit USDC into the contract
    await optimisticDepositBox.connect(depositor).deposit(amountToDeposit);
    // request a price from the OO contract
    await optimisticDepositBox.connect(depositor).requestWithdrawal(amountToWithdraw);
  });
  it("Submit a price proposal to Optimistic Oracle contract", async function () {
    const requestTimestamp = await optimisticDepositBox.connect(deployer).getCurrentTime();
    await expect(
      optimisticOracle
        .connect(proposer)
        .proposePriceFor(
          proposer.address,
          optimisticDepositBox.address,
          identifier,
          requestTimestamp,
          zeroBytes,
          mockPrice
        )
    );

    // the contract state stays 1 and the hasPrice method is still false until the depositor settles the contract
    expect(
      await optimisticOracle.getState(optimisticDepositBox.address, identifier, requestTimestamp, zeroBytes)
    ).to.equal(1);
    expect(
      await optimisticOracle.hasPrice(optimisticDepositBox.address, identifier, requestTimestamp, zeroBytes)
    ).to.equal(false);
  });
});
