import { getAddress } from "@uma/contracts-node";
import "hardhat-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime";

const func = async function (hre: HardhatRuntimeEnvironment) {
  let Finder: string;
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const chainId = parseInt(await getChainId());

  // Note: For Goerli the currency by default is set to hardcoded TestnetERC20 that is mintable by anyone and
  // it is whitelisted as UMA collateral with 100e18 set as finalFee. It is possible to override this by providing
  // CURRENCY address in the environment, but should make sure that it is whitelisted.
  if (chainId != 5 && !process.env.CURRENCY)
    throw new Error("CURRENCY must be provided for other networks than Goerli!");
  const Currency = process.env.CURRENCY ? process.env.CURRENCY : "0x9069070A69389dc23BB5A3Df86C213b074809634";

  // Note: For Goerli by default Finder is hardcoded to test environment with Mock DVM and approved TestnetERC20. It is
  // possible to override this by providing FINDER address in the environment pointing to any other sandboxed UMA
  // testing environment. For other networks canonical Finder address is used unless overriden by FINDER variable.
  if (chainId == 5) Finder = process.env.FINDER ? process.env.FINDER : "0xDC6b80D38004F495861E081e249213836a2F3217";
  else Finder = process.env.FINDER ? process.env.FINDER : await getAddress("Finder", chainId);

  await deploy("OptimisticArbitrator", {
    from: deployer,
    args: [Finder, Currency],
    log: true,
    skipIfAlreadyDeployed: false,
  });
};
module.exports = func;
func.tags = ["OptimisticArbitrator"];
func.dependencies = ["finderAddress"];
