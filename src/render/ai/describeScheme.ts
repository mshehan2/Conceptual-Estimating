/**
 * Turn a scheme into the words an image model responds to.
 *
 * The model can see massing and light in the render, but it cannot see that the
 * building is assisted living rather than a hotel, that the siding is fiber
 * cement rather than render, or that it sits in a suburban Mid-Atlantic
 * setting. Those are exactly the things that decide whether the output looks
 * like the right building, so they are stated rather than left to be guessed.
 */

import type { Scheme, Project } from "@/domain/project";
import { TYPE_BY_ID, MARKET_BY_ID } from "@/markets/registry";
import { SKIN_SPECS } from "@/render/textures";
import { wallHeight } from "@/domain/massing";

const GLAZING_WORDS: Record<string, string> = {
  none: "solid facades with minimal openings",
  punched: "regularly spaced punched windows",
  strip: "horizontal ribbon windows",
  full: "floor-to-ceiling curtain wall glazing",
};

const ROOF_WORDS: Record<string, string> = {
  flat: "a flat roof with a parapet",
  gable: "a pitched gable roof",
  hip: "a pitched hip roof",
};

/** Ordinal storey count, since "4 storey" reads worse than "four-storey". */
const STOREYS = [
  "single-storey", "two-storey", "three-storey", "four-storey", "five-storey",
  "six-storey", "seven-storey", "eight-storey", "nine-storey", "ten-storey",
];

const storeyWord = (n: number): string =>
  n >= 12 ? "high-rise" : (STOREYS[n - 1] ?? `${n}-storey`);

export function describeScheme(scheme: Scheme, project: Project): string {
  const type = TYPE_BY_ID[scheme.typeId];
  const market = type ? MARKET_BY_ID[type.marketId] : undefined;
  const mass = scheme.masses.find((m) => !m.context) ?? scheme.masses[0];
  if (!mass || !type) return "A contemporary building.";

  const skin = SKIN_SPECS[mass.skin]?.label.toLowerCase() ?? "fiber cement siding";
  const height = Math.round(wallHeight(mass));

  const parts = [
    `A ${storeyWord(mass.floors)} ${type.label.toLowerCase()} building`,
    market ? `in the ${market.label.toLowerCase()} sector` : "",
    `approximately ${Math.round(mass.w)} by ${Math.round(mass.d)} feet and ${height} feet tall,`,
    `clad in ${skin} with ${GLAZING_WORDS[mass.glz] ?? "punched windows"},`,
    `${ROOF_WORDS[mass.roof] ?? "a flat roof"},`,
    "a defined base course and expressed floor lines.",
  ];

  if (scheme.site.parking > 0) {
    parts.push("Surface parking and drive access alongside the building.");
  }

  const where = project.location.city || project.location.address;
  if (where) parts.push(`Set in ${where}.`);

  // Sector-specific cues that change what the model reaches for.
  const flavour = FLAVOUR[type.marketId];
  if (flavour) parts.push(flavour);

  return parts.filter(Boolean).join(" ");
}

/** One sentence per market, describing what the setting should look like. */
const FLAVOUR: Record<string, string> = {
  senior_living:
    "Welcoming residential character with landscaped grounds, seating, walking paths and a sheltered main entry canopy.",
  healthcare:
    "Clean institutional character with a clearly marked entrance, canopy drop-off and well-kept landscaping.",
  higher_ed: "Campus setting with mature trees, paved walkways and students moving between buildings.",
  multifamily: "Contemporary residential character with balconies, landscaped edges and street trees.",
  hospitality: "Hospitality character with a porte cochere, lit entry and manicured planting.",
  workplace: "Corporate character with a glazed lobby, plaza and clean hard landscaping.",
  industrial: "Utilitarian character with dock doors, truck court and wide paved approach.",
  civic: "Civic character with a generous approach, flagpole, and durable public landscaping.",
  parking: "Open parking structure with clear spandrels and planted screening at the base.",
};
