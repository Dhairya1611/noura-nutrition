import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustReminderTime, calculateDayScore, calculateTargets, chartGeometry, chartSeries, findFood, findVisualFood, foodMatchesDiet, formatFoodPortion, formatReminderTime,
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

test("recognises ordinary walnuts directly with natural counts", () => {
  const one = parseMealText("1 walnut").matched[0];
  const seven = parseMealText("7 walnuts").matched[0];
  assert.equal(one.id, "walnuts");
  assert.equal(one.serving, "1 walnut");
  assert.equal(one.kcal, 26);
  assert.equal(formatFoodPortion(one), "1 walnut");
  assert.equal(seven.servings, 7);
  assert.equal(seven.kcal, 182);
  assert.equal(formatFoodPortion(seven), "7 walnuts");
  assert.equal(findFood("akhrot")?.id, "walnuts");
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
  assert.equal(result.matched[1].name, "Plain curd (dahi)");
  assert.ok(result.matched.every(food => food.mealHint === "Lunch"));
  assert.deepEqual(parseMealText("Please add dragon bowl for dinner").unknown, ["dragon bowl"]);
});

test("extracts several foods written together without commas or conjunctions", () => {
  const result = parseMealText("2 roti petha sabzi curd");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["roti", "petha-sabzi", "yogurt"]);
  assert.deepEqual(result.matched.map(food => food.kcal), [240, 135, 90]);
  assert.equal(result.matched[0].servings, 2);
  assert.equal(result.matched[1].servings, 1);
  assert.equal(result.matched[2].name, "Plain curd (dahi)");
});

test("recognises chawal and a complete Hindi meal in Roman or Devanagari text", () => {
  const roman = parseMealText("2 roti chawal dal");
  assert.deepEqual(roman.unknown, []);
  assert.deepEqual(roman.matched.map(food => food.id), ["roti", "rice", "dal"]);
  assert.deepEqual(roman.matched.map(food => food.kcal), [240, 205, 210]);

  const devanagari = parseMealText("२ रोटी चावल और दाल");
  assert.deepEqual(devanagari.unknown, []);
  assert.deepEqual(devanagari.matched.map(food => food.id), ["roti", "rice", "dal"]);
  assert.equal(devanagari.matched[0].servings, 2);
});

test("recognises common Hindi and Hinglish food names", () => {
  const names = ["kela", "seb", "nashpati", "doodh", "badam", "santra", "angoor", "papita", "tarbooz", "ananas", "tamatar", "pyaaz", "gajar", "palak", "matar", "makka"];
  assert.deepEqual(names.map(name => findFood(name)?.id), ["banana", "apple", "pear", "milk", "almonds", "orange", "grapes", "papaya", "watermelon", "pineapple", "tomato", "onion", "carrots", "spinach", "peas", "corn"]);
  assert.deepEqual(["केला", "सेब", "दूध", "बादाम", "खीरा", "आलू", "गोभी"].map(name => findFood(name)?.id), ["banana", "apple", "milk", "almonds", "cucumber", "potato", "cauliflower"]);
});

test("corrects a conservative food typo inside an unpunctuated meal", () => {
  const result = parseMealText("fried ricce curd");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["fried-rice", "yogurt"]);
  assert.deepEqual(result.matched.map(food => food.name), ["Fried rice", "Plain curd (dahi)"]);
});

test("does not rewrite a word when more than one food spelling is plausible", () => {
  const result = parseMealText("mangoes dragon");
  assert.equal(result.matched[0]?.id, "mango");
  assert.deepEqual(result.unknown, ["dragon"]);
});

test("accepts a whole day in one message and keeps meal labels", () => {
  const result = parseMealText("Breakfast 2 eggs banana; lunch 2 roti petha sabzi curd; dinner 1 bowl dal rice");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["egg", "banana", "roti", "petha-sabzi", "yogurt", "dal", "rice"]);
  assert.deepEqual(result.matched.map(food => food.mealHint), ["Breakfast", "Breakfast", "Lunch", "Lunch", "Lunch", "Dinner", "Dinner"]);
  assert.equal(result.matched.find(food => food.id === "egg")?.servings, 2);
  assert.equal(result.matched.find(food => food.id === "roti")?.servings, 2);
});

test("keeps plain curd distinct from Greek yogurt", () => {
  assert.equal(findFood("curd")?.id, "yogurt");
  assert.equal(findFood("curd")?.name, "Plain curd (dahi)");
  assert.equal(findFood("greek yogurt")?.id, "greek-yogurt");
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

test("keeps aloo gobhi together instead of logging boiled potato", () => {
  const result = parseMealText("2 roti aloo gobhi");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["roti", "aloo-gobi"]);
  assert.deepEqual(result.matched.map(food => food.kcal), [240, 180]);
  assert.equal(result.matched.some(food => food.id === "potato"), false);
  assert.equal(findFood("aloo gobhi ki sabzi")?.id, "aloo-gobi");
  assert.equal(findFood("gobhi")?.id, "cauliflower");
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

test("recognises raita as its own dish and preserves specific varieties", () => {
  const result = parseMealText("raita, kheera raita and boondi raita");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["raita", "cucumber-raita", "boondi-raita"]);
  assert.equal(result.matched[0].name, "Plain raita");
  assert.equal(result.matched.some(food => food.id === "yogurt"), false);
  assert.equal(findFood("लौकी रायता")?.id, "lauki-raita");
});

test("recognises common Navratri fasting foods in complete meal text", () => {
  const result = parseMealText("sabudana khichdi kuttu ki puri makhana kheer fruit chaat");
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched.map(food => food.id), ["sabudana-khichdi", "kuttu-puri", "makhana-kheer", "fruit-chaat"]);
  assert.deepEqual([
    "samak khichdi", "sabudana vada", "kuttu roti", "singhara roti", "rajgira roti", "vrat wale aloo",
    "arbi ki sabzi", "roasted makhana", "sabudana kheer", "shakarkandi chaat", "kuttu pakode", "singhara halwa", "rajgira ladoo"
  ].map(name => findFood(name)?.id), [
    "samak-khichdi", "sabudana-vada", "kuttu-roti", "singhara-roti", "rajgira-roti", "vrat-aloo",
    "arbi-sabzi", "roasted-makhana", "sabudana-kheer", "sweet-potato-chaat", "kuttu-pakora", "singhara-halwa", "rajgira-ladoo"
  ]);
  assert.equal(parseMealText("कुट्टू की पूरी मखाना खीर फल चाट").unknown.length, 0);
});

test("recognises chole kulche as one combined dish", () => {
  const result = parseMealText("chole kulche");
  assert.deepEqual(result.unknown, []);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].id, "chole-kulche");
  assert.equal(result.matched[0].name, "Chole kulche");
  assert.equal(result.matched[0].serving, "1 plate (2 kulche + chole)");
  assert.equal(result.matched[0].kcal, 820);
  assert.deepEqual(["chole kulcha", "chana kulche", "chhole kulche"].map(name => findFood(name)?.id), ["chole-kulche", "chole-kulche", "chole-kulche"]);
  assert.equal(findFood("chole")?.id, "chole");
  assert.equal(findFood("kulcha")?.id, "kulcha");
});

test("keeps chaap biryani together and does not assume every biryani is chicken", () => {
  const result = parseMealText("1 plate chaap biryani");
  assert.deepEqual(result.unknown, []);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].id, "chaap-biryani");
  assert.equal(result.matched[0].name, "Soya chaap biryani");
  assert.equal(result.matched[0].kcal, 650);
  assert.equal(result.matched.some(food => food.id === "soya-chaap" || food.id === "chicken-biryani"), false);

  assert.equal(parseMealText("सोया चाप बिरयानी").matched[0]?.id, "chaap-biryani");
  assert.equal(findFood("chicken biryani")?.id, "chicken-biryani");
  assert.equal(findFood("biryani")?.name, "Biryani (type not specified)");
  assert.deepEqual(["veg biryani", "paneer biryani", "anda biryani", "mutton biryani"].map(name => findFood(name)?.id), ["vegetable-biryani", "paneer-biryani", "egg-biryani", "mutton-biryani"]);
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

test("food preferences enforce non-vegetarian, vegetarian, and vegan rules", () => {
  const chicken = findFood("grilled chicken");
  const paneer = findFood("paneer tikka");
  const tofu = findFood("grilled tofu");
  const egg = findFood("boiled egg");

  assert.ok([chicken, paneer, tofu, egg].every(food => foodMatchesDiet(food, "everything")));
  assert.ok([chicken, paneer, tofu, egg].every(food => foodMatchesDiet(food, "omnivore")));
  assert.equal(foodMatchesDiet(chicken, "vegetarian"), false);
  assert.equal(foodMatchesDiet(egg, "vegetarian"), false);
  assert.equal(foodMatchesDiet(paneer, "vegetarian"), true);
  assert.equal(foodMatchesDiet(tofu, "vegetarian"), true);
  assert.equal(foodMatchesDiet(chicken, "vegan"), false);
  assert.equal(foodMatchesDiet(paneer, "vegan"), false);
  assert.equal(foodMatchesDiet(egg, "vegan"), false);
  assert.equal(foodMatchesDiet(tofu, "vegan"), true);
});

test("coach excludes eggs from vegetarian suggestions", () => {
  const recs = recommendNext(
    { kcal: 2000, protein: 120, carbs: 250, fat: 65, fiber: 30 },
    { calories: 2000, protein: 120, carbs: 250, fat: 65, fiber: 30 },
    { diet: "vegetarian" },
    12
  );
  assert.equal(recs.length, 12);
  assert.ok(recs.every(food => !food.tags.includes("contains-egg")));
  assert.ok(recs.every(food => !["egg", "fried-egg", "omelette", "egg-curry", "egg-paratha", "shakshuka"].includes(food.id)));
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

test("positions above-target calorie bars above the target line", () => {
  const geometry = chartGeometry([2798], 2630);
  assert.equal(geometry.max, 3287.5);
  assert.equal(geometry.targetPercent, 80);
  assert.equal(geometry.targetOffset, 5);
  assert.equal(geometry.heightPercent(2798), 85.1);
  assert.ok(geometry.heightPercent(2798) > geometry.targetPercent);
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
