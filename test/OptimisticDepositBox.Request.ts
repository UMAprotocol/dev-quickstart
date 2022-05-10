import { SignerWithAddress, expect, Contract, ethers } from "./utils";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { optimisticDepositBoxFixture } from "./fixtures/OptimisticDepositBox.Fixture";
import { amountToSeedWallets, amountToWithdraw, amountToDeposit, zeroBytes, identifier } from "./constants";

let optimisticDepositBox: Contract, usdc: Contract, optimisticOracle: Contract, collateralWhitelist: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress, proposer: SignerWithAddress;

describe("Optimistic Deposit Box Request functions", function () {
  beforeEach(async function () {
    [deployer, depositor, proposer] = await ethers.getSigners();
    ({ optimisticOracle, collateralWhitelist } = await umaEcosystemFixture());
    ({ optimisticDepositBox, usdc } = await optimisticDepositBoxFixture());

    // approve usdc to be whitelisted collateral.
    await collateralWhitelist.connect(deployer).isOnWhitelist(usdc.address);
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
});
