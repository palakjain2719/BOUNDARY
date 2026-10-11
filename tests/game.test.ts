import { describe, expect, it } from "vitest";
import { applyOutcome, ballAt, inningsResult, makeDelivery, newInnings, opponentScore, resolveBall, rng, type Delivery } from "@/lib/game/engine";

const straight: Delivery = { releaseX: 0, pitchX: 0, arriveX: 0, pitchZ: 5, flight: 0.8, pitchAt: 0.75, ringX: 0, ringZ: 5, label: "good length, on the stumps" };
const wide: Delivery = { ...straight, pitchX: 0.9, arriveX: 0.9 };
const always = (v: number) => () => v;

describe("Super Over engine", () => {
  it("deliveries are deterministic for a seed and the ball travels from bowler to batter", () => {
    const a = makeDelivery(rng(42), "medium");
    const b = makeDelivery(rng(42), "medium");
    expect(a).toEqual(b);
    expect(ballAt(a, 0).z).toBeCloseTo(20);
    expect(ballAt(a, a.flight).z).toBeCloseTo(0);
    expect(ballAt(a, a.flight * a.pitchAt).y).toBeLessThan(0.1); // pitches on the ground
  });
  it("leaving a straight ball gets you bowled; leaving a wide one is a dot", () => {
    expect(resolveBall(straight, null, 0.6, "ground", "medium", always(0.5)).kind).toBe("bowled");
    expect(resolveBall(wide, null, 0, "ground", "medium", always(0.5))).toMatchObject({ kind: "beaten", runs: 0, wicket: false });
  });
  it("perfect timing and line: lofted = six, ground = four", () => {
    expect(resolveBall(straight, 0.8, 0, "loft", "medium", always(0.5)).kind).toBe("six");
    expect(resolveBall(straight, 0.8, 0, "ground", "medium", always(0.5)).kind).toBe("four");
  });
  it("early timing pulls to the leg side, late timing to the off side", () => {
    expect(resolveBall(straight, 0.74, 0, "ground", "medium", always(0.5)).angle).toBeLessThan(0);
    expect(resolveBall(straight, 0.86, 0, "ground", "medium", always(0.5)).angle).toBeGreaterThan(0);
  });
  it("a badly mistimed loft is caught", () => {
    expect(resolveBall(straight, 0.95, 0.3, "loft", "medium", always(0.5))).toMatchObject({ kind: "caught", wicket: true });
  });
  it("innings ends on target, all balls or two wickets", () => {
    let inn = newInnings(5);
    inn = applyOutcome(inn, { runs: 6, wicket: false, kind: "six", angle: 0, quality: 1, text: "" });
    expect(inningsResult(inn)).toBe("won");
    let out = newInnings(20);
    for (let i = 0; i < 2; i++) out = applyOutcome(out, { runs: 0, wicket: true, kind: "bowled", angle: 0, quality: 0, text: "" });
    expect(inningsResult(out)).toBe("lost");
    expect(opponentScore(rng(1), "easy")).toBeGreaterThanOrEqual(6);
  });
});
