import { BigNumber, Contract, ethers, expect, SignerWithAddress, toWei } from "../utils";
export const proposeAndSettleOptimisticOraclePrice = async (
  price: BigNumber,
  eventBasedPredictionMarket: Contract,
  optimisticOracle: Contract
) => {
  const ancillaryData = await eventBasedPredictionMarket.customAncillaryData();
  const identifier = await eventBasedPredictionMarket.priceIdentifier();
  const expirationTimestamp = await eventBasedPredictionMarket.expirationTimestamp();
  const optimisticOracleLivenessTime = await eventBasedPredictionMarket.optimisticOracleLivenessTime();

  await optimisticOracle.proposePrice(
    eventBasedPredictionMarket.address,
    identifier,
    expirationTimestamp,
    ancillaryData,
    price
  );

  await optimisticOracle.setCurrentTime((await optimisticOracle.getCurrentTime()).add(optimisticOracleLivenessTime));

  await optimisticOracle.settle(eventBasedPredictionMarket.address, identifier, expirationTimestamp, ancillaryData);
};
