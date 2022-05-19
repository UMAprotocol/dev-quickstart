## Developer Quickstart Repo

This repo is intended to have scripts and tests available to allow for testing UMA contracts. The repo uses the `OptimisticDepositBox` contract as an example.

## Install dependencies

You will need to install the long-term support version of nodejs, currently nodejs v14 or v16. You will also need to install yarn.

## Build

```shell
yarn
yarn hardhat compile
```

## Test

```shell
yarn test # Run unit tests
```

## Lint

```shell
yarn lint
yarn lint-fix
```

## Deploying your contracts

To deploy the entire UMA system on a network of your choice (the below uses kovan as an example):

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat deploy --network kovan
```

Use the command below to deploy a particular contract (along with any dependencies that haven't been deployed on this network). In the deploy script, the `func.tags` determines the contracts to deploy which is specified using the --tags arg in the command. The `func.dependencies` in the deploy script determines the dependencies that will be deployed:

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat deploy --network kovan --tags OptimisticDepositBox
```

## Contract verification

To perform an etherscan verification on a particular contract address that you have deployed on a public network:

```sh
export ETHERSCAN_API_KEY="Your etherscan api key here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat verify "Your contract address here" --network kovan
```

To perform a verification on all the contracts you have deployed on a particular network:

```sh
export CUSTOM_NODE_URL="Your node url here"
export ETHERSCAN_API_KEY="Your etherscan api key here"
yarn hardhat etherscan-verify --network kovan --license AGPL-3.0 --force-license
```
