import { ContractTransaction, EventFilter } from "ethers";
import { InsuranceArbitrator } from "../../typechain";

export async function getPolicyIdFromTx(
  insuranceArbitrator: InsuranceArbitrator,
  tx: Promise<ContractTransaction>
): Promise<string> {
  const blockNumber = (await (await tx).wait()).blockNumber;
  const [matchedEvent] = await insuranceArbitrator.queryFilter(<EventFilter>"PolicyIssued", blockNumber, blockNumber);
  return matchedEvent.args.policyId;
}
