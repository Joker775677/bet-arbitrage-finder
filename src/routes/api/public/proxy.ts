import { createFileRoute } from "@tanstack/react-router";

// Simple browsing proxy for the in-app dual-browser feature.
// Fetches a remote URL, strips frame-blocking headers and rewrites HTML so
// relative links/assets keep working when loaded through the proxy.
//
// Limitations (intentional, not bugs):
// - Cookies / logins are not persisted per origin (single shared jar would be a
//   security hole; we keep it stateless).
// - Sites relying on WebSockets, service workers or strict referer checks may
//   still break.
// - This is not a full browser — it's best-effort embedding.

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "strict-transport-security",
]);

function buildProxyUrl(target: string): string {
  return `/api/public/proxy?url=${encodeURIComponent(target)}`;
}

function rewriteHtml(html: string, baseUrl: string): string {
  // Inject <base> so relative URLs resolve against the original origin, then
  // route them through the proxy via a small client-side hook.
  const injection = `
<base href="${baseUrl}">
<script>
(function(){
  var PROXY = ${JSON.stringify("/api/public/proxy?url=")};
  function wrap(u){
    try {
      if (!u) return u;
      var s = String(u);
      if (s.startsWith("javascript:") || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("about:") || s.startsWith("mailto:") || s.startsWith("#")) return s;
      var abs = new URL(s, document.baseURI).toString();
      return PROXY + encodeURIComponent(abs);
    } catch(e){ return u; }
  }
  // Rewrite link clicks
  document.addEventListener("click", function(e){
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("javascript:") || href.startsWith("#")) return;
    e.preventDefault();
    var next = wrap(href);
    window.top.postMessage({ __lvProxyNav: true, url: new URL(href, document.baseURI).toString() }, "*");
    window.location.href = next;
  }, true);
  // Rewrite form submissions (GET only — POST bodies pass through naturally if action matches origin)
  document.addEventListener("submit", function(e){
    var f = e.target;
    if (!f || !f.action) return;
    try {
      var abs = new URL(f.getAttribute("action") || "", document.baseURI).toString();
      f.action = PROXY + encodeURIComponent(abs);
    } catch(_){}
  }, true);
})();
</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
  }
  return injection + html;
}

async function handle(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("url");
  if (!target) {
    return new Response("Missing ?url=", { status: 400 });
  }
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (!/^https?:$/.test(targetUrl.protocol)) {
    return new Response("Only http(s) allowed", { status: 400 });
  }

  // Forward request
  const outboundHeaders = new Headers();
  outboundHeaders.set(
    "user-agent",
    request.headers.get("user-agent") ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  );
  outboundHeaders.set("accept", request.headers.get("accept") ?? "*/*");
  const acceptLang = request.headers.get("accept-language");
  if (acceptLang) outboundHeaders.set("accept-language", acceptLang);

  let body: BodyInit | undefined = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    const ct = request.headers.get("content-type");
    if (ct) outboundHeaders.set("content-type", ct);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: outboundHeaders,
      body,
      redirect: "follow",
    });
  } catch (e) {
    return new Response(
      `Прокси не смог открыть сайт: ${(e as Error).message}`,
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Build response headers (strip frame-blocking + hop-by-hop)
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders.set(key, value);
  });

  const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();

  if (ct.includes("text/html")) {
    const html = await upstream.text();
    const rewritten = rewriteHtml(html, upstream.url || targetUrl.toString());
    respHeaders.set("content-type", "text/html; charset=utf-8");
    return new Response(rewritten, { status: upstream.status, headers: respHeaders });
  }

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export const Route = createFileRoute("/api/public/proxy")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
