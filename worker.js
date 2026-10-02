const CORS = {
  "Access-Control-Allow-Origin": "https://rckz62hr95-hue.github.io",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extra
    }
  });

const headers = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://finance.yahoo.com/"
};

function cookieHeader(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map(v => v.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function getYahooSession() {
  // Warm the Yahoo session and collect the A3 cookie when available.
  let cookie = "";
  try {
    const warm = await fetch("https://fc.yahoo.com", {
      method: "GET",
      headers
    });
    cookie = cookieHeader(warm.headers.get("set-cookie"));
  } catch (_) {}

  // Yahoo's chart endpoint normally does not require a crumb, but obtaining
  // one gives us an additional session-compatible request path.
  let crumb = "";
  for (const host of [
    "https://query2.finance.yahoo.com",
    "https://query1.finance.yahoo.com"
  ]) {
    try {
      const r = await fetch(`${host}/v1/test/getcrumb`, {
        headers: cookie ? { ...headers, Cookie: cookie } : headers
      });
      const t = (await r.text()).trim();
      if (r.ok && t && !t.includes("Too Many Requests") && !t.startsWith("<")) {
        crumb = t;
        break;
      }
    } catch (_) {}
  }
  return { cookie, crumb };
}

async function yahooChart(symbol, interval, range) {
  const session = await getYahooSession();
  const hosts = [
    "https://query2.finance.yahoo.com",
    "https://query1.finance.yahoo.com"
  ];

  const errors = [];

  for (const host of hosts) {
    const params = new URLSearchParams({
      range,
      interval,
      events: "div,splits",
      includePrePost: "false",
      lang: "ja-JP",
      region: "JP",
      corsDomain: "finance.yahoo.com"
    });
    if (session.crumb) params.set("crumb", session.crumb);

    try {
      const r = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`,
        {
          headers: session.cookie
            ? { ...headers, Cookie: session.cookie }
            : headers
        }
      );

      const text = await r.text();

      if (r.ok) {
        try {
          const data = JSON.parse(text);
          const result = data?.chart?.result?.[0];
          if (result) return { ok: true, data: result, host };
          errors.push(`${host}: no chart result`);
        } catch (_) {
          errors.push(`${host}: invalid JSON`);
        }
      } else {
        errors.push(`${host}: HTTP ${r.status}`);
      }
    } catch (e) {
      errors.push(`${host}: ${e?.message || "fetch failed"}`);
    }
  }

  return {
    ok: false,
    errors,
    hasCookie: Boolean(session.cookie),
    hasCrumb: Boolean(session.crumb)
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname !== "/api/chart") {
      return json({
        ok: true,
        version: "v7",
        endpoint: "/api/chart",
        usage: "/api/chart?symbol=7203.T&interval=1d&range=1mo"
      });
    }

    const symbol = (url.searchParams.get("symbol") || "").trim();
    const interval = (url.searchParams.get("interval") || "1d").trim();
    const range = (url.searchParams.get("range") || "1mo").trim();

    if (!symbol) return json({ error: "symbol required" }, 400);

    const allowedIntervals = new Set([
      "1m", "2m", "5m", "15m", "30m", "60m", "90m",
      "1h", "1d", "5d", "1wk", "1mo", "3mo"
    ]);
    const allowedRanges = new Set([
      "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"
    ]);

    if (!allowedIntervals.has(interval)) {
      return json({ error: "invalid interval" }, 400);
    }
    if (!allowedRanges.has(range)) {
      return json({ error: "invalid range" }, 400);
    }

    const result = await yahooChart(symbol, interval, range);

    if (!result.ok) {
      return json({
        error: "upstream unavailable",
        version: "v7",
        detail: result.errors,
        yahooSession: {
          cookie: result.hasCookie,
          crumb: result.hasCrumb
        }
      }, 502);
    }

    const meta = result.data.meta || {};
    const quote = result.data.indicators?.quote?.[0] || {};
    const timestamps = result.data.timestamp || [];

    return json({
      version: "v7",
      symbol: meta.symbol || symbol,
      interval,
      range,
      timestamp: timestamps,
      open: quote.open || [],
      high: quote.high || [],
      low: quote.low || [],
      close: quote.close || [],
      volume: quote.volume || [],
      meta: {
        currency: meta.currency,
        exchangeName: meta.exchangeName,
        regularMarketPrice: meta.regularMarketPrice,
        previousClose: meta.previousClose,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow
      },
      source: result.host
    });
  }
};
