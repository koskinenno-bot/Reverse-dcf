/**
 * localAiService.ts — AI analysis without any API key.
 *
 * The launcher ("AVAA LASKURI.bat") runs the Claude Code CLI already installed and
 * signed in on this computer. The page only sends a ticker and a company name; the
 * prompt lives in muut\analyysi-prompt.txt and Claude may use web search only.
 * The browser starts a job and polls, so Yahoo requests are not blocked meanwhile.
 */

const HEADERS = { "X-Nomad": "1" }; // custom header: other websites can't call the local endpoint

export const localAiAvailable = async (): Promise<boolean> => {
  if (typeof location === "undefined" || !location.protocol.startsWith("http")) return false;
  try {
    const res = await fetch("/ai/ping", { headers: HEADERS, signal: AbortSignal.timeout(5_000) });
    const data = await res.json();
    return !!data?.ok;
  } catch {
    return false;
  }
};

export const analyzeWithLocalClaude = async (ticker: string, name: string, timeoutMs = 360_000): Promise<string> => {
  const start = await fetch(
    `/ai/start?ticker=${encodeURIComponent(ticker)}&name=${encodeURIComponent(name)}`,
    { method: "POST", headers: HEADERS }
  );
  const job = await start.json().catch(() => null);
  if (!start.ok || !job?.id) throw new Error(job?.error || "Claude could not be started on this computer.");

  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await fetch(`/ai/result?id=${encodeURIComponent(job.id)}`, { headers: HEADERS });
    if (res.status === 202) continue;
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(data?.error || `Claude failed (HTTP ${res.status}).`);
    return String(data.text ?? "");
  }
  throw new Error("Claude took too long to answer.");
};
