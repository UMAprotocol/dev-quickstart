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

  // Note: The Goerli WETH address is hardcoded as the collateral address. Feel free to change
  // if using a different collateral type or deploying to a different network.
  await deploy("OptimisticDepositBox", {
    from: deployer,
    args: ["0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6", Finder, priceIdentifier, ZERO_ADDRESS],
    log: true,
    skipIfAlreadyDeployed: false,
  });
};
module.exports = func;
func.tags = ["OptimisticDepositBox"];
func.dependencies = ["Finder", "Timer"];
