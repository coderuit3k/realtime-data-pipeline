import { describe, expect, it } from "vitest";
import { cryptoTicker } from "./cryptoIcons";

describe("cryptoTicker", () => {
  it("maps bitcoin to BTC with its brand color", () => {
    expect(cryptoTicker("bitcoin")).toEqual({ symbol: "BTC", colorClass: "text-[#F7931A]" });
  });

  it("maps ethereum to ETH with its brand color", () => {
    expect(cryptoTicker("ethereum")).toEqual({ symbol: "ETH", colorClass: "text-[#627EEA]" });
  });

  it("maps solana to SOL with its brand color", () => {
    expect(cryptoTicker("solana")).toEqual({ symbol: "SOL", colorClass: "text-[#14F195]" });
  });

  it("falls back to an uppercased prefix for an unknown coin", () => {
    expect(cryptoTicker("dogecoin")).toEqual({ symbol: "DOG", colorClass: "text-textMuted" });
  });
});
