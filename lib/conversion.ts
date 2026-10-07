// Downloads ÷ views. The rate is tiny (a good UGC campaign lands well under
// 1%), so the usual one-decimal percent would print "0.0%" for everything.

export function conversionRate(downloads: number | null, views: number): number | null {
  if (downloads == null || views <= 0) return null;
  return downloads / views;
}

export function fmtConversion(rate: number | null | undefined): string {
  if (rate == null) return "—";
  const pct = rate * 100;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}
