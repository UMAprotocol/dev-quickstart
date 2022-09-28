import { SignerWithAddress, expect, Contract, ethers } from "../utils";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { optimisticDepositBoxFixture } from "../fixtures/OptimisticDepositBox.Fixture";
import { amountToSeedWallets, amountToWithdraw, amountToDeposit, zeroBytes, identifier } from "../constants";

let optimisticDepositBox: Contract, usdc: Contract, optimisticOracle: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress, proposer: SignerWithAddress;

describe("Optimistic Deposit Box: Request", function () {
  beforeEach(async function () {
    [deployer, depositor, proposer] = await ethers.getSigners();
    ({ optimisticOracle } = await umaEcosystemFixture());
    ({ optimisticDepositBox, usdc } = await optimisticDepositBoxFixture());

    // mint some fresh tokens for the depositor.
    await usdc.connect(deployer).mint(depositor.address, amountToSeedWallets);
    // approve the OptimisticDepositBox to spend tokens
    await usdc.connect(depositor).approve(optimisticDepositBox.address, amountToSeedWallets);
    // deposit USDC into the contract
    await optimisticDepositBox.connect(depositor).deposit(amountToDeposit);
  });
  it("Withdraw sends price request to Optimistic Oracle contract", async function () {
    // for testing, the request timestamp will be the current time
    const requestTimestamp = await optimisticDepositBox.connect(deployer).getCurrentTime();
    await expect(optimisticDepositBox.connect(depositor).requestWithdrawal(amountToWithdraw))
      .to.emit(optimisticDepositBox, "RequestWithdrawal")
      .withArgs(depositor.address, amountToWithdraw, requestTimestamp);

    // A price request should be made to the Optimistic Oracle contract.
    // The contract state should be 1 as a price has not been resolved from the Oracle contract and settled
    expect(
      await optimisticOracle.getState(optimisticDepositBox.address, identifier, requestTimestamp, zeroBytes)
    ).to.equal(1);
    expect(
      await optimisticOracle.hasPrice(optimisticDepositBox.address, identifier, requestTimestamp, zeroBytes)
    ).to.equal(false);
  });
  it("Requests a denominated collateral amount of 0", async function () {
    // collateral deposit amount should be above 0
    await expect(optimisticDepositBox.connect(depositor).requestWithdrawal("0")).to.be.revertedWith(
      "Invalid collateral amount"
    );
  });
  it("cancelWithdrawal is called without a pending withdrawal", async function () {
    // Contract checks for a pending withdrawal request.
    await expect(optimisticDepositBox.connect(depositor).cancelWithdrawal()).to.be.revertedWith(
      "No pending withdrawal"
    );
  });
});
