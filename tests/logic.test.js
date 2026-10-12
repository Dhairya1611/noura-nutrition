import test from "node:test";
import assert from "node:assert/strict";
import { calculateDayScore, calculateTargets, chartSeries, findFood, parseMealText, recommendNext, totalsForDate } from "../src/logic.js";
import { FOOD_LIBRARY } from "../src/data.js";
import { getNotificationState } from "../src/notifications.js";

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

test("recognises pear, cucumber fractions, and common muesli spellings", () => {
  const result = parseMealText("3 bananas, moong dal khichdi, greek yogurt, pear, 1/2 cucumber, museli");
  assert.equal(result.matched.length, 6);
  assert.deepEqual(result.unknown, []);
  assert.equal(result.matched.find(food => food.id === "pear")?.kcal, 101);
  assert.equal(result.matched.find(food => food.id === "cucumber")?.servings, 0.5);
  assert.equal(result.matched.find(food => food.id === "cucumber")?.kcal, 15);
  assert.equal(result.matched.find(food => food.id === "muesli")?.kcal, 220);
});

test("recognises a bowl of chaap and common soy spellings", () => {
  const bowl = parseMealText("1 bowl chaap");
  assert.deepEqual(bowl.unknown, []);
  assert.equal(bowl.matched[0].id, "soya-chaap");
  assert.equal(bowl.matched[0].servings, 1);
  assert.equal(bowl.matched[0].kcal, 246);
  assert.equal(parseMealText("2 bowls soy chap").matched[0].kcal, 492);
});

test("ships an expanded catalogue across common food groups", () => {
  assert.ok(FOOD_LIBRARY.length >= 150);
  const examples = ["butter chicken", "aloo paratha", "pani puri", "mango", "broccoli", "lassi", "sushi", "gulab jamun"];
  assert.deepEqual(examples.map(name => findFood(name)?.name), [
    "Butter chicken", "Aloo paratha", "Pani puri", "Mango", "Cooked broccoli", "Sweet lassi", "Sushi roll", "Gulab jamun"
  ]);
});

test("prefers the most specific food name over a broad alias", () => {
  const result = parseMealText("chicken curry, caesar salad and toast");
  assert.deepEqual(result.matched.map(food => food.id), ["chicken-curry", "caesar-salad", "bread-toast"]);
  assert.deepEqual(result.unknown, []);
});

test("supports written and unicode fractional quantities", () => {
  assert.equal(parseMealText("half a cucumber").matched[0].servings, 0.5);
  assert.equal(parseMealText("½ cucumber").matched[0].servings, 0.5);
  assert.equal(parseMealText("1 1/2 pears").matched[0].servings, 1.5);
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
  assert.equal(recs.length, 8);
  assert.ok(recs.every(food => food.tags.includes("vegan")));
});

test("coach can limit suggestions for compact surfaces", () => {
  const recs = recommendNext({ kcal: 500, protein: 20, carbs: 50, fat: 15, fiber: 5 }, { calories: 2000, protein: 120, carbs: 250, fat: 65, fiber: 30 }, { diet: "omnivore" }, 1);
  assert.equal(recs.length, 1);
});

test("year chart always returns twelve months", () => {
  const series = chartSeries([], "year", { calories: 2000 }, new Date("2026-10-09"));
  assert.equal(series.length, 12);
});

test("notification state explains a blocked browser permission", () => {
  const status = getNotificationState({ supported: true, permission: "denied", secureContext: true, isIOS: false, isStandalone: false });
  assert.equal(status.code, "blocked");
  assert.match(status.message, /Site settings/);
});

test("notification state requires installation on iOS", () => {
  const status = getNotificationState({ supported: true, permission: "default", secureContext: true, isIOS: true, isStandalone: false });
  assert.equal(status.code, "install");
  assert.match(status.message, /Home Screen/);
});

test("notification state offers a test after permission is granted", () => {
  const status = getNotificationState({ supported: true, permission: "granted", secureContext: true, isIOS: false, isStandalone: false });
  assert.equal(status.code, "granted");
  assert.equal(status.action, "Send test notification");
});
