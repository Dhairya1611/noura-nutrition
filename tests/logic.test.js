import test from "node:test";
import assert from "node:assert/strict";
import { calculateDayScore, calculateTargets, chartSeries, findFood, parseMealText, recommendNext, totalsForDate } from "../src/logic.js";

test("calculates sustainable targets for each goal", () => {
  const profile = { basis: "female", age: 30, height: 165, weight: 65, activity: 1.375 };
  const lose = calculateTargets({ ...profile, goal: "lose" });
  const maintain = calculateTargets({ ...profile, goal: "maintain" });
  const muscle = calculateTargets({ ...profile, goal: "muscle" });
  assert.ok(lose.calories < maintain.calories);
  assert.ok(muscle.calories > maintain.calories);
  assert.ok(muscle.protein > maintain.protein);
});

test("parses natural meal text and quantities", () => {
  const result = parseMealText("2 eggs, 1 banana and dal");
  assert.equal(result.matched.length, 3);
  assert.equal(result.unknown.length, 0);
  assert.equal(result.matched[0].kcal, 156);
});

test("keeps unmatched foods visible", () => {
  const result = parseMealText("rice and moon dust");
  assert.equal(result.matched[0].name, "Steamed rice");
  assert.deepEqual(result.unknown, ["moon dust"]);
});

test("does not confuse partial words with food aliases", () => {
  assert.equal(findFood("donuts"), null);
  assert.equal(findFood("one bowl of mixed nuts").name, "Almonds");
});

test("scores a near-target balanced day higher", () => {
  const targets = { calories: 2000, protein: 120, carbs: 250, fat: 65, fiber: 30 };
  const balanced = calculateDayScore({ kcal: 1950, protein: 120, carbs: 230, fat: 62, fiber: 30 }, targets);
  const incomplete = calculateDayScore({ kcal: 900, protein: 20, carbs: 150, fat: 20, fiber: 4 }, targets);
  assert.ok(balanced > incomplete);
  assert.ok(balanced >= 90);
});

test("totals only the selected local day", () => {
  const now = new Date("2026-10-09T12:00:00");
  const logs = [
    { at: "2026-10-09T08:00:00", kcal: 300, protein: 10 },
    { at: "2026-10-08T08:00:00", kcal: 500, protein: 20 }
  ];
  assert.equal(totalsForDate(logs, now).kcal, 300);
});

test("coach respects vegan preference", () => {
  const recs = recommendNext({ kcal: 500, protein: 20, carbs: 50, fat: 15, fiber: 5 }, { calories: 2000, protein: 120, carbs: 250, fat: 65, fiber: 30 }, { diet: "vegan" });
  assert.ok(recs.length > 0);
  assert.ok(recs.every(food => food.tags.includes("vegan")));
});

test("year chart always returns twelve months", () => {
  const series = chartSeries([], "year", { calories: 2000 }, new Date("2026-10-09"));
  assert.equal(series.length, 12);
});
