import { BigNumber, parseUnits, toWei, utf8ToHex } from "../utils";

export const insuredAmount: BigNumber = parseUnits("157000", 6); // 157000 USDC

export const insuredEvent = "Bad things have happened";

export const identifier = utf8ToHex("YES_OR_NO_QUERY");

export const yesPrice = toWei("1");

export const ancillaryDataHead = 'q:"Had the following insured event occurred as of request timestamp: ';

export const ancillaryDataTail = '?"';
