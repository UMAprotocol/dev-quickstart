import { BigNumber, Contract, SignerWithAddress } from "../utils";

export async function seedAndApprove(
  accounts: SignerWithAddress[],
  collateral: Contract,
  amount: BigNumber,
  approvedTarget: string
) {
  for (const account of accounts) {
    await collateral.mint(account.address, amount);
    await collateral.connect(account).approve(approvedTarget, amount);
  }
}
