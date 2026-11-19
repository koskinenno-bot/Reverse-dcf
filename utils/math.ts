/**
 * Calculates the present value of a stock based on a 2-stage DCF.
 * Stage 1: High growth for `years`
 * Stage 2: Terminal value based on a multiple of earnings in the final year
 */
export const calculateIntrinsicValue = (
  currentFcf: number,
  growthRate: number,
  discountRate: number,
  years: number = 10,
  terminalMultiple: number = 15
): number => {
  let presentValueSum = 0;
  let futureFcf = currentFcf;

  // Stage 1: Growth Period
  for (let i = 1; i <= years; i++) {
    futureFcf = futureFcf * (1 + growthRate);
    presentValueSum += futureFcf / Math.pow(1 + discountRate, i);
  }

  // Stage 2: Terminal Value
  const terminalValue = futureFcf * terminalMultiple;
  const presentValueTerminal = terminalValue / Math.pow(1 + discountRate, years);

  return presentValueSum + presentValueTerminal;
};

/**
 * Iteratively finds the implied growth rate for a current price.
 */
export const findImpliedGrowth = (
  currentPrice: number,
  currentFcf: number,
  discountRate: number,
  years: number = 10,
  terminalMultiple: number = 15
): number => {
  // No meaningful answer for non-positive earnings, or when even the range edges
  // (-50% … +100% a year) can't reach the price: report NaN instead of an edge value.
  if (!(currentFcf > 0) || !(currentPrice > 0)) return NaN;
  if (calculateIntrinsicValue(currentFcf, -0.5, discountRate, years, terminalMultiple) > currentPrice) return NaN;
  if (calculateIntrinsicValue(currentFcf, 1.0, discountRate, years, terminalMultiple) < currentPrice) return NaN;

  let low = -0.5;
  let high = 1.0;
  let guess = 0.0;
  let calculatedPrice = 0;

  for (let i = 0; i < 100; i++) {
    guess = (low + high) / 2;
    calculatedPrice = calculateIntrinsicValue(currentFcf, guess, discountRate, years, terminalMultiple);
    
    if (Math.abs(calculatedPrice - currentPrice) < 0.01) {
      return guess;
    }

    if (calculatedPrice > currentPrice) {
      high = guess;
    } else {
      low = guess;
    }
  }
  return guess;
};

/**
 * Calculates the Annualized Return (CAGR) of the share price.
 * Assuming the share price converges to (Future Earnings * Exit Multiple) in `years`.
 */
export const calculateScenarioCAGR = (
  currentPrice: number,
  currentOwnersEarnings: number,
  earningsGrowthRate: number,
  exitMultiple: number,
  years: number
): number => {
  const futureEarnings = currentOwnersEarnings * Math.pow(1 + earningsGrowthRate, years);
  const futurePrice = futureEarnings * exitMultiple;
  
  // Avoid division by zero or negative roots if price is weird (though unlikely here)
  if (currentPrice <= 0 || futurePrice < 0) return 0;

  // CAGR formula: (End Value / Start Value) ^ (1/n) - 1
  const cagr = Math.pow(futurePrice / currentPrice, 1 / years) - 1;
  return cagr;
};
type Company = import('../types').CompanyData;

/**
 * Default maintenance capex as % of capex: the data source's suggestion, otherwise
 * D&A / capex capped at 100% (a common, conservative proxy).
 */
export const defaultMaintenancePct = (company: Company): number => {
  const t = company.ttmFinancials;
  if (t?.suggestedMaintenanceCapexPct !== undefined && t.suggestedMaintenanceCapexPct > 0) {
    return Math.min(100, Math.round(t.suggestedMaintenanceCapexPct));
  }
  const capex = t?.normalizedCapex ?? t?.capitalExpenditures ?? 0;
  if (capex > 0 && t?.depreciation) return Math.min(100, Math.round((t.depreciation / capex) * 100));
  return 100;
};

/**
 * Owner's earnings per share with the same formula and defaults as the Buffett calculator:
 * net income + D&A + normalized ΔWC − maintenance capex. Falls back to FCF per share.
 */
export const estimateOwnersEarnings = (company: Company): number => {
  const t = company.ttmFinancials;
  const shares = company.sharesOutstanding;
  if (!t || !shares || !(t.netIncome || t.depreciation)) return company.fcfPerShare;
  const wc = t.normalizedWorkingCapital ?? t.changeInWorkingCapital ?? 0;
  const capex = t.normalizedCapex ?? t.capitalExpenditures ?? 0;
  const oe = t.netIncome + t.depreciation + wc - capex * (defaultMaintenancePct(company) / 100);
  return parseFloat((oe / shares).toFixed(2));
};

export interface OeYear {
  year: string;
  perShare: number;
}

/** Owner's earnings per share for each reported year (needs net income, D&A and shares per year). */
// Working capital swings are smoothed to their average, as in the calculator's default.
export const ownersEarningsHistory = (company: Company): OeYear[] => {
  const rows = [...(company.financials ?? [])]
    .filter((f) => f.netIncome !== undefined && f.depreciation !== undefined && f.shares)
    .sort((a, b) => parseInt(a.year) - parseInt(b.year));
  const pct = defaultMaintenancePct(company);
  const wc = rows.length ? rows.reduce((sum, f) => sum + (f.changeInWorkingCapital ?? 0), 0) / rows.length : 0;
  return rows.map((f) => {
    const maintenance = (f.capex ?? 0) * (pct / 100); // same maintenance % as the calculator
    const oe = f.netIncome! + f.depreciation! + wc - maintenance;
    return { year: f.year, perShare: oe / f.shares! };
  });
};

/** CAGR between the first and last year; null when either end is not positive. */
export const historyCagr = (rows: { year: string; perShare: number }[]) => {
  if (rows.length < 2) return null;
  const a = rows[0];
  const b = rows[rows.length - 1];
  const n = parseInt(b.year) - parseInt(a.year);
  if (n <= 0 || a.perShare <= 0 || b.perShare <= 0) return null;
  return { value: Math.pow(b.perShare / a.perShare, 1 / n) - 1, years: n, startYear: a.year, endYear: b.year };
};
