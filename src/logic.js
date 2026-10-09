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
  const cleaned = query.toLowerCase().trim().replace(/[_-]/g, " ");
  if (!cleaned) return null;
  return FOOD_LIBRARY.find(food => food.aliases.some(alias => {
    const pattern = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return cleaned === alias || new RegExp(`\\b${pattern}\\b`).test(cleaned);
  })) || null;
}

export function parseMealText(text) {
  const segments = text.toLowerCase().replace(/\band\b/g, ",").split(/[,;+]/).map(item => item.trim()).filter(Boolean);
  const matched = [];
  const unknown = [];
  for (const segment of segments) {
    const quantityMatch = segment.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:x|servings?|pieces?|pcs?|bowls?|cups?|plates?|eggs?)?\b/);
    const quantity = quantityMatch ? Math.min(10, Number(quantityMatch[1])) : 1;
    const food = findFood(segment);
    if (!food) {
      unknown.push(segment);
      continue;
    }
    matched.push(scaleFood(food, quantity));
  }
  return { matched, unknown };
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

export function recommendNext(totals, targets, profile = {}) {
  const remaining = {
    kcal: Math.max(0, targets.calories - totals.kcal),
    protein: Math.max(0, targets.protein - totals.protein),
    fiber: Math.max(0, targets.fiber - totals.fiber)
  };
  const vegetarian = profile.diet === "vegetarian";
  const vegan = profile.diet === "vegan";
  const candidates = FOOD_LIBRARY.filter(food => {
    if (vegan && !food.tags.includes("vegan")) return false;
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
    .slice(0, 3)
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
      const total = values.reduce((sum, log) => sum + Number(log.kcal || 0), 0);
      const uniqueDays = new Set(values.map(log => dayKey(normaliseLogDate(log.at, now)))).size || 1;
      return { label: month.toLocaleDateString("en", { month: "short" }), value: Math.round(total / uniqueDays), target: targets.calories };
    });
  }
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - 1 - offset));
    const total = totalsForDate(logs, date).kcal;
    return { label: period === "week" ? date.toLocaleDateString("en", { weekday: "short" }).slice(0, 1) : String(date.getDate()), value: Math.round(total), target: targets.calories };
  });
}

export function mealTypeForTime(date = new Date()) {
  const hour = date.getHours();
  if (hour < 11) return "Breakfast";
  if (hour < 16) return "Lunch";
  if (hour < 18) return "Snack";
  return "Dinner";
}

export function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
