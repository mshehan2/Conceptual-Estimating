/**
 * Program driver chains.
 *
 * How a count of rooms becomes a building. Benchmark's models drive every area
 * on the Summary off a Program Drivers sheet, so nothing is hardcoded and one
 * number can move the whole estimate. This is that sheet.
 *
 * Three real chains, three shapes, and a single blended metric will not cover
 * them:
 *
 *   UPC 1 outpatient   120 KPU at one blended 540 DGSF/KPU
 *   Original Hospital  11 OR at 4,200 PLUS 256 beds at 800. Two rates.
 *   Crescent research  no KPU at all, 165,200 net SF carried forward
 *
 * So a chain is either BLENDED, where the key planning units share one
 * departmental area, or COMPONENT, where each driver contributes its own.
 * Both then gross up to building area by a single factor.
 *
 * The blended form also keeps each driver's room size, because Flad's 540
 * DGSF/KPU is a benchmark and not a build-up: 112 exam rooms at 208 SF, 6
 * procedure at 500 and 2 x-ray at 600 is 27,496 SF of actual room, which is
 * 229 per KPU. The other 311 is everything supporting it. Reporting that split
 * turns an unwinnable argument between two blended benchmarks into a question
 * about the support ratio, which two professionals can actually settle.
 */

export type DriverMode = "blended" | "component";

export interface CapacityDriver {
  id: string;
  label: string;
  count: number;
  /** Departmental gross SF contributed per unit of count. */
  dgsfPer: number;
  /** What one count is: "OR", "bay", "room". Shown next to the number. */
  unit: string;
  /** Counts toward the key planning unit total. An OR does; a sterile core does not. */
  kpu?: boolean;
  /** Net area of one room, where the driver is a room. Drives the support ratio. */
  roomSf?: number;
}

/** A share of building gross area. Exactly one category may be the balance. */
export interface ProgramCategory {
  id: string;
  label: string;
  share: number;
  /** Absorbs whatever the other categories leave, so the set always sums to 1. */
  balance?: boolean;
}

export interface DriverChain {
  mode: DriverMode;
  drivers: CapacityDriver[];
  /** Blended mode only: departmental gross SF per key planning unit. */
  dgsfPerKpu?: number;
  /** BGSF / DGSF. */
  grossFactor: number;
  categories: ProgramCategory[];
}

export interface CategoryArea {
  id: string;
  label: string;
  share: number;
  area: number;
  balance: boolean;
}

export interface DriverResult {
  kpu: number;
  dgsf: number;
  bgsf: number;
  /** Sum of count x roomSf across drivers that state a room size. */
  roomArea: number;
  /** Share of departmental area that is actual room. */
  roomShare: number;
  /** DGSF per KPU the chain actually produces, blended or not. */
  dgsfPerKpu: number;
  categories: CategoryArea[];
}

/**
 * Resolve the categories so they always sum to the whole.
 *
 * The balance category takes the remainder rather than being entered, which is
 * how the workbook does it: circulation is what is left after everything with
 * a name has been counted. Without a balance the shares are normalized, so a
 * set that sums to 91% (which is what Flad's issued Crescent chart does, its
 * stacked bar carrying bands nobody could read) still produces whole areas.
 */
export function resolveCategories(categories: ProgramCategory[], bgsf: number): CategoryArea[] {
  const named = categories.filter((c) => !c.balance);
  const balance = categories.find((c) => c.balance);
  const namedTotal = named.reduce((a, c) => a + c.share, 0);

  if (balance) {
    const remainder = Math.max(0, 1 - namedTotal);
    return categories.map((c) => {
      const share = c.balance ? remainder : c.share;
      return { id: c.id, label: c.label, share, area: bgsf * share, balance: Boolean(c.balance) };
    });
  }

  const scale = namedTotal > 0 ? 1 / namedTotal : 0;
  return categories.map((c) => ({
    id: c.id,
    label: c.label,
    share: c.share * scale,
    area: bgsf * c.share * scale,
    balance: false,
  }));
}

/** Run a chain from its drivers to its modality areas. */
export function resolveChain(chain: DriverChain): DriverResult {
  const kpu = chain.drivers.filter((d) => d.kpu).reduce((a, d) => a + Math.max(0, d.count), 0);

  const dgsf =
    chain.mode === "blended"
      ? kpu * Math.max(0, chain.dgsfPerKpu ?? 0)
      : chain.drivers.reduce((a, d) => a + Math.max(0, d.count) * Math.max(0, d.dgsfPer), 0);

  const bgsf = dgsf * Math.max(0, chain.grossFactor);
  const roomArea = chain.drivers.reduce(
    (a, d) => a + (d.roomSf ? Math.max(0, d.count) * d.roomSf : 0),
    0,
  );

  return {
    kpu,
    dgsf,
    bgsf,
    roomArea,
    roomShare: dgsf > 0 ? roomArea / dgsf : 0,
    dgsfPerKpu: kpu > 0 ? dgsf / kpu : 0,
    categories: resolveCategories(chain.categories, bgsf),
  };
}

/**
 * What the chain would produce at a different departmental area per KPU.
 *
 * The single most valuable readout in the UPC 1 model and the one thing its
 * workbook can only show as three static rows. Every 100 DGSF/KPU moves that
 * project about $12M, and Jamie Matthys's own comp set pushes the metric from
 * 540 toward 700, which is unresolved.
 */
export function atDgsfPerKpu(chain: DriverChain, dgsfPerKpu: number): DriverResult {
  return resolveChain({ ...chain, mode: "blended", dgsfPerKpu });
}
