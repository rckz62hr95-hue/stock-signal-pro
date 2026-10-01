const C = {
  "Access-Control-Allow-Origin": "https://rckz62hr95-hue.github.io",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public,max-age=20"
};

function J(x, s=200) {
  return new Response(JSON.stringify(x), {
    status: s,
    headers: {"Content-Type":"application/json; charset=utf-8", ...C}
  });
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, {status:204, headers:C});

    const u = new URL(req.url);
    if (u.pathname !== "/api/chart") return J({ok:true});

    const sym = u.searchParams.get("symbol");
    const iv = u.searchParams.get("interval") || "1d";
    const range = u.searchParams.get("range") || "1y";

    if (!sym) return J({error:"symbol required"}, 400);

    try {
      const api =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
        `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(iv)}&includePrePost=false`;

      const r = await fetch(api);
      if (!r.ok) return J({error:`upstream ${r.status}`}, 502);

      const z = await r.json();
      const q = z.chart.result?.[0];
      if (!q) return J({error:"no chart data"}, 502);

      const a = q.indicators.quote[0];
      const c=[], h=[], l=[], v=[];

      for (let i=0; i<q.timestamp.length; i++) {
        if (a.close[i] == null) continue;
        c.push(a.close[i]);
        h.push(a.high[i]);
        l.push(a.low[i]);
        v.push(a.volume[i] || 0);
      }

      return J({
        symbol: sym,
        interval: iv,
        close: c,
        high: h,
        low: l,
        volume: v,
        meta: {price: q.meta.regularMarketPrice ?? c.at(-1)}
      });
    } catch (e) {
      return J({error:"upstream fetch failed"}, 502);
    }
  }
};
