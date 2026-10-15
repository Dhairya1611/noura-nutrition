import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustReminderTime, calculateDayScore, calculateTargets, chartSeries, findFood, findVisualFood, formatFoodPortion, formatReminderTime,
  macroStatus, parseMealText, recommendNext, reminderTimeParts, setReminderPeriod, totalsForDate
} from "../src/logic.js";
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

test("classifies macro excess with visible warning and danger levels", () => {
  assert.deepEqual(macroStatus(58, 58), { level: "within", over: 0, percentage: 100 });
  assert.deepEqual(macroStatus(62, 58), { level: "warning", over: 4, percentage: 100 });
  assert.deepEqual(macroStatus(70, 58), { level: "danger", over: 12, percentage: 100 });
});

test("shows natural food counts without a confusing multiplier", () => {
  assert.equal(formatFoodPortion({ serving: "1 almond", servings: 1 }), "1 almond");
  assert.equal(formatFoodPortion({ serving: "1 almond", servings: 20 }), "20 almonds");
  assert.equal(formatFoodPortion({ serving: "1 bowl", servings: 2 }), "2 bowls");
});

test("treats an almond as one almond rather than a twenty-almond serving", () => {
  const one = parseMealText("1 almond").matched[0];
  const twenty = parseMealText("20 almonds").matched[0];
  assert.equal(one.serving, "1 almond");
  assert.equal(one.servings, 1);
  assert.equal(one.kcal, 7);
  assert.equal(twenty.servings, 20);
  assert.equal(twenty.kcal, 140);
  assert.equal(formatFoodPortion(twenty), "20 almonds");
});

test("parses natural meal text and quantities", () => {
  const result = parseMealText("2 eggs, 1 banana and dal");
  assert.equal(result.matched.length, 3);
  assert.equal(result.unknown.length, 0);
  assert.equal(result.matched[0].kcal, 156);
});

test("understands conversational meal phrasing and number words", () => {
  const result = parseMealText("I had two aloo parathas and a bowl of curd for lunch");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["aloo-paratha", "yogurt"]);
  assert.equal(result.matched[0].servings, 2);
  assert.equal(result.matched[1].servings, 1);
  assert.deepEqual(parseMealText("Please add dragon bowl for dinner").unknown, ["dragon bowl"]);
});

test("maps visual labels conservatively instead of guessing a broad food", () => {
  assert.equal(findVisualFood("Granny_Smith")?.id, "apple");
  assert.equal(findVisualFood("chicken_curry")?.id, "chicken-curry");
  assert.equal(findVisualFood("caesar_salad")?.id, "caesar-salad");
  assert.equal(findVisualFood("carbonara")?.id, "pasta");
  assert.equal(findVisualFood("chicken_quesadilla"), null);
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

test("recognises lobia and common black-eyed pea names", () => {
  const bowl = parseMealText("1 bowl lobia");
  assert.deepEqual(bowl.unknown, []);
  assert.equal(bowl.matched[0].id, "lobia");
  assert.equal(bowl.matched[0].servings, 1);
  assert.equal(bowl.matched[0].kcal, 220);
  assert.equal(parseMealText("2 bowls lobiya").matched[0].kcal, 440);
  assert.equal(findFood("black-eyed peas")?.id, "lobia");
  assert.equal(findFood("cowpeas")?.id, "lobia");
  assert.equal(findFood("chawli")?.id, "lobia");
});

test("recognises dry fruits and common amla preserve spellings", () => {
  const result = parseMealText("dry fruits, honey amla and amla ka muraba");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["mixed-dry-fruits", "honey-amla", "amla-murabba"]);
  assert.deepEqual(result.matched.map(food => food.kcal), [170, 65, 90]);
  assert.equal(findFood("aamla ka murabba")?.id, "amla-murabba");
  assert.equal(parseMealText("2 pieces honey aamla").matched[0].kcal, 130);
});

test("recognises anjeer, Hindi dish phrasing, and specific aloo preparations", () => {
  const result = parseMealText("3 anjeer, aloo ka parantha and aloo ka jhol");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["anjeer", "aloo-paratha", "aloo-jhol"]);
  assert.equal(result.matched[0].kcal, 75);
  assert.equal(findFood("aloo ki sabzi")?.id, "aloo-jhol");
  assert.equal(findFood("aloo fry")?.id, "aloo-fry");
  assert.equal(findFood("mashed aloo"), null);
  assert.equal(findFood("boiled aloo")?.id, "potato");
});

test("recognises common paratha varieties and spelling variants", () => {
  const names = ["gobhi ka prantha", "mooli paranthas", "methi paratha", "pyaaz ka parantha", "mix veg paratha", "sattu parantha", "laccha paratha", "ajwain parantha", "anda paratha", "cheese parantha"];
  assert.deepEqual(names.map(name => findFood(name)?.id), ["gobi-paratha", "mooli-paratha", "methi-paratha", "pyaz-paratha", "mixed-veg-paratha", "sattu-paratha", "lachha-paratha", "ajwain-paratha", "egg-paratha", "cheese-paratha"]);
});

test("keeps aloo methi paratha distinct and recognises Indian chilli pickle", () => {
  const result = parseMealText("aloo methi prantha and mirch ka achaar");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["aloo-methi-paratha", "mirch-achaar"]);
  assert.deepEqual(result.matched.map(food => food.kcal), [330, 15]);
  assert.equal(findFood("methi aloo parantha")?.id, "aloo-methi-paratha");
  assert.equal(findFood("hari mirch ka achar")?.id, "mirch-achaar");
  assert.equal(findFood("palak aloo parantha"), null);
});

test("recognises Rajasthani thali and common dal baati thali spellings", () => {
  const result = parseMealText("1 Rajasthani thali and dal bati churma thali");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["rajasthani-thali", "rajasthani-thali"]);
  assert.deepEqual(result.matched.map(food => food.kcal), [950, 950]);
  assert.equal(findFood("Rajasthani thaali")?.serving, "1 typical vegetarian thali");
  assert.equal(findFood("rajsthani thali")?.id, "rajasthani-thali");
});

test("recognises common regional and fasting thalis plus samak rice and fafda", () => {
  const result = parseMealText("navratri thali, himalyan thali, samak chawal and fafda");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["navratri-thali", "himalayan-thali", "samak-rice", "fafda"]);
  assert.deepEqual(result.matched.map(food => food.kcal), [700, 820, 190, 260]);
  assert.deepEqual(["Punjabi thali", "Gujarati thali", "South Indian thali", "Bengali thali", "Maharashtrian thali", "Kerala thali"].map(name => findFood(name)?.id), ["punjabi-thali", "gujarati-thali", "south-indian-thali", "bengali-thali", "maharashtrian-thali", "kerala-thali"]);
  assert.equal(parseMealText("1 plate Gujarati fafda").matched[0]?.id, "fafda");
});

test("ships an expanded catalogue across common food groups", () => {
  assert.ok(FOOD_LIBRARY.length >= 150);
  const examples = ["butter chicken", "aloo paratha", "pani puri", "mango", "broccoli", "lassi", "sushi", "gulab jamun"];
  assert.deepEqual(examples.map(name => findFood(name)?.name), [
    "Butter chicken", "Aloo paratha", "Pani puri", "Mango", "Cooked broccoli", "Sweet lassi", "Sushi roll", "Gulab jamun"
  ]);
});

test("recognises representative dishes from cuisines around the world", () => {
  const dishes = [
    "hummus", "shakshuka", "injera with lentils", "jollof rice", "pad thai", "pho", "ramen", "bibimbap",
    "nasi goreng", "greek salad", "paella", "ratatouille", "fish and chips", "pierogi", "burrito", "arepa", "feijoada", "ceviche"
  ];
  assert.deepEqual(dishes.map(name => findFood(name)?.id), [
    "hummus", "shakshuka", "injera-lentils", "jollof-rice", "pad-thai", "pho", "ramen", "bibimbap",
    "nasi-goreng", "greek-salad", "paella", "ratatouille", "fish-chips", "pierogi", "burrito", "arepa", "feijoada", "ceviche"
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

test("chart history includes complete nutrition totals for each day", () => {
  const logs = [
    { at: "2026-10-08T08:00:00", kcal: 420, protein: 24, carbs: 52, fat: 12, fiber: 7 },
    { at: "2026-10-08T13:00:00", kcal: 610, protein: 31, carbs: 70, fat: 21, fiber: 10 }
  ];
  const series = chartSeries(logs, "week", { calories: 2000 }, new Date("2026-10-09T12:00:00"));
  const previousDay = series.find(point => point.key === "2026-10-08");
  assert.equal(previousDay.value, 1030);
  assert.deepEqual(previousDay.totals, { kcal: 1030, protein: 55, carbs: 122, fat: 33, fiber: 17 });
  assert.equal(previousDay.logCount, 2);
  assert.match(previousDay.fullLabel, /Thursday, October 8/);
});

test("formats and adjusts reminder times without a native time picker", () => {
  assert.equal(formatReminderTime("08:30"), "08:30 AM");
  assert.equal(formatReminderTime("13:05"), "01:05 PM");
  assert.equal(adjustReminderTime("23:58", 5), "00:03");
  assert.equal(adjustReminderTime("00:02", -5), "23:57");
  assert.equal(setReminderPeriod("08:30", "PM"), "20:30");
  assert.equal(setReminderPeriod("20:30", "AM"), "08:30");
  assert.deepEqual(reminderTimeParts("12:00"), { hour24: 12, hour12: 12, minute: 0, period: "PM" });
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
  const status = getNotificationState({ supported: true, permission: "granted", secureContext: true, isIOS: false, isStandalone: false, pushSupported: true, serverConfigured: true, pushStatus: "connected" });
  assert.equal(status.code, "granted");
  assert.equal(status.label, "Always on");
  assert.equal(status.action, "Send server test");
});

test("notification state distinguishes permission from closed-app delivery", () => {
  const status = getNotificationState({ supported: true, permission: "granted", secureContext: true, isIOS: false, isStandalone: false, pushSupported: true, serverConfigured: true, pushStatus: "idle" });
  assert.equal(status.code, "prompt");
  assert.equal(status.action, "Connect reminders");
});
