import { ExpandedERC20Ethers } from "@uma/contracts-node";
import hre from "hardhat";
import { OptimisticArbitrator__factory } from "../../typechain";
import { TokenRolesEnum } from "../constants";

import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";

const { getContractFactory } = hre.ethers;

export const optimisticArbitratorFixture = hre.deployments.createFixture(async ({ ethers }) => {
  return await deployOptimisticArbitrator(ethers);
});

export async function deployOptimisticArbitrator(ethers: typeof hre.ethers) {
  const [deployer] = await ethers.getSigners();

  // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
  // deployments that follows. The output is spread when returning contract instances from this fixture.
  const parentFixture = await umaEcosystemFixture();

  // deploys collateral for OptimisticArbitrator contract
  const usdc = (await (
    await getContractFactory("ExpandedERC20", deployer)
  ).deploy("USD Coin", "USDC", 6)) as ExpandedERC20Ethers;
  await usdc.addMember(TokenRolesEnum.MINTER, deployer.address);

  // Sets collateral as approved in the UMA collateralWhitelist.
  await parentFixture.collateralWhitelist.addToWhitelist(usdc.address);

  // Deploy the OptimisticArbitrator contract.
  const optimisticArbitratorFactory: OptimisticArbitrator__factory = await getContractFactory(
    "OptimisticArbitrator",
    deployer
  );

  const optimisticArbitrator = await optimisticArbitratorFactory.deploy(parentFixture.finder.address, usdc.address);

  return { ...parentFixture, usdc, optimisticArbitrator, deployer };
}
