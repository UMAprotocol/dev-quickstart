const { ZERO_ADDRESS } = require("@uma/common");

import "hardhat-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime";
import { ADDRESS_MAP } from "./consts";

const func = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const chainId = parseInt(await getChainId());

  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const priceIdentifier = "0xe03cfc9e275bd1298e77ea26d643fed7cd1adbe2000000000000000000000000";

  await deploy("OptimisticDepositBox", {
    from: deployer,
    args: ["0xE03CFC9e275BD1298E77eA26d643feD7cd1AdBE2", ADDRESS_MAP[chainId].finder, priceIdentifier, Timer.address],
    log: true,
    skipIfAlreadyDeployed: false,
  });
};
module.exports = func;
func.tags = ["OptimisticDepositBox"];
func.dependencies = ["Finder", "Timer"];
