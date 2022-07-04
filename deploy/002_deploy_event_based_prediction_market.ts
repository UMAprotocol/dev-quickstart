import { getAddress, getVotingTokenAddress } from "@uma/contracts-node";
import "hardhat-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime";
import Web3 from "web3";

const { utf8ToHex } = Web3.utils;

const func = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const chainId = parseInt(await getChainId());

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  const pairName = "1MBTCMOONHOTEL";
  const customAncillaryData = utf8ToHex("Will BTC be over $1M when the first Moon hotel opens?");

  const votingToken = await getVotingTokenAddress(chainId);

  const Finder = await getAddress("Finder", chainId);

  await deploy("EventBasedPredictionMarket", {
    from: deployer,
    args: [pairName, votingToken, customAncillaryData, Finder, ZERO_ADDRESS],
    log: true,
    skipIfAlreadyDeployed: false,
  });
};
module.exports = func;
func.tags = ["EventBasedPredictionMarket"];
func.dependencies = ["Finder", "Timer"];
