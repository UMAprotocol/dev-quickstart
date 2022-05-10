import { SignerWithAddress, expect, Contract, ethers } from "./utils";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { optimisticDepositBoxFixture } from "./fixtures/OptimisticDepositBox.Fixture";
import {
  amountToSeedWallets,
  amountToDeposit,
  amountToWithdraw,
  proposalLiveness,
  zeroBytes,
  mockPrice,
  identifier,
} from "./constants";

let optimisticDepositBox: Contract,
  usdc: Contract,
  timer: Contract,
  optimisticOracle: Contract,
  collateralWhitelist: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress, proposer: SignerWithAddress;

describe("Optimistic Deposit Box Withdraw functions", function () {
  beforeEach(async function () {
    [deployer, depositor, proposer] = await ethers.getSigners();
    ({ timer, optimisticOracle, collateralWhitelist } = await umaEcosystemFixture());
    ({ optimisticDepositBox, usdc } = await optimisticDepositBoxFixture());

    // Approve usdc to be whitelisted collateral.
    await collateralWhitelist.connect(deployer).isOnWhitelist(usdc.address);
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

    // now that the time is past the liveness period, the depositor is able to execute withdraw
    await optimisticDepositBox.connect(depositor).executeWithdrawal();

    // now that a withdrawal has been executed, the optimistic oracle returns a price
    expect(
      await optimisticOracle.hasPrice(optimisticDepositBox.address, identifier, requestTimestamp, zeroBytes)
    ).to.equal(true);
  });
});
