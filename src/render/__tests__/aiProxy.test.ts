/**
 * Routing provider calls through a proxy.
 *
 * The defect this covers is specific and was live: the submit went through the
 * configured proxy and the two calls after it did not. A render is three
 * cross-origin requests, not one — submit, then an absolute polling URL on a
 * regional host, then a signed image on a delivery host — and proxying only
 * the first means the browser blocks the second instead. The symptom moves one
 * step later and looks identical.
 */

import { describe, expect, it, vi } from "vitest";
import { blockedMessage, via } from "@/render/ai/provider";

const SUBMIT = "https://api.bfl.ai/v1/flux-2-pro";
const POLL = "https://api.us1.bfl.ai/v1/get_result?id=abc-123";
const IMAGE = "https://delivery-us1.bfl.ai/results/abc/sample.png?sig=xyz";

describe("routing a provider URL through a proxy", () => {
  it("leaves the URL alone when no proxy is set", () => {
    expect(via(SUBMIT, undefined)).toBe(SUBMIT);
    expect(via(SUBMIT, "")).toBe(SUBMIT);
    expect(via(SUBMIT, "   ")).toBe(SUBMIT);
  });

  it("substitutes the encoded target into a {url} proxy", () => {
    expect(via(SUBMIT, "/ai-proxy?url={url}")).toBe(
      `/ai-proxy?url=${encodeURIComponent(SUBMIT)}`,
    );
  });

  it("routes all three legs of a render, not just the submit", () => {
    const proxy = "/ai-proxy?url={url}";
    for (const url of [SUBMIT, POLL, IMAGE]) {
      const routed = via(url, proxy);
      expect(routed.startsWith("/ai-proxy?url=")).toBe(true);
      expect(decodeURIComponent(routed.split("url=")[1])).toBe(url);
    }
  });

  it("carries a polling URL on a different host than the submit", () => {
    // The regional host is the whole point: a proxy pinned to api.bfl.ai
    // cannot reach api.us1.bfl.ai, which is where the poll actually goes.
    expect(new URL(POLL).host).not.toBe(new URL(SUBMIT).host);
    expect(new URL(IMAGE).host).not.toBe(new URL(POLL).host);
    const routed = [SUBMIT, POLL, IMAGE].map((u) => via(u, "/ai-proxy?url={url}"));
    expect(new Set(routed).size).toBe(3);
  });

  it("keeps a query string intact through the round trip", () => {
    const routed = via(IMAGE, "/ai-proxy?url={url}");
    const back = decodeURIComponent(routed.slice("/ai-proxy?url=".length));
    expect(new URL(back).searchParams.get("sig")).toBe("xyz");
  });

  it("treats a proxy without {url} as a stand-in for the provider origin", () => {
    expect(via(SUBMIT, "https://my-proxy.example.com/bfl")).toBe(
      "https://my-proxy.example.com/bfl/v1/flux-2-pro",
    );
    // A trailing slash must not double up.
    expect(via(SUBMIT, "https://my-proxy.example.com/bfl/")).toBe(
      "https://my-proxy.example.com/bfl/v1/flux-2-pro",
    );
  });

  it("swaps the origin of an absolute poll URL under a base-form proxy", () => {
    expect(via(POLL, "https://my-proxy.example.com")).toBe(
      "https://my-proxy.example.com/v1/get_result?id=abc-123",
    );
  });
});

describe("what a blocked request says", () => {
  /**
   * A cross-origin fetch the browser refuses rejects with a TypeError that
   * carries no status and no body. Reported raw it reads "Failed to fetch",
   * which sounds like the provider turned the key away. Nothing was sent.
   */
  it("says the key is not the problem", () => {
    const m = blockedMessage("https://api.bfl.ai/v1/flux-2-pro", new TypeError("Failed to fetch"));
    expect(m).toContain("not your API key");
    expect(m).toContain("api.bfl.ai");
  });

  it("names the fix rather than the symptom", () => {
    const m = blockedMessage("https://api.bfl.ai/v1/flux-2-pro");
    expect(m).toContain("/ai-proxy?url={url}");
    expect(m.toLowerCase()).toContain("cors");
  });

  it("distinguishes a proxy that is not there from an API that refused", () => {
    // Same-origin means the proxy itself did not answer, which is a different
    // problem with a different fix, and must not be described as CORS.
    vi.stubGlobal("location", { href: "http://localhost:5173/", host: "localhost:5173" });
    try {
      const m = blockedMessage("http://localhost:5173/ai-proxy?url=x");
      expect(m.toLowerCase()).not.toContain("cors");
      expect(m).toContain("npm run dev");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still explains itself with no browser globals at all", () => {
    expect(() => blockedMessage("https://api.bfl.ai/v1/flux-2-pro")).not.toThrow();
  });
});
