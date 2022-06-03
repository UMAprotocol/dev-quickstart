import hre from "hardhat";
import Web3 from "web3";
import { identifier, TokenRolesEnum } from "../constants";
import { getContractFactory } from "../utils";
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

  const longShortPairFinancialProjectLibraryTest = await (
    await getContractFactory("LongShortPairFinancialProjectLibraryTest", deployer)
  ).deploy();

  const constructorParams = {
    pairName: "will it rain today?",
    priceIdentifier: identifier,
    collateralToken: usdc.address,
    financialProductLibrary: longShortPairFinancialProjectLibraryTest.address,
    customAncillaryData: utf8ToHex("some-address-field:0x1234"),
    finder: parentFixture.finder.address,
    timerAddress: parentFixture.timer.address,
  };

  // Deploy the EventBasedPredictionMarket contract.
  const eventBasedPredictionMarket = await (
    await getContractFactory("EventBasedPredictionMarket", deployer)
  ).deploy(constructorParams);

  return { ...parentFixture, usdc, eventBasedPredictionMarket, deployer };
}
