import { describe, expect, it } from "vitest";
import { solarPosition, sunLighting, sunVector } from "../sun";

const PHILLY = { latitude: 39.95, longitude: -75.17, utcOffset: -5 };

describe("solar position", () => {
  it("puts the summer noon sun high and due south in the mid-Atlantic", () => {
    const p = solarPosition({ month: 6, day: 21, hour: 13, ...PHILLY, utcOffset: -4 });
    expect(p.altitude).toBeGreaterThan(68);
    expect(p.altitude).toBeLessThan(76);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(12);
  });

  it("puts the winter noon sun much lower", () => {
    const summer = solarPosition({ month: 6, day: 21, hour: 13, ...PHILLY, utcOffset: -4 });
    const winter = solarPosition({ month: 12, day: 21, hour: 12, ...PHILLY });
    expect(winter.altitude).toBeLessThan(30);
    expect(winter.altitude).toBeLessThan(summer.altitude - 35);
  });

  it("rises in the east and sets in the west", () => {
    const morning = solarPosition({ month: 3, day: 21, hour: 8, ...PHILLY });
    const evening = solarPosition({ month: 3, day: 21, hour: 17, ...PHILLY });
    expect(morning.azimuth).toBeGreaterThan(80);
    expect(morning.azimuth).toBeLessThan(130);
    expect(evening.azimuth).toBeGreaterThan(230);
    expect(evening.azimuth).toBeLessThan(285);
  });

  it("reports the sun down at midnight", () => {
    const night = solarPosition({ month: 6, day: 21, hour: 1, ...PHILLY, utcOffset: -4 });
    expect(night.up).toBe(false);
    expect(sunLighting(night.altitude).intensity).toBe(0);
  });

  it("returns a unit direction vector with +y up", () => {
    const p = solarPosition({ month: 6, day: 21, hour: 13, ...PHILLY, utcOffset: -4 });
    const [x, y, z] = sunVector(p);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(y).toBeGreaterThan(0.9);
  });

  it("warms and dims the light as the sun drops", () => {
    const high = sunLighting(70);
    const low = sunLighting(6);
    expect(low.intensity).toBeLessThan(high.intensity);
    expect(low.color & 0xff).toBeLessThan(high.color & 0xff); // less blue near the horizon
  });
});
