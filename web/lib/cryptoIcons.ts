export type CryptoTicker = { symbol: string; colorClass: string };

// Each coin's own brand color, used as a small accent dot/ticker rather than
// a fetched logo image -- zero extra network requests, consistent with this
// project's "static icon set" approach to keeping cost at $0.
const KNOWN_COINS: Record<string, CryptoTicker> = {
  bitcoin: { symbol: "BTC", colorClass: "text-[#F7931A]" },
  ethereum: { symbol: "ETH", colorClass: "text-[#627EEA]" },
  solana: { symbol: "SOL", colorClass: "text-[#14F195]" },
};

export function cryptoTicker(coinId: string): CryptoTicker {
  return KNOWN_COINS[coinId] ?? { symbol: coinId.slice(0, 3).toUpperCase(), colorClass: "text-textMuted" };
}
