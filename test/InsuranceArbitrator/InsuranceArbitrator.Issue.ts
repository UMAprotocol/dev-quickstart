import { ZERO_ADDRESS } from "@uma/common";
import { ExpandedERC20Ethers } from "@uma/contracts-node";
import { insuranceArbitratorFixture } from "../fixtures/InsuranceArbitrator.Fixture";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { anyValue, BigNumber, expect, ethers, SignerWithAddress } from "../utils";
import { InsuranceArbitrator } from "../../typechain";
import { insuredAmount, insuredEvent } from "./constants";
import { getPolicyIdFromTx } from "./utils";

let insuranceArbitrator: InsuranceArbitrator, usdc: ExpandedERC20Ethers;
let deployer: SignerWithAddress, insurer: SignerWithAddress, insured: SignerWithAddress;

describe("Insurance Arbitrator: Issue", function () {
  beforeEach(async function () {
    [deployer, insurer, insured] = await ethers.getSigners();
    await umaEcosystemFixture();
    ({ usdc, insuranceArbitrator } = await insuranceArbitratorFixture());

    // mint some fresh tokens for the insurer.
    await usdc.connect(deployer).mint(insurer.address, insuredAmount);
    // Approve the InsuranceArbitrator to spend tokens.
    await usdc.connect(insurer).approve(insuranceArbitrator.address, insuredAmount);
  });
  it("Issuing insurance correctly pulls tokens and changes contract state", async function () {
    const insurerBalanceBefore = await usdc.balanceOf(insurer.address);
    const contractBalanceBefore = await usdc.balanceOf(insuranceArbitrator.address);

    // Issue new insurance policy.
    const issueInsuranceTx = insuranceArbitrator
      .connect(insurer)
      .issueInsurance(insuredEvent, insured.address, insuredAmount);

    // Verify emitted transaction log.
    await expect(issueInsuranceTx)
      .to.emit(insuranceArbitrator, "PolicyIssued")
      .withArgs(anyValue, insurer.address, insuredEvent, insured.address, insuredAmount);

    // Verify insured amount has been deposited.
    expect(await usdc.balanceOf(insurer.address)).to.equal(insurerBalanceBefore.sub(insuredAmount));
    expect(await usdc.balanceOf(insuranceArbitrator.address)).to.equal(contractBalanceBefore.add(insuredAmount));

    // Verify contract state has updated.
    const policyId = await getPolicyIdFromTx(insuranceArbitrator, issueInsuranceTx);
    const insurancePolicy = await insuranceArbitrator.insurancePolicies(policyId);
    expect(insurancePolicy.claimInitiated).to.equal(false);
    expect(insurancePolicy.insuredEvent).to.equal(insuredEvent);
    expect(insurancePolicy.insuredAddress).to.equal(insured.address);
    expect(insurancePolicy.insuredAmount).to.equal(insuredAmount);
  });
  it("Event description limits enforced", async function () {
    const invalidEventLength = (await insuranceArbitrator.MAX_EVENT_DESCRIPTION_SIZE()).add(1);
    const invalidInsuredEvent = "X".repeat(Number(invalidEventLength));
    await expect(
      insuranceArbitrator.connect(insurer).issueInsurance(invalidInsuredEvent, insured.address, insuredAmount)
    ).to.be.revertedWith("Event description too long");
  });
  it("Insured address verified", async function () {
    await expect(
      insuranceArbitrator.connect(insurer).issueInsurance(insuredEvent, ZERO_ADDRESS, insuredAmount)
    ).to.be.revertedWith("Invalid insured address");
  });
  it("Insured amount verified", async function () {
    await expect(
      insuranceArbitrator.connect(insurer).issueInsurance(insuredEvent, insured.address, 0)
    ).to.be.revertedWith("Amount should be above 0");
  });
  it("Cannot issue the same policy in one block", async function () {
    // Double funding for the insurer.
    await usdc.connect(deployer).mint(insurer.address, insuredAmount);
    await usdc.connect(insurer).approve(insuranceArbitrator.address, insuredAmount.mul(2));

    // Disable automining so that second transaction can be submitted without mining the first one.
    await ethers.provider.send("evm_setAutomine", [false]);

    // Submit both transactions with the same parameters and mine the block.
    const tx1 = await insuranceArbitrator.connect(insurer).issueInsurance(insuredEvent, insured.address, insuredAmount);
    const tx2 = await insuranceArbitrator.connect(insurer).issueInsurance(insuredEvent, insured.address, insuredAmount);
    await ethers.provider.send("evm_mine", []);

    // Second submitted transaction should revert as assigned policyId would be the same.
    await expect(tx1.wait()).not.to.be.reverted;
    await expect(tx2.wait()).to.be.reverted;

    // Enable automining so that other tests are not affected.
    await ethers.provider.send("evm_setAutomine", [true]);
  });
  it("Can issue different policies in one block", async function () {
    // Double funding for the insurer.
    await usdc.connect(deployer).mint(insurer.address, insuredAmount);
    await usdc.connect(insurer).approve(insuranceArbitrator.address, insuredAmount.mul(2));

    // Disable automining so that second transaction can be submitted without mining the first one.
    await ethers.provider.send("evm_setAutomine", [false]);

    // Submit both transactions with the different parameters and mine the block.
    const tx1 = await insuranceArbitrator.connect(insurer).issueInsurance(insuredEvent, insured.address, insuredAmount);
    const tx2 = await insuranceArbitrator.connect(insurer).issueInsurance("DIFFERENT", insured.address, insuredAmount);
    await ethers.provider.send("evm_mine", []);

    // Both submitted transactions should succeed as assigned policyId would be different.
    await expect(tx1.wait()).not.to.be.reverted;
    await expect(tx2.wait()).not.to.be.reverted;

    // Enable automining so that other tests are not affected.
    await ethers.provider.send("evm_setAutomine", [true]);
  });
});
