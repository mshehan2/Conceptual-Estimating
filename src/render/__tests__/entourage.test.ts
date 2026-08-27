/**
 * Entourage placement.
 *
 * Randomly scattered cars and trees are worse than none: they tell a client
 * the model was not thought about. These tests are the site-plan rules written
 * down — cars in stalls, stalls in bays, trees where a landscape plan puts
 * them, people between the parking and the door.
 */

import { describe, expect, it } from "vitest";
import {
  AISLE_W,
  LOT_SETBACK,
  STALL_D,
  STALL_W,
  STALLS_PER_ISLAND,
  entrancePoint,
  parkingLayout,
  peoplePlan,
  streetParking,
  treePlan,
  type EntourageInput,
  type Rect,
} from "../entourage";

const lot: Rect = { cx: 0, cz: 300, width: 243, depth: 196, rot: 0 };
const building: Rect = { cx: 0, cz: 0, width: 200, depth: 120, rot: 0 };

const input = (over: Partial<EntourageInput> = {}): EntourageInput => ({
  bounds: { minX: -140, maxX: 140, minZ: -100, maxZ: 100 },
  exclusions: [{ minX: -100, maxX: 100, minZ: -60, maxZ: 60 }],
  lot,
  building,
  trees: 40,
  cars: 60,
  people: 12,
  seed: 7,
  ...over,
});

const rng = () => {
  let a = 12345;
  return () => {
    a = (a * 1103515245 + 12345) % 2147483648;
    return a / 2147483648;
  };
};

const inLot = (p: { x: number; z: number }, pad = 0) =>
  Math.abs(p.x - lot.cx) <= lot.width / 2 + pad && Math.abs(p.z - lot.cz) <= lot.depth / 2 + pad;

describe("parking layout", () => {
  const layout = parkingLayout(lot, { x: 0, z: 0 });

  it("puts every stall inside the lot", () => {
    expect(layout.stalls.length).toBeGreaterThan(0);
    for (const s of layout.stalls) expect(inLot(s)).toBe(true);
  });

  it("keeps stalls clear of the lot edge", () => {
    for (const s of layout.stalls) {
      expect(Math.abs(s.z - lot.cz)).toBeLessThanOrEqual(lot.depth / 2 - LOT_SETBACK);
      expect(Math.abs(s.x - lot.cx)).toBeLessThanOrEqual(lot.width / 2 - LOT_SETBACK / 2);
    }
  });

  it("lays stalls out on a 9ft module along the row", () => {
    const row = layout.stalls.filter((s) => Math.abs(s.z - layout.stalls[0].z) < 0.01);
    const xs = [...new Set(row.map((s) => Math.round(s.x * 100) / 100))].sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => Math.round((x - xs[i]) * 100) / 100);
    // Every gap is one stall, or the jump across a landscape island.
    for (const g of gaps) expect([STALL_W, STALL_W * 2]).toContain(g);
  });

  it("separates the two rows of a bay by a drive aisle", () => {
    const zs = [...new Set(layout.stalls.map((s) => Math.round(s.z * 10) / 10))].sort((a, b) => a - b);
    expect(zs.length).toBeGreaterThan(1);
    const gap = Math.round((zs[1] - zs[0]) * 10) / 10;
    expect(gap).toBeCloseTo(STALL_D + AISLE_W, 1);
  });

  it("turns the far row of a bay to face the aisle", () => {
    const angles = new Set(layout.stalls.map((s) => Math.round(s.angle * 1000) / 1000));
    expect(angles.size).toBe(2);
    expect([...angles].map(Math.abs).sort((a, b) => a - b)[1]).toBeCloseTo(Math.PI, 3);
  });

  it("breaks a landscape island into every run of stalls", () => {
    expect(layout.islands.length).toBeGreaterThan(0);
    for (const i of layout.islands) expect(inLot(i)).toBe(true);
    const perRow = Math.floor((lot.width - 2 * LOT_SETBACK) / STALL_W);
    expect(layout.islands.length).toBeGreaterThanOrEqual(Math.floor(perRow / STALLS_PER_ISLAND));
  });

  it("puts an aisle between each pair of rows", () => {
    expect(layout.aisles.length).toBeGreaterThan(0);
    for (const a of layout.aisles) expect(inLot(a)).toBe(true);
  });

  it("fills from the door outward, so the empty stalls are the far ones", () => {
    // Compared with a tolerance because two stalls symmetric about the aisle
    // are the same distance away and may differ by a float ULP.
    const d = layout.stalls.map((s) => Math.hypot(s.x, s.z));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1] - 1e-6);
    expect(d[d.length - 1]).toBeGreaterThan(d[0]);
  });

  it("holds about the stall count the estimate is paying for", () => {
    // 243 × 196 is the lot the scene draws for 140 stalls at 340 SF each.
    expect(layout.stalls.length + layout.islands.length).toBeGreaterThan(135);
    expect(layout.stalls.length).toBeLessThan(160);
  });

  it("never overlaps two stalls", () => {
    const keys = layout.stalls.map((s) => `${Math.round(s.x)}:${Math.round(s.z)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives up rather than inventing stalls in a lot too small to hold any", () => {
    const tiny = parkingLayout({ cx: 0, cz: 0, width: 20, depth: 20, rot: 0 }, { x: 0, z: 0 });
    expect(tiny.stalls).toEqual([]);
  });

  it("carries the lot rotation through to the stalls", () => {
    const turned = parkingLayout({ ...lot, rot: Math.PI / 4 }, { x: 0, z: 0 });
    expect(turned.stalls.length).toBeGreaterThan(0);
    for (const s of turned.stalls) {
      const dx = s.x - lot.cx;
      const dz = s.z - lot.cz;
      const lx = dx * Math.cos(-Math.PI / 4) - dz * Math.sin(-Math.PI / 4);
      const lz = dx * Math.sin(-Math.PI / 4) + dz * Math.cos(-Math.PI / 4);
      expect(Math.abs(lx)).toBeLessThanOrEqual(lot.width / 2);
      expect(Math.abs(lz)).toBeLessThanOrEqual(lot.depth / 2);
    }
  });
});

describe("the entrance", () => {
  it("sits on the building face that looks at the parking", () => {
    const door = entrancePoint(input());
    expect(door.z).toBeCloseTo(building.cz + building.depth / 2, 6);
    expect(door.x).toBeCloseTo(building.cx, 6);
  });

  it("follows the lot when the lot is off to one side", () => {
    const door = entrancePoint(input({ lot: { cx: 500, cz: 0, width: 200, depth: 150, rot: 0 } }));
    expect(door.x).toBeCloseTo(building.cx + building.width / 2, 6);
  });
});

describe("trees", () => {
  const layout = parkingLayout(lot, { x: 0, z: 0 });

  it("gives every source a share instead of spending it all on the lot", () => {
    const trees = treePlan(input({ trees: 40 }), layout, rng());
    const isIsland = (t: { x: number; z: number }) =>
      layout.islands.some((i) => i.x === t.x && i.z === t.z);
    const islands = trees.filter(isIsland).length;
    const nearLot = trees.filter((t) => !isIsland(t) && inLot(t, 40)).length;
    const nearBuilding = trees.filter((t) => Math.hypot(t.x - building.cx, t.z - building.cz) < 220).length;
    // The failure this guards against is every tree ending up round the lot
    // while the building stands in a bare field.
    expect(islands).toBeGreaterThan(0);
    expect(nearLot).toBeGreaterThan(0);
    expect(nearBuilding).toBeGreaterThan(4);
    expect(islands + nearLot).toBeLessThan(trees.length);
  });

  it("never plants inside a building", () => {
    const inp = input({ trees: 90 });
    for (const t of treePlan(inp, layout, rng())) {
      for (const e of inp.exclusions) {
        const inX = t.x > e.minX && t.x < e.maxX;
        const inZ = t.z > e.minZ && t.z < e.maxZ;
        expect(inX && inZ).toBe(false);
      }
    }
  });

  it("keeps the trees apart instead of clumping them", () => {
    const trees = treePlan(input({ trees: 60 }), layout, rng());
    let tooClose = 0;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        if (Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z) < 12) tooClose++;
      }
    }
    expect(tooClose).toBe(0);
  });

  it("never plants more than it was asked for", () => {
    for (const n of [0, 1, 5, 25, 120]) {
      expect(treePlan(input({ trees: n }), layout, rng()).length).toBeLessThanOrEqual(n);
    }
  });

  it("still plants a site with no parking at all", () => {
    const bare = { stalls: [], islands: [], aisles: [] };
    const trees = treePlan(input({ trees: 30, lot: undefined }), bare, rng());
    expect(trees.length).toBeGreaterThan(10);
  });
});

describe("people", () => {
  const layout = parkingLayout(lot, { x: 0, z: 0 });

  it("puts them between the parking and the door, not out in the field", () => {
    const door = entrancePoint(input());
    const people = peoplePlan(input({ people: 20 }), layout, rng());
    expect(people).toHaveLength(20);
    // Nobody more than a long walk from the door.
    for (const p of people) expect(Math.hypot(p.x - door.x, p.z - door.z)).toBeLessThan(400);
  });

  it("clusters roughly half of them at the entrance", () => {
    const door = entrancePoint(input());
    const people = peoplePlan(input({ people: 20 }), layout, rng());
    const near = people.filter((p) => Math.hypot(p.x - door.x, p.z - door.z) < 60);
    expect(near.length).toBeGreaterThanOrEqual(8);
  });
});

describe("overflow cars", () => {
  it("park along the frontage rather than on the grass", () => {
    const cars = streetParking(input(), 8);
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) {
      // Off the building, and lined up with it rather than pointing anywhere.
      expect(Math.abs(c.z - building.cz)).toBeGreaterThan(building.depth / 2);
      expect(Math.round(c.angle * 1000)).toBe(Math.round((Math.PI / 2) * 1000));
    }
  });

  it("returns nothing when there is no building to line up with", () => {
    expect(streetParking(input({ building: undefined }), 8)).toEqual([]);
  });
});
