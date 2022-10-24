import fs from "fs";
import path from "path";
import { expect } from "chai";
import { getBytecode, getAbi } from "@uma/contracts-node";
import hre from "hardhat";
import { ethers } from "hardhat";
import { BigNumber, Signer, Contract, ContractFactory } from "ethers";
import { FactoryOptions } from "hardhat/types";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

export interface SignerWithAddress extends Signer {
  address: string;
}

function isFactoryOptions(signerOrFactoryOptions: Signer | FactoryOptions): signerOrFactoryOptions is FactoryOptions {
  return "signer" in signerOrFactoryOptions || "libraries" in signerOrFactoryOptions;
}

export async function getContractFactory(
  name: string,
  signerOrFactoryOptions: Signer | FactoryOptions
): Promise<ContractFactory> {
  try {
    // First, try get the artifact from this repo.
    return await ethers.getContractFactory(name, signerOrFactoryOptions);
  } catch (_) {
    try {
      // If it does not exist then try find the contract in the UMA core package.
      if (isFactoryOptions(signerOrFactoryOptions))
        throw new Error("Cannot pass FactoryOptions to a contract imported from UMA");
      return new ContractFactory(getAbi(name as any), getBytecode(name as any), signerOrFactoryOptions as Signer);
    } catch (_) {
      // Try importing the package from the local path. This would be the case when running these utils
      // from node modules which breaks using the hardhat getContractFactory function.
      try {
        const localArtifact = getLocalArtifact(name);
        return new ContractFactory(localArtifact.abi, localArtifact.bytecode, signerOrFactoryOptions as Signer);
      } catch (_) {
        throw new Error(`Could not find the artifact for ${name}!`);
      }
    }
  }
}

// Fetch the artifact from the publish package's artifacts directory.
function getLocalArtifact(contractName: string) {
  const artifactsPath = `${__dirname}/../../artifacts/contracts`;
  return findArtifactFromPath(contractName, artifactsPath);
}

export function findArtifactFromPath(contractName: string, artifactsPath: string) {
  const allArtifactsPaths = getAllFilesInPath(artifactsPath);
  const desiredArtifactPaths = allArtifactsPaths.filter((a) => a.endsWith(`/${contractName}.json`));

  if (desiredArtifactPaths.length !== 1)
    throw new Error(`Couldn't find desired artifact or found too many for ${contractName}`);
  return JSON.parse(fs.readFileSync(desiredArtifactPaths[0], "utf-8"));
}

export function getAllFilesInPath(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    if (fs.statSync(dirPath + "/" + file).isDirectory())
      arrayOfFiles = getAllFilesInPath(dirPath + "/" + file, arrayOfFiles);
    else arrayOfFiles.push(path.join(dirPath, "/", file));
  });

  return arrayOfFiles;
}

export const toWei = (num: string | number | BigNumber) => ethers.utils.parseEther(num.toString());

export const parseUnits = (num: string | number | BigNumber, dec: string | number | BigNumber) =>
  ethers.utils.parseUnits(num.toString(), dec.toString());

export const utf8ToHex = (input: string) => ethers.utils.formatBytes32String(input);

export const utf8ToHexString = (input: string) => ethers.utils.hexlify(ethers.utils.toUtf8Bytes(input));

export const randomBytes32 = () => ethers.utils.hexlify(ethers.utils.randomBytes(32));

export { anyValue, expect, Contract, ethers, hre, BigNumber, Signer };
