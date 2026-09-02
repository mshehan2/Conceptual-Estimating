/**
 * The proxy's host allowlist.
 *
 * The dev pass-through forwards a caller-supplied URL with a caller-supplied
 * auth header. Without a host check that is an open relay: anything that can
 * reach the dev server could aim it at any host reachable from the developer's
 * machine, including things on their network that are not on the internet.
 *
 * The allowlist is therefore the whole security story, and a regex allowlist
 * has one classic way of being wrong — anchoring the domain at the end but not
 * the start, so `bfl.ai.evil.com` matches. These cases exist to keep it right.
 */

import { describe, expect, it } from "vitest";
import { allowed } from "../../../tools/ai-proxy";

describe("which hosts the dev proxy will forward to", () => {
  it("allows the provider hosts a render actually touches", () => {
    // All three legs of a FLUX render land on different hosts.
    expect(allowed("api.bfl.ai")).toBe(true);
    expect(allowed("api.us1.bfl.ai")).toBe(true);
    expect(allowed("delivery-us1.bfl.ai")).toBe(true);
    expect(allowed("api.replicate.com")).toBe(true);
    expect(allowed("replicate.delivery")).toBe(true);
    expect(allowed("pbxt.replicate.delivery")).toBe(true);
    expect(allowed("generativelanguage.googleapis.com")).toBe(true);
  });

  it("refuses a lookalike that only ends the right way", () => {
    expect(allowed("bfl.ai.evil.com")).toBe(false);
    expect(allowed("replicate.com.evil.net")).toBe(false);
    expect(allowed("notbfl.ai")).toBe(false);
    expect(allowed("evil-bfl.ai.attacker.io")).toBe(false);
  });

  it("refuses anything on the local network", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "169.254.169.254", // cloud instance metadata
      "10.0.0.1",
      "192.168.1.1",
      "internal.corp",
      "[::1]",
    ]) {
      expect(allowed(host), `${host} must not be proxied`).toBe(false);
    }
  });

  it("refuses an empty or malformed host", () => {
    expect(allowed("")).toBe(false);
    expect(allowed(" bfl.ai")).toBe(false);
    expect(allowed("bfl.ai ")).toBe(false);
    expect(allowed("bfl.ai\nevil.com")).toBe(false);
  });

  it("does not care about case", () => {
    expect(allowed("API.BFL.AI")).toBe(true);
  });
});
