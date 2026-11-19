import { GoogleGenAI } from "@google/genai";
import { CompanyData, AnalysisResult } from "../types";
import { fetchFromFmp } from "./fmpService";
import { fetchFromYahooFinance, yahooAvailable } from "./yahooFinanceService";
import { analyzeWithLocalClaude } from "./localAiService";

// ─── Free-tier model — Set to the most robust model for 2026 ───
const PRIMARY_MODEL = "gemini-3.1-flash";
const FALLBACK_MODELS = ["gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash-latest", "gemini-1.5-flash"];

const getClient = (apiKey?: string) => {
  const key = apiKey || process.env.API_KEY;
  if (!key) throw new Error("API Key is missing. Please provide a valid Gemini API Key.");
  return new GoogleGenAI({ apiKey: key });
};

/**
 * Retries an async operation with exponential backoff on 429 / 503 errors.
 */
const retryWithBackoff = async <T>(
  fn: (modelName: string) => Promise<T>,
  retries = 3,
  delay = 1500
): Promise<T> => {
  let lastError: any;
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];

  for (const modelName of modelsToTry) {
    try {
      console.log(`[GeminiService] Attempting analysis with: ${modelName}`);
      return await fn(modelName);
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || "";
      
      // If it's a 404 (Model Not Found), try the next model immediately
      if (msg.includes("404") || msg.includes("not found") || msg.includes("not supported")) {
        console.warn(`[GeminiService] Model ${modelName} not available. Trying fallback...`);
        continue;
      }

      // For rate limits, wait and retry current model
      if (msg.includes("429") || msg.includes("Resource has been exhausted")) {
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
          return retryWithBackoff(fn, retries - 1, delay * 2);
        }
      }
      
      throw error;
    }
  }
  throw lastError;
};



/**
 * Robust JSON extractor — three progressive fallbacks so a slightly different
 * model response format never causes a hard crash.
 *
 * Tier 1: Markdown code block  ```json ... ```   (case-insensitive, flexible whitespace)
 * Tier 2: First { … last }  in the raw text      (model skipped the code fence)
 * Tier 3: Throw a descriptive error with the raw text logged for debugging
 */
const extractJson = (text: string, context: string): any => {
  const trimmed = text.trim();
  
  // Tier 0 — Direct parse (handles JSON mode raw strings)
  try {
    return JSON.parse(sanitizeJson(trimmed));
  } catch {
    // fall through to regex extraction
  }

  // Tier 1 — flexible code-fence regex
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(sanitizeJson(fenceMatch[1]));
    } catch {
      // Don't give up yet
    }
  }

  // Tier 2 — grab everything between the first { and the last }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sanitizeJson(candidate));
    } catch {
      // Still failing
    }
  }

  console.error(`[GeminiService] JSON extraction failed for ${context}. Raw text:`, trimmed.slice(0, 200));
  throw new Error("Analysis failed to parse model response.");
};

// ─── Current date context injected into every prompt ───────────────────────────
const getTodayContext = (): string => {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `TODAY'S DATE: ${dateStr}. You MUST use Google Search to retrieve LIVE, UP-TO-DATE information. Do NOT rely on your training data for prices, financials, or news. All data must reflect the current date.`;
};

/**
 * Light JSON sanitizer: removes trailing commas before ] or } which some
 * models occasionally emit, and strips single-line // comments.
 */
const sanitizeJson = (raw: string): string =>
  raw
    .replace(/(^|[^\:])\/\/.*$/gm, "$1")    // strip // comments (avoiding URLs like https://)
    .replace(/,(\s*[}\]])/g, "$1");        // strip trailing commas

/**
 * Safe text extractor — Handles the asynchronous text() method or property
 * returns found in various @google/genai SDK versions.
 */
const safeGetText = async (res: any): Promise<string> => {
  try {
    // 1. Check for standard SDK: res.response.text()
    if (typeof res?.response?.text === "function") {
      return await res.response.text();
    }
    // 2. Check for alternative: res.text()
    if (typeof res?.text === "function") {
      return await res.text();
    }
    // 3. Fallback to property
    const t = res?.text || res?.response?.text;
    return (typeof t === "string" ? t : "") || "";
  } catch (e: any) {
    console.warn("[safeGetText] Error extracting text:", e?.message);
    return "";
  }
};

/**
 * generateWithFallback — tries a request WITH Google Search grounding first.
 * If grounding fails/empty, retries WITHOUT grounding.
 * Used for free-text responses.
 */
const generateWithFallback = async (
  ai: GoogleGenAI,
  prompt: string
): Promise<any> => {
  // Attempt 1: with grounding
  const withGrounding = await retryWithBackoff((modelName) =>
    ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] } as any,
    })
  );

  const groundedText = await safeGetText(withGrounding);
  if (groundedText.trim()) {
    return groundedText;
  }

  // Attempt 2: grounding returned empty — fall back to model knowledge
  console.warn("Grounding returned empty response. Retrying without googleSearch.");
  const resNoGrounding = await retryWithBackoff((modelName) =>
    ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: { maxOutputTokens: 8192 },
    })
  );
  return await safeGetText(resNoGrounding);
};

/**
 * generateJsonContent — for requests that MUST return valid JSON.
 * 1. Tries with grounding (live web data — best) and checks for valid JSON
 * 2. Falls back to JSON-mode (responseMimeType: application/json) which
 *    forces the model to always output parseable JSON, no prose.
 *
 * NOTE: responseMimeType cannot be used WITH googleSearch tools,
 * which is why we try grounding first then switch modes.
 */
const generateJsonContent = async (
  ai: GoogleGenAI,
  prompt: string
): Promise<string> => {
  // Attempt 1: grounding (may give better factual depth)
  try {
    const res = await retryWithBackoff((modelName) =>
      ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] } as any,
      })
    );
    const text = await safeGetText(res);
    if (text && (text.includes("{") || text.includes("```json"))) {
      return text;
    }
  } catch (e) {
    console.warn("[Nomad] Grounding attempt failed:", (e as any)?.message);
  }

  // Attempt 2: JSON mode
  console.warn("[Nomad] Grounding gave no JSON or failed. Switching to strict JSON-mode.");
  
  const cleanPrompt = prompt
    .replace(/Return ONLY valid JSON inside a markdown code block:?/gi, "Return ONLY raw JSON:")
    .replace(/```json[\s\S]*?```/gi, "JSON object only.");

  const res = await retryWithBackoff((modelName) =>
    ai.models.generateContent({
      model: modelName,
      contents: cleanPrompt,
      config: { 
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        temperature: 0.2
      },
    })
  );
  const jsonText = await safeGetText(res);
  return jsonText;
};

// ─────────────────────────────────────────────────────────────────────────────
// fetchCompanyFinancials
// Primary: Financial Modeling Prep (FMP) — live, structured, CORS-friendly.
// Fallback: Gemini JSON-mode — only if FMP key not provided or FMP fails.
// ─────────────────────────────────────────────────────────────────────────────

export const fetchCompanyFinancials = async (
  ticker: string,
  apiKey?: string,
  fmpKey?: string
): Promise<CompanyData> => {

  // ── Primary: Yahoo Finance (no key, global, also by company name) ─────
  // Needs the same-origin /yf proxy (npm run dev or "AVAA LASKURI.bat").
  let yahooError: any = null;
  if (yahooAvailable()) {
    try {
      console.log(`[Nomad] Fetching ${ticker} from Yahoo Finance…`);
      return await fetchFromYahooFinance(ticker);
    } catch (e: any) {
      yahooError = e;
      console.warn(`[Nomad] Yahoo failed (${e?.message}). Trying FMP / Gemini…`);
    }
  }
  // Without keys there is nothing else to try: report Yahoo's answer.
  if (!fmpKey && !(apiKey || process.env.API_KEY)) {
    throw new Error(
      yahooError?.message
        ? `${yahooError.message} Try the exact ticker, e.g. KNEBV.HE or AMZN.`
        : 'Open the app with "AVAA LASKURI.bat" so it can reach Yahoo Finance.'
    );
  }

  // ── Secondary: Financial Modeling Prep (FMP) ───────────────────────────
  if (fmpKey) {
    try {
      console.log(`[Nomad] Fetching ${ticker} from FMP…`);
      const data = await fetchFromFmp(ticker, fmpKey);
      console.log(`[Nomad] FMP success — price: $${data.price}, name: ${data.name}`);
      return data;
    } catch (fmpError: any) {
      // Log failure and fallback to Gemini regardless of key validity
      console.warn(`[Nomad] FMP failed (${fmpError?.message}). Falling back to Gemini…`);
    }
  }

  // ── Fallback: Gemini JSON-mode ───────────────────────────────────────
  const ai = getClient(apiKey);
  const today = getTodayContext();
  const currentYear = new Date().getFullYear();
  const priorYear = currentYear - 1;

  console.warn(`[Nomad] No FMP key — using Gemini for financial data (less reliable).`);

  const prompt = `
${today}

Return financial data for stock ticker: ${ticker.toUpperCase()}.
All currency values (revenue, netIncome, capex, etc.) MUST be in $ MILLIONS.
Return ONLY valid JSON with this exact shape:
{
  "name": "Company Name",
  "price": 123.45,
  "eps": 5.67,
  "fcfPerShare": 6.78,
  "sharesOutstanding": 50.7,
  "currentPe": 20.5,
  "revenueGrowth5Y": 0.15,
  "description": "One sentence about what the company does.",
  "financials": [
    {"year": "${priorYear - 4}", "revenue": 50500, "netMargin": 12.5, "eps": 3.20, "changeInWorkingCapital": -500, "capex": 2800},
    {"year": "${priorYear}", "revenue": 60200, "netMargin": 13.0, "eps": 3.80, "changeInWorkingCapital": 200, "capex": 3100}
  ],
  "ttmFinancials": {
    "netIncome": 10500,
    "depreciation": 2500,
    "stockBasedCompensation": 1200,
    "capitalExpenditures": 3000,
    "changeInWorkingCapital": -500,
    "normalizedWorkingCapital": -150,
    "normalizedCapex": 2900,
    "suggestedMaintenanceCapexPct": 50
  }
}
  `;

  const text = await generateJsonContent(ai, prompt);

  if (!text.trim()) {
    throw new Error(
      "Could not retrieve financial data. Add a Financial Modeling Prep (FMP) key for reliable data."
    );
  }

  const data = extractJson(text, "financial data");
  return { ticker: ticker.toUpperCase(), ...data };
};

// ─────────────────────────────────────────────────────────────────────────────

export const analyzeMoatRobustness = async (
  ticker: string,
  companyName: string,
  apiKey?: string,
  engine: "gemini" | "local" = "gemini"
): Promise<AnalysisResult> => {
  const today = getTodayContext();
  const currentYear = new Date().getFullYear();

  const prompt = `
${today}

Use Google Search to analyze ${companyName} (${ticker}) for an investment research report.

INSTRUCTIONS:
1. Primary Competitive Advantage (Moat):
   - Identify: "Scale Economics Shared", "Network Effects", "Switching Costs", "Intangible Assets", "Cost Advantage", or "Efficient Scale"
   - Deep analysis of how the moat works specifically for this company
   - Moat Score 1-10 (10 = Unassailable)

2. Moat Verdict (Morningstar style):
   - "Wide", "Narrow", or "None"
   - Detailed explanation

3. Recent News (SEARCH for the last 30 days):
   - 2-3 headlines with source and "Signal"/"Noise" verdict.

4. Investor Presentation: Latest slides URL.

5. Key Performance Indicators (KPIs): 2-3 business KPIs for last 3 years.

6. Management Quality (Nick Sleep style): Score 1-10, Verdict, and 3 traits.

7. Capital Allocation (last 3 years): CapEx, R&D, Buybacks (MUST be in $ MILLIONS).

8. Destination Analysis: 3 scenarios (Conservative, Base, Optimistic) with CAGR and reasoning.

Return ONLY a valid JSON object. No markdown, no fences:
{
  "summary": "Executive summary of business quality.",
  "moatScore": 8,
  "competitiveAdvantageAnalysis": "Deep analysis of the moat...",
  "moatVerdict": "Wide",
  "moatSource": "Cost Advantage",
  "moatDescription": "Why the moat is wide/narrow...",
  "news": [
    {
      "title": "Headline",
      "date": "YYYY-MM-DD",
      "source": "Reuters",
      "category": "Signal",
      "reasoning": "Why this is a signal or noise."
    }
  ],
  "investorPresentation": {
    "title": "Q4 ${currentYear - 1} Earnings Slides",
    "url": "https://..."
  },
  "kpis": [
    {
      "title": "KPI Name",
      "unit": "Millions",
      "description": "What this KPI measures",
      "data": [
        {"year": "2021", "value": 203.6},
        {"year": "2022", "value": 221.8}
      ]
    }
  ],
  "managementAnalysis": {
    "score": 8,
    "verdict": "Long-term",
    "details": "Analysis of management quality...",
    "traits": ["Customer Focused", "Capital Discipline", "Long-term Horizon"]
  },
  "capitalAllocation": [
    {
      "year": "2022",
      "capex": 10200,
      "rd": 5000,
      "dividends": 2100,
      "buybacks": 3000,
      "revenue": 100000,
      "marketCap": 500000,
      "reinvestment": 15200,
      "payout": 5100
    }
  ],
  "destinationSuggestions": [
    {"scenario": "Conservative", "growthRate": 5, "terminalMultiple": 15, "reasoning": "..."},
    {"scenario": "Base", "growthRate": 10, "terminalMultiple": 20, "reasoning": "..."},
    {"scenario": "Optimistic", "growthRate": 15, "terminalMultiple": 25, "reasoning": "..."}
  ]
}
\`\`\`
  `;

  // "local": the Claude already signed in on this computer (no key). Same JSON shape;
  // the prompt itself is in muut/analyysi-prompt.txt next to the launcher.
  const text = engine === "local"
    ? await analyzeWithLocalClaude(ticker, companyName)
    : await generateJsonContent(getClient(apiKey), prompt);

  let result: any = {};
  try {
    result = extractJson(text, "moat analysis");
  } catch (e) {
    // Graceful degradation — partially populate so the UI doesn't crater
    console.error("Moat analysis parse failed:", e);
    console.error("Raw text was (length:", text?.length, "):", text);
    result = {
      summary: "Analysis could not be fully structured. Please try again.",
      moatScore: 5,
      competitiveAdvantageAnalysis: "Data unavailable.",
      moatVerdict: "Unknown",
      moatSource: "Unknown",
      moatDescription: "Analysis failed to parse.",
      news: [],
      kpis: [],
      managementAnalysis: { score: 5, verdict: "Unknown", details: "Unavailable.", traits: [] },
      capitalAllocation: [],
      destinationSuggestions: [],
    };
  }

  return {
    summary: result.summary || "",
    moatScore: result.moatScore || 5,
    competitiveAdvantageAnalysis: result.competitiveAdvantageAnalysis || "",
    moatVerdict: result.moatVerdict || "Unknown",
    moatSource: result.moatSource || "Unknown",
    moatDescription: result.moatDescription || "No details provided.",
    news: result.news || [],
    investorPresentation: result.investorPresentation,
    kpis: result.kpis || [],
    managementAnalysis: result.managementAnalysis,
    capitalAllocation: result.capitalAllocation || [],
    destinationSuggestions: result.destinationSuggestions || [],
    sources: [],
  };
};
