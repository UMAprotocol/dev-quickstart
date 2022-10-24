import { ExpandedERC20Ethers } from "@uma/contracts-node";
import hre from "hardhat";
import { getContractFactory } from "../utils";
import { TokenRolesEnum } from "../constants";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import { InsuranceArbitrator } from "../../typechain";

export const insuranceArbitratorFixture = hre.deployments.createFixture(async ({ ethers }) => {
  return await deployInsuranceArbitrator(ethers);
});

export async function deployInsuranceArbitrator(ethers: typeof hre.ethers) {
  const [deployer] = await ethers.getSigners();

  // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
  // deployments that follows.
  const parentFixture = await umaEcosystemFixture();

  // deploys currency for InsuranceArbitrator contract
  const usdc = (await (
    await getContractFactory("ExpandedERC20", deployer)
  ).deploy("USD Coin", "USDC", 6)) as ExpandedERC20Ethers;
  await usdc.addMember(TokenRolesEnum.MINTER, deployer.address);

  // Sets collateral as approved in the UMA collateralWhitelist.
  await parentFixture.collateralWhitelist.addToWhitelist(usdc.address);

  // Sets finalFee to 1500 USDC.
  const finalFee = ethers.utils.parseUnits("1500", await usdc.decimals());
  await parentFixture.store.setFinalFee(usdc.address, { rawValue: finalFee });

  // Deploy the InsuranceArbitrator contract.
  const insuranceArbitrator = (await (
    await getContractFactory("InsuranceArbitrator", deployer)
  ).deploy(parentFixture.finder.address, usdc.address, parentFixture.timer.address)) as InsuranceArbitrator;

  return { usdc, insuranceArbitrator };
}
