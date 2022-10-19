import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import { getNodeUrl, getMnemonic } from "@uma/common";

import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "solidity-coverage";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";

dotenv.config();

const solcVersion = "0.8.17";
const mnemonic = getMnemonic();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: solcVersion, settings: { optimizer: { enabled: true, runs: 1000000 } } }],
  },
  networks: {
    hardhat: { accounts: { accountsBalance: "1000000000000000000000000" } },
    mainnet: {
      url: getNodeUrl("mainnet", true, 1),
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 1,
    },
    kovan: {
      url: getNodeUrl("kovan", true, 42),
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 42,
    },
    rinkeby: {
      chainId: 4,
      url: getNodeUrl("rinkeby", true, 4),
      saveDeployments: true,
      accounts: { mnemonic },
    },
    goerli: {
      chainId: 5,
      url: getNodeUrl("goerli", true, 5),
      saveDeployments: true,
      accounts: { mnemonic },
    },
    polygon: {
      chainId: 137,
      url: getNodeUrl("polygon-matic", true, 137),
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "mainnet" },
    },
    "polygon-mumbai": {
      chainId: 80001,
      url: getNodeUrl("polygon-mumbai", true, 80001),
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "goerli" },
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY,
      kovan: process.env.ETHERSCAN_API_KEY,
      rinkeby: process.env.ETHERSCAN_API_KEY,
      goerli: process.env.ETHERSCAN_API_KEY,
      polygon: process.env.POLYGON_ETHERSCAN_API_KEY,
      polygonMumbai: process.env.POLYGON_ETHERSCAN_API_KEY,
    },
  },
  namedAccounts: { deployer: 0 },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
};

export default config;
