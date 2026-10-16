import { FOOD_LIBRARY } from "./data.js";

export function calculateTargets(profile) {
  const weight = Number(profile.weight) || 70;
  const height = Number(profile.height) || 170;
  const age = Number(profile.age) || 25;
  const basis = profile.basis || "female";
  const activity = Number(profile.activity) || 1.375;
  const constant = basis === "male" ? 5 : basis === "female" ? -161 : -78;
  const bmr = 10 * weight + 6.25 * height - 5 * age + constant;
  const goalDelta = profile.goal === "lose" ? -400 : profile.goal === "muscle" ? 250 : 0;
  const calories = Math.max(1200, Math.round((bmr * activity + goalDelta) / 10) * 10);
  const proteinPerKg = profile.goal === "muscle" ? 2 : profile.goal === "lose" ? 1.7 : 1.5;
  const protein = Math.round(weight * proteinPerKg);
  const fat = Math.round(weight * 0.8);
  const carbs = Math.max(80, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat, fiber: basis === "male" ? 38 : 28 };
}

export function normaliseLogDate(value, now = new Date()) {
  if (!value) return now;
  if (value.startsWith("today:")) {
    const [hours, minutes] = value.slice(6).split(":").map(Number);
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }
  return new Date(value);
}

export function dayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function totalsForDate(logs, date = new Date()) {
  const key = dayKey(date);
  return logs.reduce((total, log) => {
    if (dayKey(normaliseLogDate(log.at, date)) !== key) return total;
    for (const field of ["kcal", "protein", "carbs", "fat", "fiber"]) total[field] += Number(log[field]) || 0;
    return total;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}

const closeness = (actual, target) => Math.max(0, 1 - Math.abs(actual - target) / Math.max(target, 1));

export function calculateDayScore(totals, targets) {
  if (!totals.kcal) return 0;
  const calorieScore = closeness(totals.kcal, targets.calories) * 45;
  const proteinScore = Math.min(1, totals.protein / targets.protein) * 25;
  const fiberScore = Math.min(1, totals.fiber / targets.fiber) * 15;
  const macroCalories = totals.protein * 4 + totals.carbs * 4 + totals.fat * 9;
  const trackedRatio = macroCalories ? Math.min(totals.kcal, macroCalories) / Math.max(totals.kcal, macroCalories) : 0;
  return Math.round(Math.min(100, calorieScore + proteinScore + fiberScore + trackedRatio * 15));
}

export function macroStatus(value, goal) {
  const actual = Math.max(0, Number(value) || 0);
  const target = Math.max(0, Number(goal) || 0);
  const percentage = target ? Math.min(100, Math.round(actual / target * 100)) : 0;
  if (!target || actual <= target) return { level: "within", over: 0, percentage };
  return {
    level: actual >= target * 1.2 ? "danger" : "warning",
    over: round1(actual - target),
    percentage
  };
}

export function formatFoodPortion(food = {}) {
  const serving = String(food.serving || "1 serving").trim();
  const servings = Number(food.servings);
  if (!Number.isFinite(servings) || servings <= 0 || servings === 1) return serving;
  const countable = serving.match(/^1\s+([a-z]+)(.*)$/i);
  if (countable && Number.isInteger(servings)) {
    const [, unit, detail] = countable;
    return `${servings} ${pluraliseUnit(unit)}${detail}`;
  }
  return `${round1(servings)} × ${serving}`;
}

function pluraliseUnit(unit) {
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

export function getStreak(logs, now = new Date()) {
  const loggedDays = new Set(logs.map(log => dayKey(normaliseLogDate(log.at, now))));
  let current = 0;
  let cursor = new Date(now);
  if (!loggedDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (loggedDays.has(dayKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const sorted = [...loggedDays].sort();
  let best = sorted.length ? 1 : 0;
  let run = best;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = new Date(`${sorted[index - 1]}T12:00:00`);
    const next = new Date(`${sorted[index]}T12:00:00`);
    run = Math.round((next - previous) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current, best };
}

export function findFood(query) {
  const cleaned = normaliseFoodText(query)
    .replace(/^\s*(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔]|one|two|three|half|quarter)\s*/i, "")
    .replace(/^\s*(?:x|servings?|pieces?|pcs?|bowls?|cups?|plates?|glasses?|slices?|handfuls?)\s*/i, "")
    .trim();
  if (!cleaned) return null;
  const exactOnlyAliases = new Set(["aloo", "potato"]);
  const completeDishMatchRequired = cleaned === "paratha" || cleaned.endsWith(" paratha");
  let best = null;
  for (const food of FOOD_LIBRARY) {
    for (const rawAlias of food.aliases) {
      const alias = normaliseFoodText(rawAlias);
      const pattern = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exact = cleaned === alias;
      if (!exact && (completeDishMatchRequired || exactOnlyAliases.has(alias))) continue;
      if (!exact && !new RegExp(`\\b${pattern}\\b`).test(cleaned)) continue;
      const score = (exact ? 10000 : 0) + alias.length;
      if (!best || score > best.score) best = { food, score };
    }
  }
  return best?.food || null;
}

const VISUAL_FOOD_OVERRIDES = {
  "granny smith": "apple",
  espresso: "coffee",
  carbonara: "pasta",
  "french loaf": "bread-toast",
  "mashed potato": "potato",
  "hot and sour soup": "soup"
};

export function findVisualFood(label) {
  const candidates = [String(label || ""), ...String(label || "").split(",")]
    .map(normaliseFoodText)
    .filter(Boolean);
  for (const candidate of candidates) {
    const override = VISUAL_FOOD_OVERRIDES[candidate];
    if (override) return FOOD_LIBRARY.find(food => food.id === override) || null;
    for (const food of FOOD_LIBRARY) {
      if (food.aliases.some(alias => normaliseFoodText(alias) === candidate)) return food;
    }
  }
  return null;
}

let foodWordVocabulary;

function baseNormaliseFoodText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[_-]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}¼½¾⅓⅔/]+/gu, " ")
    .replace(/\b(?:paratha|parantha|prantha|parontha|prontha)s?\b/g, "paratha")
    .replace(/\b(?:ka|ki|ke|wala|waala|wali|with|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseFoodText(value) {
  return correctLikelyFoodTypos(baseNormaliseFoodText(value));
}

function correctLikelyFoodTypos(value) {
  if (!value) return "";
  const vocabulary = getFoodWordVocabulary();
  return value.split(" ").map(token => {
    if (token.length < 5 || vocabulary.has(token) || !/^\p{L}+$/u.test(token)) return token;
    const matches = [];
    for (const known of vocabulary) {
      if (known[0] !== token[0] || known.at(-1) !== token.at(-1) || Math.abs(known.length - token.length) > 1) continue;
      if (isSingleEditAway(token, known)) matches.push(known);
      if (matches.length > 1) return token;
    }
    return matches[0] || token;
  }).join(" ");
}

function getFoodWordVocabulary() {
  if (foodWordVocabulary) return foodWordVocabulary;
  foodWordVocabulary = new Set();
  for (const food of FOOD_LIBRARY) {
    for (const label of [food.name, ...food.aliases]) {
      for (const token of baseNormaliseFoodText(label).split(" ")) {
        if (token.length >= 4 && /^\p{L}+$/u.test(token)) foodWordVocabulary.add(token);
      }
    }
  }
  return foodWordVocabulary;
}

function isSingleEditAway(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    let differences = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index] && ++differences > 1) return false;
    }
    return differences === 1;
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else {
      if (skipped) return false;
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

export function parseMealText(text) {
  const segments = String(text || "").split(/[,;+\n]+/).map(cleanMealSegment).filter(Boolean);
  const matched = [];
  const unknown = [];
  let activeMealHint = null;
  for (const segment of segments) {
    const parsed = parseMealSegment(segment, activeMealHint);
    matched.push(...parsed.matched);
    unknown.push(...parsed.unknown);
    activeMealHint = parsed.mealHint;
  }
  return { matched, unknown };
}

function cleanMealSegment(segment) {
  return String(segment || "")
    .replace(/^\s*(?:(?:i|we)\s+(?:had|ate|drank|took)|my meal (?:was|included)|please add|log)\s+/i, "")
    .replace(/^\s*(?:a|an)\s+(?=(?:bowl|cup|plate|glass|slice|handful|piece)\b)/i, "1 ")
    .trim();
}

const MEAL_HINTS = {
  breakfast: "Breakfast",
  brunch: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  supper: "Dinner",
  snack: "Snack"
};

const NARRATIVE_TOKENS = new Set([
  "and", "plus", "then", "also", "later", "for", "at", "during", "today", "tonight",
  "morning", "afternoon", "evening", "night", "i", "we", "my", "meal", "was", "included",
  "had", "ate", "drank", "took", "please", "add", "log", "the", "a", "an", ...Object.keys(MEAL_HINTS)
]);

const PORTION_TOKENS = /^(?:x|servings?|pieces?|pcs?|bowls?|katoris?|cups?|plates?|glasses?|slices?|handfuls?|rotis?|chapatis?|eggs?)$/i;
const QUANTITY_TOKENS = /^(?:\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔]|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter)$/i;

function parseMealSegment(segment, initialMealHint = null) {
  const normalised = normaliseFoodText(segment);
  const tokens = normalised.split(" ").filter(Boolean);
  const candidates = collectFoodCandidates(tokens);
  const selected = selectFoodCandidates(candidates);
  const consumed = new Array(tokens.length).fill(false);
  const matched = [];
  let activeMealHint = initialMealHint;
  let cursor = 0;

  for (const match of selected) {
    const bridge = tokens.slice(cursor, match.start);
    activeMealHint = mealHintFromTokens(bridge) || activeMealHint;
    const bridgeIsContext = bridge.every(isMealBridgeToken);
    const quantity = bridgeIsContext ? parseMealQuantity(bridge.join(" ")) : 1;
    if (bridgeIsContext) markConsumed(consumed, cursor, match.start);
    else markNarrativeTokens(consumed, tokens, cursor, match.start);
    markConsumed(consumed, match.start, match.end);
    const item = scaleFood(match.food, quantity);
    if (activeMealHint) item.mealHint = activeMealHint;
    matched.push(item);
    cursor = match.end;
  }

  const tail = tokens.slice(cursor);
  const trailingMealHint = mealHintFromTokens(tail);
  markNarrativeTokens(consumed, tokens, cursor, tokens.length);
  if (trailingMealHint && matched.length && !matched.at(-1).mealHint && /\b(?:for|at|during)\s+(?:breakfast|brunch|lunch|dinner|supper|snack)\b/i.test(segment)) {
    matched.forEach(item => { item.mealHint = trailingMealHint; });
  }
  activeMealHint = trailingMealHint || activeMealHint;

  return { matched, unknown: collectUnknownPhrases(tokens, consumed), mealHint: activeMealHint };
}

function collectFoodCandidates(tokens) {
  const candidates = [];
  for (const food of FOOD_LIBRARY) {
    const aliases = new Set([food.name, ...food.aliases].map(normaliseFoodText).filter(Boolean));
    for (const alias of aliases) {
      const aliasTokens = alias.split(" ");
      if (aliasTokens.length > tokens.length) continue;
      for (let start = 0; start <= tokens.length - aliasTokens.length; start += 1) {
        if (!aliasTokens.every((token, offset) => tokens[start + offset] === token)) continue;
        candidates.push({ food, alias, start, end: start + aliasTokens.length, length: aliasTokens.length });
      }
    }
  }
  return candidates;
}

function selectFoodCandidates(candidates) {
  const selected = [];
  for (const candidate of candidates.sort((a, b) => a.start - b.start || b.length - a.length || b.alias.length - a.alias.length)) {
    if (selected.some(match => candidate.start < match.end && candidate.end > match.start)) continue;
    selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function isMealBridgeToken(token) {
  return NARRATIVE_TOKENS.has(token) || PORTION_TOKENS.test(token) || QUANTITY_TOKENS.test(token);
}

function mealHintFromTokens(tokens) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (MEAL_HINTS[tokens[index]]) return MEAL_HINTS[tokens[index]];
  }
  return null;
}

function markConsumed(consumed, start, end) {
  for (let index = start; index < end; index += 1) consumed[index] = true;
}

function markNarrativeTokens(consumed, tokens, start, end) {
  for (let index = start; index < end; index += 1) {
    if (NARRATIVE_TOKENS.has(tokens[index])) consumed[index] = true;
  }
}

function collectUnknownPhrases(tokens, consumed) {
  const phrases = [];
  let current = [];
  const flush = () => {
    if (current.length) phrases.push(current.join(" "));
    current = [];
  };
  tokens.forEach((token, index) => {
    if (consumed[index] || NARRATIVE_TOKENS.has(token)) {
      flush();
      return;
    }
    current.push(token);
  });
  flush();
  return phrases;
}

function parseMealQuantity(segment) {
  const mixedFraction = segment.match(/(?:^|\s)(\d+)\s+(\d+)\s*\/\s*(\d+)(?=\s|$)/);
  if (mixedFraction && Number(mixedFraction[3])) {
    return clampQuantity(Number(mixedFraction[1]) + Number(mixedFraction[2]) / Number(mixedFraction[3]));
  }

  const fraction = segment.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?=\s|$)/);
  if (fraction && Number(fraction[2])) return clampQuantity(Number(fraction[1]) / Number(fraction[2]));

  const unicodeFraction = segment.match(/(?:^|\s)(\d+\s*)?([¼½¾⅓⅔])(?=\s|$)/);
  if (unicodeFraction) {
    const values = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
    return clampQuantity(Number(unicodeFraction[1] || 0) + values[unicodeFraction[2]]);
  }

  if (/(?:^|\s)half(?:\s+(?:an?|of))?(?=\s)/.test(segment)) return 0.5;
  if (/(?:^|\s)quarter(?:\s+(?:of))?(?=\s)/.test(segment)) return 0.25;

  const wordNumber = segment.match(/(?:^|\s)(one|two|three|four|five|six|seven|eight|nine|ten)(?=\s|$)/);
  if (wordNumber) return { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[wordNumber[1]];

  const number = segment.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:x|servings?|pieces?|pcs?|bowls?|cups?|plates?|eggs?)?(?=\s|$)/);
  return number ? clampQuantity(Number(number[1])) : 1;
}

function clampQuantity(value) {
  return Math.max(0.1, Math.min(100, value));
}

export function scaleFood(food, servings = 1) {
  const factor = Math.max(0.1, Number(servings) || 1);
  return {
    ...food,
    servings: factor,
    kcal: Math.round(food.kcal * factor),
    protein: round1(food.protein * factor),
    carbs: round1(food.carbs * factor),
    fat: round1(food.fat * factor),
    fiber: round1(food.fiber * factor)
  };
}

export function recommendNext(totals, targets, profile = {}, limit = 8) {
  const remaining = {
    kcal: Math.max(0, targets.calories - totals.kcal),
    protein: Math.max(0, targets.protein - totals.protein),
    fiber: Math.max(0, targets.fiber - totals.fiber)
  };
  const vegetarian = profile.diet === "vegetarian";
  const vegan = profile.diet === "vegan";
  const candidates = FOOD_LIBRARY.filter(food => {
    if (vegan && !food.tags.includes("vegan")) return false;
    if (vegetarian && food.tags.includes("contains-egg")) return false;
    if (vegetarian && !food.tags.some(tag => tag === "vegetarian" || tag === "vegan")) return false;
    return food.kcal <= remaining.kcal + 120 && !food.tags.includes("dessert") && !food.tags.includes("drink");
  });
  return candidates
    .map(food => {
      const proteinNeed = remaining.protein ? Math.min(food.protein / remaining.protein, 1.5) : 0;
      const fiberNeed = remaining.fiber ? Math.min(food.fiber / remaining.fiber, 1.5) : 0;
      const calorieFit = remaining.kcal ? 1 - Math.abs(food.kcal - remaining.kcal * 0.45) / Math.max(remaining.kcal, 1) : 0;
      return { food, rank: proteinNeed * 3 + fiberNeed * 2 + calorieFit };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 8)))
    .map(({ food }) => ({ ...food, reason: recommendationReason(food, remaining) }));
}

function recommendationReason(food, remaining) {
  if (remaining.protein > 25 && food.protein >= 20) return `${Math.round(food.protein)}g protein to close today’s biggest gap`;
  if (remaining.fiber > 8 && food.fiber >= 5) return `${Math.round(food.fiber)}g fiber with room in your calorie budget`;
  return `Balanced fit for your remaining ${Math.round(remaining.kcal)} kcal`;
}

export function chartSeries(logs, period, targets, now = new Date()) {
  const days = period === "week" ? 7 : period === "month" ? 30 : 12;
  if (period === "year") {
    return Array.from({ length: days }, (_, offset) => {
      const month = new Date(now.getFullYear(), now.getMonth() - (days - 1 - offset), 1);
      const values = logs.filter(log => {
        const date = normaliseLogDate(log.at, now);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
      });
      const loggedDays = new Set(values.map(log => dayKey(normaliseLogDate(log.at, now)))).size;
      const totals = nutritionSummary(values, loggedDays || 1);
      return {
        key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
        label: month.toLocaleDateString("en", { month: "short" }),
        fullLabel: month.toLocaleDateString("en", { month: "long", year: "numeric" }),
        value: totals.kcal,
        totals,
        logCount: values.length,
        loggedDays,
        target: targets.calories
      };
    });
  }
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - 1 - offset));
    const key = dayKey(date);
    const values = logs.filter(log => dayKey(normaliseLogDate(log.at, now)) === key);
    const totals = nutritionSummary(values);
    return {
      key,
      label: period === "week" ? date.toLocaleDateString("en", { weekday: "short" }).slice(0, 1) : String(date.getDate()),
      fullLabel: date.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }),
      value: totals.kcal,
      totals,
      logCount: values.length,
      loggedDays: values.length ? 1 : 0,
      target: targets.calories
    };
  });
}

export function chartGeometry(values, target, labelSpace = 25) {
  const safeValues = values.map(value => Math.max(0, Number(value) || 0));
  const safeTarget = Math.max(0, Number(target) || 0);
  const max = Math.max(safeTarget * 1.25, ...safeValues, 1);
  const targetRatio = Math.min(0.94, safeTarget / max);
  return {
    max,
    targetPercent: round1(targetRatio * 100),
    targetOffset: round1((1 - targetRatio) * labelSpace),
    heightPercent(value) {
      const safeValue = Math.max(0, Number(value) || 0);
      return round1(Math.max(safeValue ? 5 : 0, (safeValue / max) * 100));
    }
  };
}

function nutritionSummary(logs, divisor = 1) {
  const totals = logs.reduce((summary, log) => {
    for (const field of ["kcal", "protein", "carbs", "fat", "fiber"]) summary[field] += Number(log[field]) || 0;
    return summary;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  return {
    kcal: Math.round(totals.kcal / divisor),
    protein: round1(totals.protein / divisor),
    carbs: round1(totals.carbs / divisor),
    fat: round1(totals.fat / divisor),
    fiber: round1(totals.fiber / divisor)
  };
}

export function mealTypeForTime(date = new Date()) {
  const hour = date.getHours();
  if (hour < 11) return "Breakfast";
  if (hour < 16) return "Lunch";
  if (hour < 18) return "Snack";
  return "Dinner";
}

export function reminderTimeParts(value = "08:00") {
  const match = String(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const hour24 = match ? Number(match[1]) : 8;
  const minute = match ? Number(match[2]) : 0;
  return {
    hour24,
    hour12: hour24 % 12 || 12,
    minute,
    period: hour24 >= 12 ? "PM" : "AM"
  };
}

export function formatReminderTime(value) {
  const { hour12, minute, period } = reminderTimeParts(value);
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
}

export function adjustReminderTime(value, minutes) {
  const { hour24, minute } = reminderTimeParts(value);
  const total = (hour24 * 60 + minute + Number(minutes || 0) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function setReminderPeriod(value, period) {
  const { hour24, minute } = reminderTimeParts(value);
  const target = period === "PM" ? "PM" : "AM";
  const nextHour = target === "PM" && hour24 < 12 ? hour24 + 12 : target === "AM" && hour24 >= 12 ? hour24 - 12 : hour24;
  return `${String(nextHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
