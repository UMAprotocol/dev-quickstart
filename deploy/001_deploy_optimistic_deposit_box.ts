import "hardhat-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime";
import { getAddress } from "@uma/contracts-node";

const func = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const chainId = parseInt(await getChainId());

  const priceIdentifier = "0x4c494e4b55534400000000000000000000000000000000000000000000000000";
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  const Finder = await getAddress("Finder", chainId);

  await deploy("OptimisticDepositBox", {
    from: deployer,
    args: ["0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99", Finder, priceIdentifier, ZERO_ADDRESS],
    log: true,
    skipIfAlreadyDeployed: false,
  });
};
module.exports = func;
func.tags = ["OptimisticDepositBox"];
func.dependencies = ["Finder", "Timer"];
