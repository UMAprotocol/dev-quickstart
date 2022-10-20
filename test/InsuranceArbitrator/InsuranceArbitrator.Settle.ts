import { ExpandedERC20Ethers, OptimisticOracleV2Ethers, StoreEthers, TimerEthers } from "@uma/contracts-node";
import { insuranceArbitratorFixture } from "../fixtures/InsuranceArbitrator.Fixture";
import { umaEcosystemFixture } from "../fixtures/UmaEcosystem.Fixture";
import { anyValue, BigNumber, expect, ethers, SignerWithAddress, toWei, randomBytes32 } from "../utils";
import { InsuranceArbitrator } from "../../typechain";
import { identifier, insuredAmount, insuredEvent, yesPrice } from "./constants";
import { constructAncillaryData, getClaimIdFromTx, getExpirationTime, getPolicyIdFromTx } from "./utils";

let insuranceArbitrator: InsuranceArbitrator,
  usdc: ExpandedERC20Ethers,
  store: StoreEthers,
  optimisticOracle: OptimisticOracleV2Ethers,
  timer: TimerEthers;
let deployer: SignerWithAddress,
  insurer: SignerWithAddress,
  insured: SignerWithAddress,
  claimant: SignerWithAddress,
  disputer: SignerWithAddress,
  settler: SignerWithAddress;
let policyId: string;
let expectedAncillaryData: string;
let expectedBond: BigNumber;
let requestTime: BigNumber, expectedExpirationTime: BigNumber;

describe("Insurance Arbitrator: Settle", function () {
  beforeEach(async function () {
    [deployer, insurer, insured, claimant, disputer, settler] = await ethers.getSigners();
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
    await insuranceArbitrator.connect(claimant).submitClaim(policyId);
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
});
