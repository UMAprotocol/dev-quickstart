import { SignerWithAddress, expect, Contract, ethers } from "../utils";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { optimisticDepositBoxFixture } from "../fixtures/OptimisticDepositBox.Fixture";
import { amountToSeedWallets, amountToDeposit, amountToWithdraw, proposalLiveness } from "../constants";
import { zeroBytes, mockPrice, identifier } from "../constants";

let optimisticDepositBox: Contract, usdc: Contract, timer: Contract, optimisticOracle: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress, proposer: SignerWithAddress;

describe("Optimistic Deposit Box: Withdraw", function () {
  beforeEach(async function () {
    [deployer, depositor, proposer] = await ethers.getSigners();
    ({ timer, optimisticOracle } = await umaEcosystemFixture());
    ({ optimisticDepositBox, usdc } = await optimisticDepositBoxFixture());

    // mint some fresh tokens for the depositor.
    await usdc.connect(deployer).mint(depositor.address, amountToSeedWallets);
    // Approve the OptimisticDepositBox to spend tokens
    await usdc.connect(depositor).approve(optimisticDepositBox.address, amountToSeedWallets);
    // deposit USDC into the contract
    await optimisticDepositBox.connect(depositor).deposit(amountToDeposit);
    // submit a withdraw request from the OO contract
    await optimisticDepositBox.connect(depositor).requestWithdrawal(amountToWithdraw);
    // propose a price
    const requestTimestamp = await optimisticDepositBox.connect(deployer).getCurrentTime();
    await optimisticOracle
      .connect(proposer)
      .proposePriceFor(
        proposer.address,
        optimisticDepositBox.address,
        identifier,
        requestTimestamp,
        zeroBytes,
        mockPrice
      );
  });
  it("Execute withdraw from Optimistic Deposit Box contract", async function () {
    // get request timestamp and speeed up time past liveness period
    const requestTimestamp = await optimisticDepositBox.connect(deployer).getCurrentTime();
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + proposalLiveness + 1);

    expect(await optimisticDepositBox.totalOptimisticDepositBoxCollateral()).to.equal(amountToDeposit);
    expect(await optimisticDepositBox.getCollateral(depositor.address)).to.equal(amountToDeposit);

    // now that the time is past the liveness period, the depositor is able to execute withdraw
    await optimisticDepositBox.connect(depositor).executeWithdrawal();

    expect(await optimisticDepositBox.totalOptimisticDepositBoxCollateral()).to.equal(
      amountToDeposit.sub(amountToWithdraw)
    );
    expect(await optimisticDepositBox.getCollateral(depositor.address)).to.equal(amountToDeposit.sub(amountToWithdraw));

    // now that a withdrawal has been executed, the optimistic oracle returns a price
    expect(
      await optimisticOracle.hasPrice(optimisticDepositBox.address, identifier, requestTimestamp, zeroBytes)
    ).to.equal(true);
  });
  it("Execute withdraw before liveness period is complete", async function () {
    // A withdraw can't be executed until after the liveness period is complete
    await expect(optimisticDepositBox.connect(depositor).executeWithdrawal()).to.be.revertedWith(
      "Unresolved oracle price"
    );
  });
  it("Cancel Withdraw after a request has been made", async function () {
    // Tests the cancelWithdrawal method to cancel a withdraw
    await optimisticDepositBox.connect(depositor).cancelWithdrawal();
  });
  it("Contract checks the withdrawalRequestTimestamp is before the currentTimestamp", async function () {
    const requestTimestamp = await optimisticDepositBox.connect(deployer).getCurrentTime();
    await timer.setCurrentTime(requestTimestamp - 1);

    await expect(optimisticDepositBox.connect(depositor).executeWithdrawal()).to.be.revertedWith(
      "Invalid withdraw request"
    );
  });
});
