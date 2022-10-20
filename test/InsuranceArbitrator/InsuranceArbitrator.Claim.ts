import { ExpandedERC20Ethers, OptimisticOracleV2Ethers, StoreEthers, TimerEthers } from "@uma/contracts-node";
import { insuranceArbitratorFixture } from "../fixtures/InsuranceArbitrator.Fixture";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { anyValue, BigNumber, expect, ethers, SignerWithAddress, toWei, randomBytes32 } from "../utils";
import { InsuranceArbitrator } from "../../typechain";
import { identifier, insuredAmount, insuredEvent, YES_ANSWER } from "./constants";
import { constructAncillaryData, getClaimIdFromTx, getExpirationTime, getPolicyIdFromTx } from "./utils";

let insuranceArbitrator: InsuranceArbitrator,
  usdc: ExpandedERC20Ethers,
  store: StoreEthers,
  optimisticOracle: OptimisticOracleV2Ethers,
  timer: TimerEthers;
let deployer: SignerWithAddress, insurer: SignerWithAddress, insured: SignerWithAddress, claimant: SignerWithAddress;
let policyId: string;
let expectedBond: BigNumber;
let currentTime: BigNumber;

describe("Insurance Arbitrator: Claim", function () {
  beforeEach(async function () {
    [deployer, insurer, insured, claimant] = await ethers.getSigners();
    ({ store, optimisticOracle, timer } = await umaEcosystemFixture());
    ({ usdc, insuranceArbitrator } = await insuranceArbitratorFixture());

    // Mint and approve insuredAmount tokens for the insurer.
    await usdc.connect(deployer).mint(insurer.address, insuredAmount);
    await usdc.connect(insurer).approve(insuranceArbitrator.address, insuredAmount);

    // Issue insurance policy and grab emitted policyId.
    const issueInsuranceTx = insuranceArbitrator
      .connect(insurer)
      .issueInsurance(insuredEvent, insured.address, insuredAmount);
    policyId = await getPolicyIdFromTx(insuranceArbitrator, issueInsuranceTx);

    // Mint and approve expected proposal bond for the claimant.
    const finalFee = (await store.computeFinalFee(usdc.address)).rawValue;
    const oracleBondPercentage = await insuranceArbitrator.oracleBondPercentage();
    expectedBond = oracleBondPercentage.mul(insuredAmount).div(toWei("1")).add(finalFee);
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond);
  });
  it("Submitting claim correctly pulls tokens and changes contract state", async function () {
    const claimantBalanceBefore = await usdc.balanceOf(claimant.address);
    const ooBalanceBefore = await usdc.balanceOf(optimisticOracle.address);

    // Submit a claim on the insurance policy.
    const submitClaimTx = insuranceArbitrator.connect(claimant).submitClaim(policyId);

    // Verify emitted transaction log.
    currentTime = await timer.getCurrentTime();
    await expect(submitClaimTx)
      .to.emit(insuranceArbitrator, "ClaimSubmitted")
      .withArgs(currentTime, anyValue, policyId);

    // Verify proposal bond has been transferred to Optimistic Oracle.
    expect(await usdc.balanceOf(claimant.address)).to.equal(claimantBalanceBefore.sub(expectedBond));
    expect(await usdc.balanceOf(optimisticOracle.address)).to.equal(ooBalanceBefore.add(expectedBond));

    // Verify Insurance Arbitrator contract state has updated.
    const claimId = await getClaimIdFromTx(insuranceArbitrator, submitClaimTx);
    expect((await insuranceArbitrator.insurancePolicies(policyId)).claimInitiated).to.equal(true);
    expect(await insuranceArbitrator.insuranceClaims(claimId)).to.equal(policyId);

    // Verify price request state on Optimistic Oracle.
    const expectedAncillaryData = constructAncillaryData(insuredEvent);
    const expectedExpirationTime = await getExpirationTime(insuranceArbitrator, currentTime);
    const request = await optimisticOracle.getRequest(
      insuranceArbitrator.address,
      identifier,
      currentTime,
      expectedAncillaryData
    );
    expect(request.proposer).to.equal(claimant.address);
    expect(request.currency).to.equal(usdc.address);
    expect(request.proposedPrice).to.equal(YES_ANSWER);
    expect(request.expirationTime).to.equal(expectedExpirationTime);
    expect(request.requestSettings.callbackOnPriceSettled).to.equal(true);
  });
  it("Check for valid insurance policy", async function () {
    const invalidPolicyId = randomBytes32();
    await expect(insuranceArbitrator.connect(claimant).submitClaim(invalidPolicyId)).to.be.revertedWith(
      "Insurance not issued"
    );
  });
  it("Cannot have simultaneous claims on one policy", async function () {
    // Double funding for the claimer.
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond.mul(2));

    // Repeated claim on the same policy should revert.
    await expect(insuranceArbitrator.connect(claimant).submitClaim(policyId)).not.to.be.reverted;
    await expect(insuranceArbitrator.connect(claimant).submitClaim(policyId)).to.be.revertedWith(
      "Claim already initiated"
    );
  });
  it("Cannot claim similar policies at the same time", async function () {
    // Issue new insurance with replicated parameters and grab its policyId.
    await usdc.connect(deployer).mint(insurer.address, insuredAmount);
    await usdc.connect(insurer).approve(insuranceArbitrator.address, insuredAmount);
    const duplicateInsuranceTx = insuranceArbitrator
      .connect(insurer)
      .issueInsurance(insuredEvent, insured.address, insuredAmount);
    const duplicatePolicyId = await getPolicyIdFromTx(insuranceArbitrator, duplicateInsuranceTx);

    // Double bond funding for the claimant.
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond.mul(2));

    // The second policy claim should fail due to price request conflict at Optimistic Oracle.
    // This test relies on current time of Testable Optimistic Oracle not being advanced.
    await expect(insuranceArbitrator.connect(claimant).submitClaim(policyId)).not.to.be.reverted;
    await expect(insuranceArbitrator.connect(claimant).submitClaim(duplicatePolicyId)).to.be.reverted;

    // Confirm that claim on second policy gets unblocked after time has advanced.
    await optimisticOracle.setCurrentTime((await (await ethers.provider.getBlock("latest")).timestamp) + 1);
    await expect(insuranceArbitrator.connect(claimant).submitClaim(duplicatePolicyId)).not.to.be.reverted;
  });
});
