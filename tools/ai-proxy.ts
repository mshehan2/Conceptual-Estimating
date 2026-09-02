/**
 * A same-origin pass-through for image provider APIs, for local runs.
 *
 * Every image API this app talks to refuses direct browser calls. They send no
 * CORS headers, so the preflight for our `x-key` header is never answered and
 * the browser rejects the request before it is sent. What surfaces in the UI
 * is `Failed to fetch` with no status, which reads like a bad key and is not.
 *
 * The fix is the one the Proxy URL field has always been asking for, except
 * that until now you had to go and build it. This is it: dev and preview serve
 * `/ai-proxy?url=<absolute url>`, which forwards the method, the auth header
 * and the body upstream and returns the response verbatim. Same origin, so no
 * preflight, so no CORS.
 *
 * It is a development server middleware and is NOT part of any build. A
 * deployed copy of this app has no proxy and cannot invent one.
 *
 * The host allowlist is the whole security story. Without it this is an open
 * relay that anyone who can reach the dev server could point at any host on
 * the network, with their own headers. Additions belong here and nowhere else.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/** Hosts the proxy will forward to. Anything else is refused. */
const ALLOWED = [
  /^([a-z0-9-]+\.)*bfl\.ai$/i,
  /^([a-z0-9-]+\.)*replicate\.com$/i,
  /^([a-z0-9-]+\.)*replicate\.delivery$/i,
  /^generativelanguage\.googleapis\.com$/i,
];

/** Request headers worth carrying upstream. Everything else is dropped. */
const FORWARD = ["x-key", "authorization", "content-type", "accept", "prefer"];

export const PROXY_PATH = "/ai-proxy";

/** Whether the proxy will forward to this host. The security boundary. */
export function allowed(host: string): boolean {
  return ALLOWED.some((re) => re.test(host));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function fail(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const asked = new URL(req.url ?? "", "http://localhost").searchParams.get("url");
  if (!asked) return fail(res, 400, "Pass the upstream URL as ?url=<encoded absolute url>");

  let target: URL;
  try {
    target = new URL(asked);
  } catch {
    return fail(res, 400, `Not a URL: ${asked.slice(0, 120)}`);
  }
  if (target.protocol !== "https:") return fail(res, 400, "Only https upstreams are proxied");
  if (!allowed(target.hostname)) {
    return fail(res, 403, `${target.hostname} is not in the proxy's allowlist (tools/ai-proxy.ts)`);
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARD) {
    const v = req.headers[name];
    if (typeof v === "string") headers[name] = v;
  }

  const method = req.method ?? "GET";
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : new Uint8Array(await readBody(req));

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body });
  } catch (err) {
    // A network failure here is the proxy's own, and saying so keeps it from
    // being misread as the provider rejecting the request.
    return fail(res, 502, `Proxy could not reach ${target.hostname}: ${(err as Error).message}`);
  }

  res.statusCode = upstream.status;
  const type = upstream.headers.get("content-type");
  if (type) res.setHeader("content-type", type);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

/** Serve the pass-through from the dev and preview servers. */
export function aiProxy(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(`${PROXY_PATH}?`) && req.url !== PROXY_PATH) return next();
    handle(req, res).catch((err) => fail(res, 500, String(err)));
  };

  return {
    name: "bud-ai-proxy",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}
