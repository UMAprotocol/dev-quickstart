import { BigNumber, ContractTransaction, EventFilter } from "ethers";
import { InsuranceArbitrator } from "../../typechain";
import { utf8ToHexString } from "../utils";
import { ancillaryDataHead, ancillaryDataTail } from "./constants";

export async function getPolicyIdFromTx(
  insuranceArbitrator: InsuranceArbitrator,
  tx: Promise<ContractTransaction>
): Promise<string> {
  const blockNumber = (await (await tx).wait()).blockNumber;
  const [matchedEvent] = await insuranceArbitrator.queryFilter(<EventFilter>"PolicyIssued", blockNumber, blockNumber);
  return matchedEvent.args.policyId;
}

export async function getClaimIdFromTx(
  insuranceArbitrator: InsuranceArbitrator,
  tx: Promise<ContractTransaction>
): Promise<string> {
  const blockNumber = (await (await tx).wait()).blockNumber;
  const [matchedEvent] = await insuranceArbitrator.queryFilter(<EventFilter>"ClaimSubmitted", blockNumber, blockNumber);
  return matchedEvent.args.claimId;
}

export function constructAncillaryData(insuredEvent: string): string {
  return utf8ToHexString(ancillaryDataHead + insuredEvent + ancillaryDataTail);
}

export async function getExpirationTime(
  insuranceArbitrator: InsuranceArbitrator,
  claimTimestamp: BigNumber
): Promise<BigNumber> {
  return (await insuranceArbitrator.optimisticOracleLivenessTime()).add(claimTimestamp);
}
