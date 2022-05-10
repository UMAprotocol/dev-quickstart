import { SignerWithAddress, expect, Contract, ethers } from "./utils";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { optimisticDepositBoxFixture } from "./fixtures/OptimisticDepositBox.Fixture";
import { amountToSeedWallets, amountToDeposit } from "./constants";

let optimisticDepositBox: Contract, usdc: Contract, collateralWhitelist: Contract;
let deployer: SignerWithAddress, depositor: SignerWithAddress;

describe("Optimistic Deposit Box Deposit functions", function () {
  beforeEach(async function () {
    [deployer, depositor] = await ethers.getSigners();
    ({ collateralWhitelist } = await umaEcosystemFixture());
    ({ optimisticDepositBox, usdc } = await optimisticDepositBoxFixture());

    // Approve usdc to be whitelisted collateral.
    await collateralWhitelist.connect(deployer).isOnWhitelist(usdc.address);
    // mint some fresh tokens for the depositor.
    await usdc.connect(deployer).mint(depositor.address, amountToSeedWallets);
    // Approve the OptimisticDepositBox to spend tokens
    await usdc.connect(depositor).approve(optimisticDepositBox.address, amountToSeedWallets);
  });
  it("Depositing ERC20 tokens correctly pulls tokens and changes contract state", async function () {
    // Deposits ERC20 tokens into the Optimistic Deposit Box contract
    await expect(optimisticDepositBox.connect(depositor).deposit(amountToDeposit))
      .to.emit(optimisticDepositBox, "Deposit")
      .withArgs(depositor.address, amountToDeposit);

    // The collateral should have transferred from depositor to contract.
    expect(await usdc.balanceOf(depositor.address)).to.equal(amountToSeedWallets.sub(amountToDeposit));
    expect(await usdc.balanceOf(optimisticDepositBox.address)).to.equal(amountToDeposit);

    // getCollateral for user should equal deposit amount.
    expect(await optimisticDepositBox.getCollateral(depositor.address)).to.equal(amountToDeposit);
    expect(await optimisticDepositBox.totalOptimisticDepositBoxCollateral()).to.equal(amountToDeposit);
  });
});
