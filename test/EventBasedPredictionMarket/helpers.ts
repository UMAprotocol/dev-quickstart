import { BigNumber, Contract, ethers, expect, SignerWithAddress, toWei } from "../utils";
export const proposeAndSettleOptimisticOraclePrice = async (
  price: BigNumber,
  eventBasedPredictionMarket: Contract,
  optimisticOracle: Contract
) => {
  const ancillaryData = await eventBasedPredictionMarket.customAncillaryData();
  const identifier = await eventBasedPredictionMarket.priceIdentifier();
  const requestTimestamp = await eventBasedPredictionMarket.requestTimestamp();
  const optimisticOracleLivenessTime = await eventBasedPredictionMarket.optimisticOracleLivenessTime();

  await optimisticOracle.proposePrice(
    eventBasedPredictionMarket.address,
    identifier,
    requestTimestamp,
    ancillaryData,
    price
  );

  await optimisticOracle.setCurrentTime((await optimisticOracle.getCurrentTime()).add(optimisticOracleLivenessTime));

  await optimisticOracle.settle(eventBasedPredictionMarket.address, identifier, requestTimestamp, ancillaryData);
};
