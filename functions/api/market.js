const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const MARKET_SYMBOLS = {
  fx: "KRW=X",
  oil: "CL=F",
  sox: "^SOX",
  nasdaq: "NQ=F",
  kospi: "^KS11",
  kosdaq: "^KQ11"
};

function json(data, status = 200, maxAge = 30) {
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

function parseYahooChart(symbol, data) {
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

  return { ok: true, symbol, last, prev, change, changePct, threeDown, timestamp: new Date().toISOString(), source: "cloudflare-yahoo-chart" };
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return json({}, 204, 60);

  const entries = Object.entries(MARKET_SYMBOLS);
  const results = await Promise.allSettled(entries.map(async ([key, symbol]) => {
    const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=7d&interval=1d`;
    const data = await fetchJsonWithTimeout(url, 8000);
    return [key, parseYahooChart(symbol, data)];
  }));

  const items = {};
  results.forEach((r, idx) => {
    const [key, symbol] = entries[idx];
    if (r.status === "fulfilled") items[key] = r.value[1];
    else items[key] = { ok: false, symbol, error: String(r.reason?.message || r.reason).slice(0, 160), timestamp: new Date().toISOString(), source: "cloudflare-yahoo-chart" };
  });

  return json({ ok: true, source: "cloudflare-pages-function-market", generatedAt: new Date().toISOString(), items }, 200, 30);
}
