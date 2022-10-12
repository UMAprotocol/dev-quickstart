import { getContractFactory, utf8ToHex, hre } from "../utils";
import { proposalLiveness, zeroRawValue, identifier } from "../constants";
import { interfaceName } from "@uma/common";
import { OptimisticOracleV2Ethers, MockOracleAncillaryEthers, StoreEthers, TimerEthers } from "@uma/contracts-node";

export const umaEcosystemFixture = hre.deployments.createFixture(async ({ ethers }) => {
  const [deployer] = await ethers.getSigners();

  // Deploy the UMA ecosystem contracts.
  const timer = (await (await getContractFactory("Timer", deployer)).deploy()) as TimerEthers;
  const finder = await (await getContractFactory("Finder", deployer)).deploy();
  const collateralWhitelist = await (await getContractFactory("AddressWhitelist", deployer)).deploy();
  const identifierWhitelist = await (await getContractFactory("IdentifierWhitelist", deployer)).deploy();
  const store = (await (
    await getContractFactory("Store", deployer)
  ).deploy(zeroRawValue, zeroRawValue, timer.address)) as StoreEthers;
  const mockOracle = (await (
    await getContractFactory("MockOracleAncillary", deployer)
  ).deploy(finder.address, timer.address)) as MockOracleAncillaryEthers;
  const optimisticOracle = (await (
    await getContractFactory("OptimisticOracleV2", deployer)
  ).deploy(proposalLiveness, finder.address, timer.address)) as OptimisticOracleV2Ethers;

  // Set all the contracts within the finder.
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address);
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracleV2), optimisticOracle.address);
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

  // Set up other required UMA ecosystem components.
  await identifierWhitelist.addSupportedIdentifier(identifier);

  return { timer, finder, collateralWhitelist, identifierWhitelist, store, optimisticOracle, mockOracle };
});

module.exports.tags = ["UmaEcosystem"];
