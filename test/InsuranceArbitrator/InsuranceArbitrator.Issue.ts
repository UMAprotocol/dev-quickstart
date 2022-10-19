import { ExpandedERC20Ethers } from "@uma/contracts-node";
import { insuranceArbitratorFixture } from "../fixtures/InsuranceArbitrator.Fixture";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { anyValue, BigNumber, expect, ethers, SignerWithAddress } from "../utils";
import { InsuranceArbitrator } from "../../typechain";
import { getPolicyIdFromTx } from "./utils";

let insuranceArbitrator: InsuranceArbitrator, usdc: ExpandedERC20Ethers;
let deployer: SignerWithAddress, insurer: SignerWithAddress, insured: SignerWithAddress;
let insuredAmount: BigNumber;
let insuredEvent: string;

describe("Insurance Arbitrator: Issue", function () {
  beforeEach(async function () {
    [deployer, insurer, insured] = await ethers.getSigners();
    await umaEcosystemFixture();
    ({ usdc, insuranceArbitrator } = await insuranceArbitratorFixture());

    insuredAmount = ethers.utils.parseUnits("157000", await usdc.decimals()); // 157000 USDC
    insuredEvent = "Bad things have happened";

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
      .issueInsurance(insuredEvent, insured.address, usdc.address, insuredAmount);

    // Verify emitted transaction log.
    await expect(issueInsuranceTx)
      .to.emit(insuranceArbitrator, "PolicyIssued")
      .withArgs(anyValue, insurer.address, insuredEvent, insured.address, usdc.address, insuredAmount);

    // Verify insured amount has been deposited.
    expect(await usdc.balanceOf(insurer.address)).to.equal(insurerBalanceBefore.sub(insuredAmount));
    expect(await usdc.balanceOf(insuranceArbitrator.address)).to.equal(contractBalanceBefore.add(insuredAmount));

    // Verify contract state has updated.
    const policyId = await getPolicyIdFromTx(insuranceArbitrator, issueInsuranceTx);
    const insurancePolicy = await insuranceArbitrator.insurancePolicies(policyId);
    expect(insurancePolicy.claimInitiated).to.equal(false);
    expect(insurancePolicy.insuredEvent).to.equal(insuredEvent);
    expect(insurancePolicy.insuredAddress).to.equal(insured.address);
    expect(insurancePolicy.currency).to.equal(usdc.address);
    expect(insurancePolicy.insuredAmount).to.equal(insuredAmount);
  });
});
