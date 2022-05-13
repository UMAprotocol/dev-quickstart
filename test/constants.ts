import { toWei, utf8ToHex, ethers } from "./utils";

export { TokenRolesEnum } from "@uma/common";

export const amountToSeedWallets = toWei("1500");

export const amountToDeposit = toWei("100");

export const amountToWithdraw = toWei("10");

export const proposalLiveness = 7200;

export const mockPrice = toWei("1");

export const zeroBytes = "0x";

export const identifier = utf8ToHex("YES_OR_NO_QUERY");

export const zeroRawValue = { rawValue: "0" };
