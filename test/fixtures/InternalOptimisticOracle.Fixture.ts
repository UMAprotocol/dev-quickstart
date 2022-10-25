import { ExpandedERC20Ethers } from "@uma/contracts-node";
import hre from "hardhat";
import { InternalOptimisticOracle__factory } from "../../typechain";
import { TokenRolesEnum } from "../constants";

import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";

const { getContractFactory } = hre.ethers;

export const internalOptimisticOracleFixture = hre.deployments.createFixture(async ({ ethers }) => {
  return await deployinternalOptimisticOracle(ethers);
});

export async function deployinternalOptimisticOracle(ethers: typeof hre.ethers) {
  const [deployer] = await ethers.getSigners();

  // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
  // deployments that follows. The output is spread when returning contract instances from this fixture.
  const parentFixture = await umaEcosystemFixture();

  // deploys collateral for InternalOptimisticOracle contract
  const usdc = (await (
    await getContractFactory("ExpandedERC20", deployer)
  ).deploy("USD Coin", "USDC", 6)) as ExpandedERC20Ethers;
  await usdc.addMember(TokenRolesEnum.MINTER, deployer.address);

  // Sets collateral as approved in the UMA collateralWhitelist.
  await parentFixture.collateralWhitelist.addToWhitelist(usdc.address);

  // Deploy the InternalOptimisticOracle contract.
  const internalOptimisticOracleFactory: InternalOptimisticOracle__factory = await getContractFactory(
    "InternalOptimisticOracle",
    deployer
  );

  const internalOptimisticOracle = await internalOptimisticOracleFactory.deploy(
    parentFixture.finder.address,
    usdc.address,
    parentFixture.timer.address
  );

  return { ...parentFixture, usdc, internalOptimisticOracle, deployer };
}
