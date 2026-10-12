// Token counts in short: 950, 52k, 1M, 1.5M.
export const compactTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
    : tokens >= 1_000
      ? `${Math.round(tokens / 1_000)}k`
      : String(tokens);
