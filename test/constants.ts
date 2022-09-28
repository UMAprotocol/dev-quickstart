import { toWei, utf8ToHex } from "./utils";

export { TokenRolesEnum, MIN_INT_VALUE } from "@uma/common";

export const amountToSeedWallets = toWei("1500");

export const amountToDeposit = toWei("100");

export const amountToWithdraw = toWei("10");

export const proposalLiveness = 7200;

export const mockPrice = toWei("1");

export const zeroBytes = "0x";

export const identifier = utf8ToHex("YES_OR_NO_QUERY");

export const zeroRawValue = { rawValue: "0" };
