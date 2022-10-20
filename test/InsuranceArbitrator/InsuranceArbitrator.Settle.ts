import {
  ExpandedERC20Ethers,
  MockOracleAncillaryEthers,
  OptimisticOracleV2Ethers,
  StoreEthers,
  TimerEthers,
} from "@uma/contracts-node";
import { insuranceArbitratorFixture } from "../fixtures/InsuranceArbitrator.Fixture";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { BigNumber, expect, ethers, SignerWithAddress, toWei } from "../utils";
import { InsuranceArbitrator } from "../../typechain";
import { identifier, insuredAmount, insuredEvent, NO_ANSWER, YES_ANSWER } from "./constants";
import { constructAncillaryData, getClaimIdFromTx, getExpirationTime, getPolicyIdFromTx } from "./utils";

let insuranceArbitrator: InsuranceArbitrator,
  usdc: ExpandedERC20Ethers,
  store: StoreEthers,
  optimisticOracle: OptimisticOracleV2Ethers,
  timer: TimerEthers,
  mockOracle: MockOracleAncillaryEthers;
let deployer: SignerWithAddress,
  insurer: SignerWithAddress,
  insured: SignerWithAddress,
  claimant: SignerWithAddress,
  disputer: SignerWithAddress,
  settler: SignerWithAddress;
let policyId: string, claimId: string;
let expectedAncillaryData: string;
let expectedBond: BigNumber;
let requestTime: BigNumber, expectedExpirationTime: BigNumber;

describe("Insurance Arbitrator: Settle", function () {
  beforeEach(async function () {
    [deployer, insurer, insured, claimant, disputer, settler] = await ethers.getSigners();
    ({ store, optimisticOracle, timer, mockOracle } = await umaEcosystemFixture());
    ({ usdc, insuranceArbitrator } = await insuranceArbitratorFixture());

    // Mint and approve insuredAmount tokens for the insurer.
    await usdc.connect(deployer).mint(insurer.address, insuredAmount);
    await usdc.connect(insurer).approve(insuranceArbitrator.address, insuredAmount);

    // Issue insurance policy and grab emitted policyId.
    const issueInsuranceTx = insuranceArbitrator
      .connect(insurer)
      .issueInsurance(insuredEvent, insured.address, insuredAmount);
    policyId = await getPolicyIdFromTx(insuranceArbitrator, issueInsuranceTx);

    // Mint and approve expected proposal bond for the claimant and disputer.
    const finalFee = (await store.computeFinalFee(usdc.address)).rawValue;
    const oracleBondPercentage = await insuranceArbitrator.oracleBondPercentage();
    expectedBond = oracleBondPercentage.mul(insuredAmount).div(toWei("1")).add(finalFee);
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond);
    await usdc.connect(deployer).mint(disputer.address, expectedBond);
    await usdc.connect(disputer).approve(optimisticOracle.address, expectedBond);

    // Submit claim and grab required request details for interacting with Optimistic Oracle.
    requestTime = await timer.getCurrentTime();
    const submitClaimTx = insuranceArbitrator.connect(claimant).submitClaim(policyId);
    claimId = await getClaimIdFromTx(insuranceArbitrator, submitClaimTx);
    expectedAncillaryData = constructAncillaryData(insuredEvent);
    expectedExpirationTime = await getExpirationTime(insuranceArbitrator, requestTime);
  });
  it("Cannot settle early", async function () {
    await expect(
      optimisticOracle
        .connect(settler)
        .settle(insuranceArbitrator.address, identifier, requestTime, expectedAncillaryData)
    ).to.be.reverted;
  });
  it("Settle after liveness without dispute", async function () {
    const insuredBalanceBefore = await usdc.balanceOf(insured.address);
    const contractBalanceBefore = await usdc.balanceOf(insuranceArbitrator.address);

    // Advance time post liveness and settle through Optimistic Oracle.
    await optimisticOracle.setCurrentTime(expectedExpirationTime);
    const settleTx = optimisticOracle
      .connect(settler)
      .settle(insuranceArbitrator.address, identifier, requestTime, expectedAncillaryData);

    // Verify emitted transaction log.
    await expect(settleTx).to.emit(insuranceArbitrator, "ClaimAccepted").withArgs(claimId, policyId);

    // Verify insured amount has been paid.
    expect(await usdc.balanceOf(insured.address)).to.equal(insuredBalanceBefore.add(insuredAmount));
    expect(await usdc.balanceOf(insuranceArbitrator.address)).to.equal(contractBalanceBefore.sub(insuredAmount));

    // Repeated claim on paid out insurance should not be possible.
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond);
    await expect(insuranceArbitrator.connect(claimant).submitClaim(policyId)).to.be.revertedWith(
      "Insurance not issued"
    );
  });
  it("DVM resolved claim valid", async function () {
    const insuredBalanceBefore = await usdc.balanceOf(insured.address);
    const contractBalanceBefore = await usdc.balanceOf(insuranceArbitrator.address);

    // Dispute insurance claim.
    await optimisticOracle
      .connect(disputer)
      .disputePrice(insuranceArbitrator.address, identifier, requestTime, expectedAncillaryData);

    // Simulate a vote in the DVM in which the originally disputed claim is confirmed valid.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      YES_ANSWER
    );

    // Settle through Optimistic Oracle.
    const settleTx = optimisticOracle
      .connect(settler)
      .settle(insuranceArbitrator.address, identifier, requestTime, expectedAncillaryData);

    // Verify emitted transaction log.
    await expect(settleTx).to.emit(insuranceArbitrator, "ClaimAccepted").withArgs(claimId, policyId);

    // Verify insured amount has been paid.
    expect(await usdc.balanceOf(insured.address)).to.equal(insuredBalanceBefore.add(insuredAmount));
    expect(await usdc.balanceOf(insuranceArbitrator.address)).to.equal(contractBalanceBefore.sub(insuredAmount));

    // Repeated claim on paid out insurance should not be possible.
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond);
    await expect(insuranceArbitrator.connect(claimant).submitClaim(policyId)).to.be.revertedWith(
      "Insurance not issued"
    );
  });
  it("DVM resolved claim invalid", async function () {
    const contractBalanceBefore = await usdc.balanceOf(insuranceArbitrator.address);

    // Dispute insurance claim.
    await optimisticOracle
      .connect(disputer)
      .disputePrice(insuranceArbitrator.address, identifier, requestTime, expectedAncillaryData);

    // Simulate a vote in the DVM in which the originally disputed claim is confirmed invalid.
    const disputedPriceRequest = (await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded()))[0];
    await mockOracle.pushPrice(
      disputedPriceRequest.args.identifier,
      disputedPriceRequest.args.time,
      disputedPriceRequest.args.ancillaryData,
      NO_ANSWER
    );

    // Settle through Optimistic Oracle.
    const settleTx = optimisticOracle
      .connect(settler)
      .settle(insuranceArbitrator.address, identifier, requestTime, expectedAncillaryData);

    // Verify emitted transaction log.
    await expect(settleTx).to.emit(insuranceArbitrator, "ClaimRejected").withArgs(claimId, policyId);

    // Verify no insured amount has been paid.
    expect(await usdc.balanceOf(insuranceArbitrator.address)).to.equal(contractBalanceBefore);

    // Repeated claim on rejected claim should now be possible after Timer has been advanced.
    await usdc.connect(deployer).mint(claimant.address, expectedBond);
    await usdc.connect(claimant).approve(insuranceArbitrator.address, expectedBond);
    await optimisticOracle.setCurrentTime((await (await ethers.provider.getBlock("latest")).timestamp) + 1);
    await expect(insuranceArbitrator.connect(claimant).submitClaim(policyId)).not.to.be.reverted;
  });
  it("Cannot spoof the callback", async function () {
    await expect(
      insuranceArbitrator.connect(insured).priceSettled(identifier, requestTime, expectedAncillaryData, YES_ANSWER)
    ).to.be.revertedWith("Unauthorized callback");
  });
});
