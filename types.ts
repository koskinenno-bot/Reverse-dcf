
export interface WatchlistItem {
  ticker: string;
  name: string;
  price: number;
  change?: number; // % change on the last trading day (Yahoo only)
  currency?: string;
  week52Low?: number;
  week52High?: number;
}

export interface CompanyData {
  ticker: string;
  name: string;
  price: number;
  eps: number;
  fcfPerShare: number;
  revenueGrowth5Y: number; // Average annualized
  currentPe: number;
  description: string;
  sharesOutstanding: number; // in Millions ($M)
  currency?: string; // reporting currency (Yahoo); "$" assumed when missing
  dayChangePct?: number;
  week52Low?: number;
  week52High?: number;
  financials: {
    year: string;
    revenue: number; // in Millions ($M)
    netMargin: number;
    eps: number; // Added EPS history
    changeInWorkingCapital?: number; // in Millions ($M)
    capex?: number; // in Millions ($M)
    netIncome?: number; // in Millions — lets us compute historical owner earnings
    depreciation?: number; // in Millions
    shares?: number; // diluted average, in Millions
  }[];
  ttmFinancials: {
    netIncome: number; // in Millions ($M)
    depreciation: number; // in Millions ($M)
    stockBasedCompensation: number; // in Millions ($M)
    changeInWorkingCapital: number; // in Millions ($M)
    normalizedWorkingCapital?: number; // in Millions ($M)
    normalizedCapex?: number; // in Millions ($M)
    capitalExpenditures: number; // in Millions ($M)
    suggestedMaintenanceCapexPct?: number; 
  };
}

export interface NewsItem {
  title: string;
  date: string;
  source: string;
  category?: 'Signal' | 'Noise';
  reasoning?: string;
}

export interface CapitalAllocationData {
  year: string;
  capex: number;
  rd: number;
  dividends: number;
  buybacks: number;
  revenue: number;
  marketCap: number;
  reinvestment: number; // Sum of capex + rd
  payout: number; // Sum of dividends + buybacks
}

export interface KpiDataPoint {
  year: string;
  value: number;
}

export interface KpiItem {
  title: string;
  unit: string;
  data: KpiDataPoint[];
  description?: string;
}

export interface DestinationSuggestion {
  scenario: string; // e.g., "Conservative", "Base", "Optimistic"
  growthRate: number;
  terminalMultiple: number;
  reasoning: string;
}

export interface AnalysisResult {
  summary: string;
  moatScore: number; // 1-10
  competitiveAdvantageAnalysis: string;
  moatVerdict: string; // Wide, Narrow, None
  moatSource: string;
  moatDescription: string;
  sources: {
    title: string;
    uri: string;
  }[];
  news: NewsItem[];
  investorPresentation?: {
    title: string;
    url: string;
  };
  kpis?: KpiItem[];
  managementAnalysis?: {
    score: number; // 1-10
    verdict: string; // e.g. "Fanatical", "Long-term", "Corporate"
    details: string;
    traits: string[];
  };
  capitalAllocation?: CapitalAllocationData[];
  destinationSuggestions?: DestinationSuggestion[];
}

export interface ValuationScenario {
  growthRate: number;
  impliedPrice: number;
  years: number;
  discountRate: number;
  terminalMultiple: number;
}

export enum LoadingState {
  IDLE,
  SEARCHING,
  ANALYZING,
  COMPLETE,
  ERROR
}