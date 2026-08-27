/**
 * Location cost indices — planning-level city factors relative to a 100
 * national baseline, which is the basis every seed rate is stated at.
 *
 * Values track published ENR city cost index relationships, rounded for
 * conceptual use. `nearestCity` haversine-matches a geocoded site to its
 * closest metro so dropping a pin sets the index.
 */

export interface LocationFactor {
  city: string;
  lat: number;
  lon: number;
  /** 100 = national baseline. */
  index: number;
}

export const LOCATION_FACTORS: LocationFactor[] = [
  { city: "New York NY", lat: 40.71, lon: -74.01, index: 130 },
  { city: "Newark / N. NJ", lat: 40.73, lon: -74.17, index: 122 },
  { city: "Boston MA", lat: 42.36, lon: -71.06, index: 118 },
  { city: "Hartford CT", lat: 41.77, lon: -72.67, index: 108 },
  { city: "Providence RI", lat: 41.82, lon: -71.41, index: 107 },
  { city: "Philadelphia PA", lat: 39.95, lon: -75.17, index: 115 },
  { city: "Trenton NJ", lat: 40.22, lon: -74.76, index: 112 },
  { city: "Wilmington DE", lat: 39.75, lon: -75.55, index: 103 },
  { city: "Baltimore MD", lat: 39.29, lon: -76.61, index: 92 },
  { city: "Washington DC", lat: 38.91, lon: -77.04, index: 97 },
  { city: "Richmond VA", lat: 37.54, lon: -77.44, index: 91 },
  { city: "Virginia Beach VA", lat: 36.85, lon: -75.98, index: 90 },
  { city: "Lancaster PA", lat: 40.04, lon: -76.31, index: 97 },
  { city: "Harrisburg PA", lat: 40.27, lon: -76.88, index: 98 },
  { city: "York PA", lat: 39.96, lon: -76.73, index: 96 },
  { city: "Reading PA", lat: 40.34, lon: -75.93, index: 99 },
  { city: "Allentown PA", lat: 40.60, lon: -75.47, index: 102 },
  { city: "Scranton PA", lat: 41.41, lon: -75.66, index: 96 },
  { city: "State College PA", lat: 40.79, lon: -77.86, index: 96 },
  { city: "Erie PA", lat: 42.13, lon: -80.09, index: 97 },
  { city: "Pittsburgh PA", lat: 40.44, lon: -80.00, index: 104 },
  { city: "Buffalo NY", lat: 42.89, lon: -78.88, index: 102 },
  { city: "Rochester NY", lat: 43.16, lon: -77.61, index: 101 },
  { city: "Albany NY", lat: 42.65, lon: -73.75, index: 104 },
  { city: "Cleveland OH", lat: 41.50, lon: -81.69, index: 100 },
  { city: "Columbus OH", lat: 39.96, lon: -83.00, index: 96 },
  { city: "Cincinnati OH", lat: 39.10, lon: -84.51, index: 95 },
  { city: "Detroit MI", lat: 42.33, lon: -83.05, index: 104 },
  { city: "Indianapolis IN", lat: 39.77, lon: -86.16, index: 95 },
  { city: "Louisville KY", lat: 38.25, lon: -85.76, index: 92 },
  { city: "Chicago IL", lat: 41.88, lon: -87.63, index: 117 },
  { city: "Milwaukee WI", lat: 43.04, lon: -87.91, index: 103 },
  { city: "Minneapolis MN", lat: 44.98, lon: -93.27, index: 106 },
  { city: "St. Louis MO", lat: 38.63, lon: -90.20, index: 102 },
  { city: "Kansas City MO", lat: 39.10, lon: -94.58, index: 100 },
  { city: "Nashville TN", lat: 36.16, lon: -86.78, index: 92 },
  { city: "Memphis TN", lat: 35.15, lon: -90.05, index: 88 },
  { city: "Charlotte NC", lat: 35.23, lon: -80.84, index: 87 },
  { city: "Raleigh NC", lat: 35.78, lon: -78.64, index: 88 },
  { city: "Atlanta GA", lat: 33.75, lon: -84.39, index: 90 },
  { city: "Birmingham AL", lat: 33.52, lon: -86.80, index: 86 },
  { city: "Jacksonville FL", lat: 30.33, lon: -81.66, index: 87 },
  { city: "Orlando FL", lat: 28.54, lon: -81.38, index: 88 },
  { city: "Tampa FL", lat: 27.95, lon: -82.46, index: 89 },
  { city: "Miami FL", lat: 25.76, lon: -80.19, index: 90 },
  { city: "New Orleans LA", lat: 29.95, lon: -90.07, index: 91 },
  { city: "Houston TX", lat: 29.76, lon: -95.37, index: 89 },
  { city: "Dallas TX", lat: 32.78, lon: -96.80, index: 88 },
  { city: "Austin TX", lat: 30.27, lon: -97.74, index: 89 },
  { city: "San Antonio TX", lat: 29.42, lon: -98.49, index: 85 },
  { city: "Oklahoma City OK", lat: 35.47, lon: -97.52, index: 84 },
  { city: "Denver CO", lat: 39.74, lon: -104.99, index: 94 },
  { city: "Salt Lake City UT", lat: 40.76, lon: -111.89, index: 92 },
  { city: "Phoenix AZ", lat: 33.45, lon: -112.07, index: 89 },
  { city: "Tucson AZ", lat: 32.22, lon: -110.97, index: 87 },
  { city: "Albuquerque NM", lat: 35.08, lon: -106.65, index: 88 },
  { city: "Las Vegas NV", lat: 36.17, lon: -115.14, index: 100 },
  { city: "Boise ID", lat: 43.62, lon: -116.20, index: 90 },
  { city: "Seattle WA", lat: 47.61, lon: -122.33, index: 108 },
  { city: "Spokane WA", lat: 47.66, lon: -117.43, index: 98 },
  { city: "Portland OR", lat: 45.52, lon: -122.68, index: 106 },
  { city: "Sacramento CA", lat: 38.58, lon: -121.49, index: 110 },
  { city: "San Francisco CA", lat: 37.77, lon: -122.42, index: 128 },
  { city: "Fresno CA", lat: 36.74, lon: -119.79, index: 105 },
  { city: "Los Angeles CA", lat: 34.05, lon: -118.24, index: 114 },
  { city: "San Diego CA", lat: 32.72, lon: -117.16, index: 112 },
  { city: "Honolulu HI", lat: 21.31, lon: -157.86, index: 122 },
  { city: "Anchorage AK", lat: 61.22, lon: -149.90, index: 118 },
];

export interface NearestCity extends LocationFactor {
  /** Great-circle distance from the query point, miles. */
  miles: number;
}

const EARTH_RADIUS_MI = 3959;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Closest indexed metro to a lat/lon, or null when the point is not finite. */
export function nearestCity(lat: number, lon: number): NearestCity | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: NearestCity | null = null;
  for (const l of LOCATION_FACTORS) {
    const dLat = rad(l.lat - lat);
    const dLon = rad(l.lon - lon);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat)) * Math.cos(rad(l.lat)) * Math.sin(dLon / 2) ** 2;
    const miles = 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
    if (!best || miles < best.miles) best = { ...l, miles: Math.round(miles) };
  }
  return best;
}

/** Exact-ish city lookup by label, case-insensitive. */
export function cityIndex(city: string): LocationFactor | undefined {
  const needle = city.trim().toLowerCase();
  return LOCATION_FACTORS.find((l) => l.city.toLowerCase() === needle);
}
