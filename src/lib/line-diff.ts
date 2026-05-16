export type DiffLine = {
  type: "eq" | "add" | "del";
  text: string;
  aLine?: number;
  bLine?: number;
};

export type DiffResult =
  | { ok: true; lines: DiffLine[] }
  | { ok: false; reason: "too-large"; aLines: number; bLines: number; limit: number };

export const MAX_DIFF_LINES = 5000;

export function lineDiff(a: string, b: string): DiffResult {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  if (Math.max(n, m) > MAX_DIFF_LINES) {
    return { ok: false, reason: "too-large", aLines: n, bLines: m, limit: MAX_DIFF_LINES };
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      out.unshift({ type: "eq", text: aLines[i - 1], aLine: i, bLine: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.unshift({ type: "add", text: bLines[j - 1], bLine: j });
      j--;
    } else {
      out.unshift({ type: "del", text: aLines[i - 1], aLine: i });
      i--;
    }
  }
  return { ok: true, lines: out };
}
