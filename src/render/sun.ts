/**
 * Solar position.
 *
 * Real sun angles matter for a conceptual rendering: they decide where the
 * shadows fall, and a shadow in the wrong place reads as wrong even to someone
 * who could not say why. This is the standard NOAA solar position algorithm,
 * accurate to well under a degree — far better than the image needs.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Degrees above the horizon. Negative means the sun is down. */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** True when the sun is above the horizon. */
  up: boolean;
}

export interface SunInput {
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23, local solar-ish time */
  hour: number;
  latitude: number;
  longitude: number;
  /** Hours offset from UTC, e.g. -5 for EST. */
  utcOffset: number;
}

/** Day of year, 1-366, for a non-leap reference year. */
function dayOfYear(month: number, day: number): number {
  const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cumulative[Math.max(0, Math.min(11, month - 1))] + day;
}

export function solarPosition(input: SunInput): SunPosition {
  const { hour, latitude, longitude, utcOffset } = input;
  const n = dayOfYear(input.month, input.day);

  // Fractional year, radians.
  const gamma = ((2 * Math.PI) / 365) * (n - 1 + (hour - 12) / 24);

  // Equation of time, minutes.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination, radians.
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqTime + 4 * longitude - 60 * utcOffset;
  const trueSolarTime = (hour * 60 + timeOffset + 1440) % 1440;
  const hourAngle = (trueSolarTime / 4 - 180) * RAD;

  const latRad = latitude * RAD;
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const altitude = 90 - zenith * DEG;

  // Azimuth, measured clockwise from north.
  const sinZenith = Math.sin(zenith);
  let azimuth = 180;
  if (Math.abs(sinZenith) > 1e-6) {
    const cosAz =
      (Math.sin(decl) - Math.sin(latRad) * cosZenith) / (Math.cos(latRad) * sinZenith);
    azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;
    if (hourAngle > 0) azimuth = 360 - azimuth;
  }

  return { altitude, azimuth, up: altitude > 0 };
}

/**
 * Sun direction as a unit vector in the app's world axes: +x east, +y up,
 * +z north. Returns the direction the light travels FROM.
 */
export function sunVector(pos: SunPosition): [number, number, number] {
  const alt = pos.altitude * RAD;
  const az = pos.azimuth * RAD;
  const horizontal = Math.cos(alt);
  return [horizontal * Math.sin(az), Math.sin(alt), horizontal * Math.cos(az)];
}

/**
 * Warm-to-white sun colour and intensity for an altitude.
 * A low sun is dimmer and much warmer; overhead it is near white.
 */
export function sunLighting(altitude: number): { color: number; intensity: number } {
  if (altitude <= 0) return { color: 0x2a3550, intensity: 0 };
  const t = Math.min(1, altitude / 45);
  // Interpolate from a deep sunrise orange toward neutral daylight.
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const r = Math.round(lerp(255, 255));
  const g = Math.round(lerp(160, 245));
  const b = Math.round(lerp(88, 226));
  return {
    color: (r << 16) | (g << 8) | b,
    intensity: 0.35 + 2.4 * Math.sin(Math.min(90, altitude) * RAD),
  };
}
