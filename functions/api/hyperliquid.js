function json(data, status = 200, maxAge = 10) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=30`,
      "access-control-allow-origin": "*"
    }
  });
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return json({}, 204, 60);
  const urlObj = new URL(request.url);
  const mode = urlObj.searchParams.get("mode") || "metaAndAssetCtxs";
  const body = mode === "allMids" ? { type: "allMids" } : { type: "metaAndAssetCtxs", dex: "xyz" };

  try {
    const data = await fetchJsonWithTimeout("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }, 8000);

    return json({ ok: true, source: "cloudflare-pages-function-hyperliquid", mode, generatedAt: new Date().toISOString(), data }, 200, 10);
  } catch (err) {
    return json({ ok: false, source: "cloudflare-pages-function-hyperliquid", mode, generatedAt: new Date().toISOString(), error: String(err.message || err).slice(0, 160) }, 200, 5);
  }
}
