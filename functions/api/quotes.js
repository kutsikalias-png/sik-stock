const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

function json(data, status = 200, maxAge = 20) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=60`,
      "access-control-allow-origin": "*"
    }
  });
}

async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRange(value) {
  const allowed = new Set(["1d", "5d", "7d", "10d", "1mo", "3mo", "6mo", "1y", "250d", "260d"]);
  return allowed.has(value) ? value : "1d";
}

function normalizeInterval(value) {
  const allowed = new Set(["1m", "5m", "15m", "30m", "60m", "1d"]);
  return allowed.has(value) ? value : "1d";
}

function parseYahooQuote(symbol, data, includeRaw = false) {
  const r = data?.chart?.result?.[0];
  const quote = r?.indicators?.quote?.[0];
  const closes = (quote?.close || []).filter(v => typeof v === "number" && Number.isFinite(v));
  if (!r || closes.length < 1) throw new Error("가격 데이터 부족");

  const meta = r.meta || {};
  const last = Number.isFinite(meta.regularMarketPrice) ? Number(meta.regularMarketPrice) : Number(closes.at(-1));
  const prev = Number.isFinite(meta.previousClose) ? Number(meta.previousClose) : Number(closes.at(-2) ?? last);
  const change = last - prev;
  const changePct = prev ? (change / prev) * 100 : 0;
  const last4 = closes.slice(-4);
  const threeDown = last4.length >= 4 && last4[1] < last4[0] && last4[2] < last4[1] && last4[3] < last4[2];

  const out = { ok: true, symbol, last, prev, change, changePct, threeDown, timestamp: new Date().toISOString(), source: "cloudflare-yahoo-chart" };
  if (includeRaw) out.raw = data;
  return out;
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return json({}, 204, 60);
  const urlObj = new URL(request.url);
  const symbols = (urlObj.searchParams.get("symbols") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 80);
  const range = normalizeRange(urlObj.searchParams.get("range") || "1d");
  const interval = normalizeInterval(urlObj.searchParams.get("interval") || "1m");
  const includeRaw = urlObj.searchParams.get("raw") === "1";

  if (!symbols.length) return json({ ok: false, error: "symbols query가 필요합니다.", items: {} }, 400, 10);

  const timeoutMs = range === "250d" || range === "260d" ? 15000 : 8000;
  const results = await Promise.allSettled(symbols.map(async (symbol) => {
    const endpoint = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const data = await fetchJsonWithTimeout(endpoint, timeoutMs);
    return [symbol, parseYahooQuote(symbol, data, includeRaw)];
  }));

  const items = {};
  results.forEach((r, idx) => {
    const symbol = symbols[idx];
    if (r.status === "fulfilled") items[symbol] = r.value[1];
    else items[symbol] = { ok: false, symbol, error: String(r.reason?.message || r.reason).slice(0, 160), timestamp: new Date().toISOString(), source: "cloudflare-yahoo-chart" };
  });

  return json({ ok: true, source: "cloudflare-pages-function-quotes", generatedAt: new Date().toISOString(), range, interval, items }, 200, range === "250d" || range === "260d" ? 240 : 20);
}
