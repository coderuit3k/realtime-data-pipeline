export type CryptoTicker = { symbol: string; colorClass: string };

// Brand colours as text accents instead of fetched logo images: no extra
// network requests or third-party image hosts.
const KNOWN_COINS: Record<string, CryptoTicker> = {
  bitcoin: { symbol: "BTC", colorClass: "text-[#F7931A]" },
  ethereum: { symbol: "ETH", colorClass: "text-[#627EEA]" },
  solana: { symbol: "SOL", colorClass: "text-[#14F195]" },
};

/** Ticker and colour for a CoinGecko id; unknown coins fall back to a muted 3-letter abbreviation. */
export function cryptoTicker(coinId: string): CryptoTicker {
  return KNOWN_COINS[coinId] ?? { symbol: coinId.slice(0, 3).toUpperCase(), colorClass: "text-textMuted" };
}
