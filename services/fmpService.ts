/**
 * fmpService.ts — Financial Modeling Prep integration
 *
 * Industry-standard financial data API. Free tier: 250 calls/day.
 * Sign up at: https://financialmodelingprep.com/register
 *
 * Endpoints used:
 *   GET /v3/profile/{TICKER}             — company name, description, price
 *   GET /v3/income-statement/{TICKER}    — annual revenue, net income, EPS
 *   GET /v3/cash-flow-statement/{TICKER} — capex, D&A, SBC, working capital
 *   GET /v3/key-metrics-ttm/{TICKER}     — TTM FCF per share, PE, etc.
 *   GET /v3/ratios-ttm/{TICKER}          — TTM net margin, revenue growth
 */

import { CompanyData } from "../types";

const FMP_BASE = "https://financialmodelingprep.com/stable";

// ─── Typed API response shapes (minimal, only what we use) ────────────────────

interface FmpProfile {
  symbol: string;
  price: number;
  companyName: string;
  description: string;
  marketCap: number; // Corrected field for 2026 stable endpoint
  sharesOutstanding?: number;
}

interface FmpIncomeStatement {
  date: string;
  revenue: number;
  netIncome: number;
  eps: number;
  netIncomeRatio: number;
  weightedAverageShsOut?: number; // Added for share count accuracy
}

interface FmpCashFlowStatement {
  date: string;
  netIncome: number;
  depreciationAndAmortization: number;
  stockBasedCompensation: number;
  capitalExpenditure: number;
  changeInWorkingCapital: number;
  freeCashFlow: number;
}

interface FmpKeyMetricsTTM {
  peRatioTTM: number;
  freeCashFlowPerShareTTM: number;
  netIncomePerShareTTM: number;
  revenuePerShareTTM: number;
  sharesOutstandingTTM?: number;
}

interface FmpRatiosTTM {
  netProfitMarginTTM: number;
  revenueGrowthTTM?: number;
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fmpFetch = async <T>(endpoint: string, fmpKey: string): Promise<T> => {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${fmpKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "FMP API key is invalid or expired. Please check your key at financialmodelingprep.com"
    );
  }
  if (res.status === 429) {
    throw new Error("FMP free tier daily limit reached (250 calls/day). Try again tomorrow.");
  }
  if (!res.ok) {
    throw new Error(`FMP API error: HTTP ${res.status}`);
  }

  const data = await res.json();

  // FMP returns error objects inside a 200 response if ticker not found
  if (data?.["Error Message"]) {
    throw new Error(`Ticker not found on FMP: ${data["Error Message"]}`);
  }
  if (Array.isArray(data) && data.length === 0) {
    throw new Error(
      `No data found for this ticker on Financial Modeling Prep. ` +
      `Try the exact ticker symbol (e.g. GOOGL, AAPL, MSFT).`
    );
  }

  return data as T;
};

// ─── Main export ──────────────────────────────────────────────────────────────

export const fetchFromFmp = async (
  ticker: string,
  fmpKey: string
): Promise<CompanyData> => {
  const sym = ticker.toUpperCase();

  // Fire all requests in parallel — ~4x faster than sequential
  const [profiles, incomeStmts, cashflows, [keyMetrics], [ratios]] = await Promise.all([
    fmpFetch<FmpProfile[]>(`/profile?symbol=${sym}`, fmpKey),
    fmpFetch<FmpIncomeStatement[]>(`/income-statement?symbol=${sym}`, fmpKey),
    fmpFetch<FmpCashFlowStatement[]>(`/cash-flow-statement?symbol=${sym}`, fmpKey),
    fmpFetch<FmpKeyMetricsTTM[]>(`/key-metrics-ttm?symbol=${sym}`, fmpKey),
    fmpFetch<FmpRatiosTTM[]>(`/ratios-ttm?symbol=${sym}`, fmpKey),
  ]);

  const profile = profiles[0];
  if (!profile) throw new Error(`Ticker "${sym}" not found on Financial Modeling Prep.`);

  // ── Basic fields ──
  const currentPrice = profile.price;
  const companyName = profile.companyName;
  const rawDesc = profile.description || "";
  const firstDotIdx = rawDesc.indexOf(". ");
  const description = firstDotIdx > 0 ? rawDesc.slice(0, firstDotIdx + 1) : rawDesc;

  // ── Shares outstanding (in billions) ──
  // Use weightedAverageShsOut from the newest income statement if available, 
  // otherwise fallback to marketCap / price from the profile.
  const sharesAbsolute = incomeStmts[0]?.weightedAverageShsOut
    ?? (currentPrice > 0 ? profile.marketCap / currentPrice : 0);
  const sharesInMillions = sharesAbsolute / 1e6;

  // ── TTM metrics ── (Fallback to most recent annual if TTM is missing)
  const trailingEps = keyMetrics?.netIncomePerShareTTM 
    || (incomeStmts[0]?.eps ?? 0);
  const fcfPerShare = keyMetrics?.freeCashFlowPerShareTTM 
    || (cashflows[0] && sharesAbsolute > 0 ? cashflows[0].freeCashFlow / sharesAbsolute : 0);
  const currentPe = keyMetrics?.peRatioTTM 
    || (trailingEps > 0 ? currentPrice / trailingEps : 0);

  // ── Historical annual financials (sorted oldest → newest) ──
  const sortedIncome = [...incomeStmts].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const sortedCashflow = [...cashflows].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Build a lookup map: year → cashflow row
  const cfByYear = new Map<string, FmpCashFlowStatement>();
  for (const cf of sortedCashflow) {
    cfByYear.set(new Date(cf.date).getFullYear().toString(), cf);
  }

  const financials = sortedIncome.map((stmt, i) => {
    const year = new Date(stmt.date).getFullYear().toString();
    const cf = sortedCashflow.find(c => new Date(c.date).getFullYear().toString() === year) || sortedCashflow[i];
    const netMargin = stmt.revenue > 0 ? (stmt.netIncome / stmt.revenue) * 100 : 0;
    const changeInWC = cf?.changeInWorkingCapital ?? 0;
    const capexCap = Math.abs(cf?.capitalExpenditure ?? 0);

    return {
      year,
      revenue: parseFloat((stmt.revenue / 1e6).toFixed(2)),
      netMargin: parseFloat(netMargin.toFixed(2)),
      eps: parseFloat((stmt.eps ?? 0).toFixed(2)),
      changeInWorkingCapital: parseFloat((changeInWC / 1e6).toFixed(2)),
      capex: parseFloat((capexCap / 1e6).toFixed(2)),
    };
  });

  // ── Revenue 5Y CAGR ──
  let revenueGrowth5Y = 0;
  if (financials.length >= 2) {
    const newest = financials[financials.length - 1];
    // Find the year exactly 5 years before the newest
    const targetYear = (parseInt(newest.year) - 5).toString();
    const oldest = financials.find(f => f.year === targetYear) || financials[0];
    
    const years = parseInt(newest.year) - parseInt(oldest.year);
    if (years > 0 && oldest.revenue > 0) {
      revenueGrowth5Y = Math.pow(newest.revenue / oldest.revenue, 1 / years) - 1;
    }
  }

  // ── TTM financials (use most recent cashflow statement) ──
  const latestCf = sortedCashflow[sortedCashflow.length - 1];
  const ttmNetIncome = latestCf?.netIncome
    ? latestCf.netIncome / 1e6
    : (incomeStmts[0]?.netIncome ?? 0) / 1e6;

  const ttmDA = (latestCf?.depreciationAndAmortization ?? 0) / 1e6;
  const ttmSBC = (latestCf?.stockBasedCompensation ?? 0) / 1e6;
  const ttmCapex = Math.abs(latestCf?.capitalExpenditure ?? (incomeStmts[0] as any)?.depreciationAndAmortization ?? 0) / 1e6;
  const ttmWC = (latestCf?.changeInWorkingCapital ?? 0) / 1e6;

  // Normalized working capital = average across all available cashflow years
  const wcValues = sortedCashflow
    .map((cf) => cf.changeInWorkingCapital / 1e6)
    .filter((v) => v !== 0);
  const normalizedWC =
    wcValues.length > 0
      ? wcValues.reduce((a, b) => a + b, 0) / wcValues.length
      : ttmWC;

  // Normalized CapEx = average across all available years
  const capexValues = sortedCashflow
    .map((cf) => Math.abs(cf.capitalExpenditure) / 1e6)
    .filter((v) => v !== 0);
  const normalizedCapex = capexValues.length > 0
    ? capexValues.reduce((a, b) => a + b, 0) / capexValues.length
    : ttmCapex;

  return {
    ticker: sym,
    name: companyName,
    price: parseFloat(currentPrice.toFixed(2)),
    eps: parseFloat(trailingEps.toFixed(2)),
    fcfPerShare: parseFloat(fcfPerShare.toFixed(2)),
    sharesOutstanding: parseFloat(sharesInMillions.toFixed(1)),
    currentPe: parseFloat(currentPe.toFixed(1)),
    revenueGrowth5Y: parseFloat(revenueGrowth5Y.toFixed(4)),
    description,
    financials,
    ttmFinancials: {
      netIncome: parseFloat(ttmNetIncome.toFixed(2)),
      depreciation: parseFloat(ttmDA.toFixed(2)),
      stockBasedCompensation: parseFloat(ttmSBC.toFixed(2)),
      capitalExpenditures: parseFloat(ttmCapex.toFixed(2)),
      changeInWorkingCapital: parseFloat(ttmWC.toFixed(2)),
      normalizedWorkingCapital: parseFloat(normalizedWC.toFixed(2)),
      normalizedCapex: parseFloat(normalizedCapex.toFixed(2)),
      suggestedMaintenanceCapexPct: 50, // Gemini analysis will refine this
    },
  };
};
