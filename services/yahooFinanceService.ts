/**
 * yahooFinanceService.ts — Yahoo Finance, no API key, global coverage
 * (Helsinki .HE, Stockholm .ST, Oslo .OL, Copenhagen .CO, US, …).
 *
 * Yahoo blocks direct browser requests (CORS), so calls go through a same-origin
 * proxy at /yf: the Vite dev server (npm run dev) or the bundled PowerShell launcher
 * ("AVAA LASKURI.bat"). In AI Studio or a plain file there is no proxy; the caller
 * then falls back to FMP / Gemini as before.
 *
 * Endpoints (tested from a real Windows machine, no crumb needed):
 *   /v1/finance/search?q=…                      name → symbols
 *   /v8/finance/chart/{SYM}                     price, currency, name
 *   /ws/fundamentals-timeseries/…/{SYM}         annual statements
 */

import { CompanyData } from "../types";

export const yahooAvailable = () =>
  typeof location !== "undefined" && location.protocol.startsWith("http");

class NotFound extends Error {}

const getJson = async (path: string): Promise<any> => {
  const res = await fetch(`/yf${path}`, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Yahoo proxy not available");
  }
  // Yahoo's own error answer (e.g. 404 for an unknown ticker) is still an answer.
  if (!res.ok && !(data?.chart || data?.finance || data?.timeseries)) {
    throw new Error(`Yahoo HTTP ${res.status}`);
  }
  return data;
};

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export const searchYahoo = async (q: string): Promise<SearchHit[]> => {
  const data = await getJson(
    `/v1/finance/search?q=${encodeURIComponent(q.trim())}&quotesCount=10&newsCount=0&listsCount=0`
  );
  return ((data?.quotes ?? []) as any[])
    .filter((x) => x.symbol && (x.quoteType === "EQUITY" || x.quoteType === "ETF"))
    .map((x) => ({
      symbol: String(x.symbol),
      name: String(x.longname ?? x.shortname ?? x.symbol),
      exchange: String(x.exchDisp ?? x.exchange ?? ""),
      type: String(x.quoteType),
    }));
};

/** Best match: name starts with the query as a whole word ("KONE Oyj", not "Konecranes"). */
export const bestMatch = (q: string, hits: SearchHit[]): SearchHit | undefined => {
  const esc = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`^${esc}(\\b|$)`, "i");
  const score = (h: SearchHit) =>
    (h.type === "EQUITY" ? 1 : 0) +
    (word.test(h.name) ? 4 : 0) +
    (h.symbol.toUpperCase().startsWith(q.trim().toUpperCase()) ? 2 : 0);
  return [...hits].sort((a, b) => score(b) - score(a))[0];
};

const KEYS = [
  "TotalRevenue",
  "NetIncomeCommonStockholders",
  "NetIncome",
  "DilutedEPS",
  "DilutedAverageShares",
  "BasicAverageShares",
  "DepreciationAndAmortization",
  "DepreciationAmortizationDepletion",
  "CapitalExpenditure",
  "ChangeInWorkingCapital",
  "StockBasedCompensation",
  "FreeCashFlow",
  "OrdinarySharesNumber",
  "NetPPE",
];

type Row = Record<string, number>;

export const parseTimeseries = (json: any): { byYear: Map<number, Row>; currency: string | null } => {
  const byYear = new Map<number, Row>();
  let currency: string | null = null;
  for (const item of json?.timeseries?.result ?? []) {
    const type: string | undefined = item?.meta?.type?.[0];
    if (!type) continue;
    const key = type.replace(/^annual/, "");
    for (const e of item[type] ?? []) {
      const v = e?.reportedValue?.raw;
      if (!e?.asOfDate || typeof v !== "number") continue;
      const year = new Date(e.asOfDate).getUTCFullYear();
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)![key] = v;
      if (!currency && e.currencyCode) currency = e.currencyCode;
    }
  }
  return { byYear, currency };
};

/** London pence etc. */
const SUBUNIT: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

const M = (x: number | undefined) => (x ?? 0) / 1e6;
const r2 = (x: number) => parseFloat(x.toFixed(2));

interface Quote {
  meta: any;
  price: number;
  currency: string;
  changePct?: number;
  week52Low?: number;
  week52High?: number;
}

/** Price, day change and 52-week range from a /v8/finance/chart answer (pence → pounds). */
const readQuote = (chart: any): Quote | null => {
  const res = chart?.chart?.result?.[0];
  const meta = res?.meta;
  if (!meta) return null;
  const k = SUBUNIT[meta.currency] ? 0.01 : 1;
  const closes: number[] = (res?.indicators?.quote?.[0]?.close ?? []).filter((x: any) => typeof x === "number");
  const price = (meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0) * k;
  const prev = closes.length >= 2 ? closes[closes.length - 2] * k : undefined;
  return {
    meta,
    price,
    currency: SUBUNIT[meta.currency] ?? meta.currency ?? "USD",
    changePct: prev ? ((price - prev) / prev) * 100 : undefined,
    week52Low: meta.fiftyTwoWeekLow ? meta.fiftyTwoWeekLow * k : undefined,
    week52High: meta.fiftyTwoWeekHigh ? meta.fiftyTwoWeekHigh * k : undefined,
  };
};

/** Lightweight refresh for the watchlist (quoted currency). */
export const fetchYahooQuote = async (symbol: string): Promise<Quote | null> =>
  readQuote(await getJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`));

const fetchSymbol = async (symbol: string): Promise<CompanyData> => {
  const sym = symbol.trim().toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const types = KEYS.map((k) => `annual${k}`).join(",");
  const [chart, ts] = await Promise.all([
    getJson(`/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`),
    getJson(
      `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types}&period1=946684800&period2=${now}`
    ),
  ]);

  const q = readQuote(chart);
  if (!q) throw new NotFound(`Ticker "${sym}" not found on Yahoo Finance.`);
  const meta = q.meta;
  let { price, week52Low, week52High } = q;
  const priceCurrency = q.currency;

  const { byYear, currency } = parseTimeseries(ts);
  // Convert price into the reporting currency (e.g. an ADR quoted in USD, reporting in DKK).
  if (currency && currency !== priceCurrency) {
    try {
      const fx = await getJson(`/v8/finance/chart/${priceCurrency}${currency}=X?range=5d&interval=1d`);
      const rate = fx?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof rate === "number" && rate > 0) {
        price *= rate;
        if (week52Low) week52Low *= rate;
        if (week52High) week52High *= rate;
      }
    } catch {
      /* keep quoted price */
    }
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0) throw new Error(`Yahoo returned no financial statements for ${sym}.`);
  const latest = byYear.get(years[years.length - 1])!;

  const ni = (r: Row) => r.NetIncomeCommonStockholders ?? r.NetIncome ?? 0;
  const da = (r: Row) => r.DepreciationAndAmortization ?? r.DepreciationAmortizationDepletion ?? 0;
  const shares = (r: Row) => r.DilutedAverageShares ?? r.BasicAverageShares ?? latest.OrdinarySharesNumber ?? 0;
  const sharesNow = latest.OrdinarySharesNumber ?? shares(latest);

  const financials = years.map((y) => {
    const r = byYear.get(y)!;
    const rev = r.TotalRevenue ?? 0;
    const eps = r.DilutedEPS ?? (shares(r) > 0 ? ni(r) / shares(r) : 0);
    return {
      year: String(y),
      revenue: r2(M(rev)),
      netMargin: rev > 0 ? r2((ni(r) / rev) * 100) : 0,
      eps: r2(eps),
      changeInWorkingCapital: r2(M(r.ChangeInWorkingCapital)),
      capex: r2(Math.abs(M(r.CapitalExpenditure))),
      netIncome: r2(M(ni(r))),
      depreciation: r2(M(da(r))),
      shares: parseFloat(M(shares(r)).toFixed(1)),
    };
  }).filter((f) => f.revenue > 0);

  const wc = years.map((y) => M(byYear.get(y)!.ChangeInWorkingCapital));
  const capexAll = years.map((y) => Math.abs(M(byYear.get(y)!.CapitalExpenditure))).filter((v) => v > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const ttmNi = M(ni(latest));
  const ttmDa = M(da(latest));
  const ttmCapex = Math.abs(M(latest.CapitalExpenditure));
  const eps = financials.length ? financials[financials.length - 1].eps : 0;
  const fcf = latest.FreeCashFlow;

  let revenueGrowth5Y = 0;
  if (financials.length >= 2) {
    const a = financials[0];
    const b = financials[financials.length - 1];
    const n = parseInt(b.year) - parseInt(a.year);
    if (n > 0 && a.revenue > 0) revenueGrowth5Y = Math.pow(b.revenue / a.revenue, 1 / n) - 1;
  }

  // Maintenance capex, Greenwald: capex minus growth capex, where growth capex =
  // (PP&E / sales) × sales growth. Averaged over the years Yahoo has; falls back to
  // D&A / capex (capped at 100%) when PP&E is missing.
  const greenwald: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const r = byYear.get(years[i])!;
    const prev = byYear.get(years[i - 1])!;
    const capex = Math.abs(r.CapitalExpenditure ?? 0);
    if (!capex || !r.TotalRevenue || !prev.TotalRevenue || r.NetPPE === undefined) continue;
    const growthCapex = (r.NetPPE / r.TotalRevenue) * Math.max(0, r.TotalRevenue - prev.TotalRevenue);
    greenwald.push(Math.min(1, Math.max(0, (capex - growthCapex) / capex)));
  }
  const maintPct = greenwald.length
    ? Math.round(avg(greenwald) * 100)
    : ttmCapex > 0 ? Math.round(Math.min(1, ttmDa / ttmCapex) * 100) : 100;

  return {
    ticker: sym,
    name: meta.longName ?? meta.shortName ?? sym,
    price: r2(price),
    eps,
    fcfPerShare: fcf !== undefined && sharesNow > 0 ? r2(fcf / sharesNow) : 0,
    sharesOutstanding: parseFloat(M(sharesNow).toFixed(1)),
    currency: currency ?? priceCurrency,
    dayChangePct: q.changePct,
    week52Low: week52Low ? r2(week52Low) : undefined,
    week52High: week52High ? r2(week52High) : undefined,
    currentPe: eps > 0 ? parseFloat((price / eps).toFixed(1)) : 0,
    revenueGrowth5Y: parseFloat(revenueGrowth5Y.toFixed(4)),
    description: "",
    financials,
    ttmFinancials: {
      netIncome: r2(ttmNi),
      depreciation: r2(ttmDa),
      stockBasedCompensation: r2(M(latest.StockBasedCompensation)),
      capitalExpenditures: r2(ttmCapex),
      changeInWorkingCapital: r2(M(latest.ChangeInWorkingCapital)),
      normalizedWorkingCapital: r2(avg(wc)),
      normalizedCapex: r2(avg(capexAll)),
      suggestedMaintenanceCapexPct: maintPct,
    },
  };
};

/** Fetch by ticker; if Yahoo doesn't know it (e.g. "KONE"), resolve by name (→ KNEBV.HE). */
export const fetchFromYahooFinance = async (query: string): Promise<CompanyData> => {
  try {
    return await fetchSymbol(query);
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    const best = bestMatch(query, await searchYahoo(query).catch(() => []));
    if (!best || best.symbol.toUpperCase() === query.trim().toUpperCase()) throw e;
    const data = await fetchSymbol(best.symbol);
    return { ...data, description: `${best.name} (${best.exchange}).` };
  }
};
