import hre from "hardhat";
import Web3 from "web3";
import { EventBasedPredictionMarket, ExpandedERC20 } from "../../typechain";
import { TokenRolesEnum } from "../constants";
import { getContractFactory, SignerWithAddress, BigNumber, Contract } from "../utils";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
const { utf8ToHex } = Web3.utils;

export const eventBasedPredictionMarketFixture = hre.deployments.createFixture(async ({ ethers }) => {
  return await deployEventBasedPredictionMarket(ethers);
});

export async function deployEventBasedPredictionMarket(ethers: any) {
  const [deployer] = await ethers.getSigners();

  // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
  // deployments that follows. The output is spread when returning contract instances from this fixture.
  const parentFixture = await umaEcosystemFixture();

  // deploys collateral for EventBasedPredictionMarket contract
  const usdc = await (await getContractFactory("ExpandedERC20", deployer)).deploy("USD Coin", "USDC", 6);
  await usdc.addMember(TokenRolesEnum.MINTER, deployer.address);

  // Sets collateral as approved in the UMA collateralWhitelist.
  await parentFixture.collateralWhitelist.addToWhitelist(usdc.address);

  // Deploy the EventBasedPredictionMarket contract.
  const eventBasedPredictionMarket = (await (
    await getContractFactory("EventBasedPredictionMarket", deployer)
  ).deploy(
    "XYZ",
    usdc.address,
    utf8ToHex("when X happens, will the price of Y equal Z?"),
    parentFixture.finder.address,
    parentFixture.timer.address
  )) as EventBasedPredictionMarket;

  // connect to existing ExpandedERC20 contract with ether
  const longToken = (await (
    await getContractFactory("ExpandedERC20", deployer)
  ).attach(await eventBasedPredictionMarket.longToken())) as ExpandedERC20;
  const shortToken = (await (
    await getContractFactory("ExpandedERC20", deployer)
  ).attach(await eventBasedPredictionMarket.shortToken())) as ExpandedERC20;

  return { ...parentFixture, usdc, eventBasedPredictionMarket, deployer, longToken, shortToken };
}
