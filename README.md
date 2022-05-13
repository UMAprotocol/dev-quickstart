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

## Deploy and Verify

```shell
NODE_URL_42=https://kovan.infura.com/xxx yarn hardhat deploy --tags OptimisticDepositBox --network kovan
ETHERSCAN_API_KEY=XXX yarn hardhat etherscan-verify --network kovan --license AGPL-3.0 --force-license --solc-input
```
