import hre from "hardhat";
import { getContractFactory } from "../utils";
import { identifier, TokenRolesEnum } from "../constants";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";

export const optimisticDepositBoxFixture = hre.deployments.createFixture(async ({ ethers }) => {
  return await deployOptimisticDepositBox(ethers);
});

export async function deployOptimisticDepositBox(ethers: any) {
  const [deployer] = await ethers.getSigners();

  // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
  // deployments that follows. The output is spread when returning contract instances from this fixture.
  const parentFixture = await umaEcosystemFixture();

  // deploys collateral for OptimisticDepositBox contract
  const usdc = await (await getContractFactory("ExpandedERC20", deployer)).deploy("USD Coin", "USDC", 6);
  await usdc.addMember(TokenRolesEnum.MINTER, deployer.address);

  // Sets collateral as approved in the UMA collateralWhitelist.
  await parentFixture.collateralWhitelist.addToWhitelist(usdc.address);

  // Deploy the OptimisticDepositBox contract.
  const optimisticDepositBox = await (
    await getContractFactory("OptimisticDepositBox", deployer)
  ).deploy(usdc.address, parentFixture.finder.address, identifier, parentFixture.timer.address);

  return { ...parentFixture, usdc, optimisticDepositBox, deployer };
}
