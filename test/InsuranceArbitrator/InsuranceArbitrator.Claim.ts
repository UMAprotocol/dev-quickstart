import { ExpandedERC20Ethers, OptimisticOracleV2Ethers, StoreEthers, TimerEthers } from "@uma/contracts-node";
import { insuranceArbitratorFixture } from "../fixtures/InsuranceArbitrator.Fixture";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { anyValue, BigNumber, expect, ethers, SignerWithAddress, toWei } from "../utils";
import { InsuranceArbitrator } from "../../typechain";
import { identifier, insuredAmount, insuredEvent, yesPrice } from "./constants";
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
    expect(request.proposedPrice).to.equal(yesPrice);
    expect(request.expirationTime).to.equal(expectedExpirationTime);
    expect(request.requestSettings.callbackOnPriceSettled).to.equal(true);
  });
});
