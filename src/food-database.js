const SEARCH_ENDPOINT = "https://api.nal.usda.gov/fdc/v1/foods/search";
const DEMO_API_KEY = "DEMO_KEY";

const round1 = value => Math.round((Number(value) || 0) * 10) / 10;

export function cleanFoodSearchQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔]|half|quarter)\s*/i, "")
    .replace(/^\s*(?:x|servings?|pieces?|pcs?|bowls?|cups?|plates?|glasses?|slices?)\s+(?:of\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function mapUsdaFood(food, query = "food", index = 0) {
  const servingGrams = positiveNumber(food?.servingSize) || 100;
  const nutrientValue = id => {
    const nutrient = (food?.foodNutrients || []).find(item => Number(item.nutrientId) === id);
    return positiveNumber(nutrient?.value, true) ?? 0;
  };
  const scale = servingGrams / 100;
  const kcal = nutrientValue(1008) * scale;
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  const description = titleCase(String(food?.description || cleanFoodSearchQuery(query) || "Database food").toLowerCase());
  const brand = food?.brandName || food?.brandOwner || food?.dataType || "USDA FoodData Central";
  const serving = food?.householdServingFullText || (food?.servingSize ? `${round1(servingGrams)} ${food.servingSizeUnit || "g"}` : "100 g");
  return {
    id: `usda-${food?.fdcId || index}`,
    name: description,
    brand,
    emoji: "🍽️",
    serving,
    grams: round1(servingGrams),
    servings: 1,
    kcal: Math.round(kcal),
    protein: round1(nutrientValue(1003) * scale),
    carbs: round1(nutrientValue(1005) * scale),
    fat: round1(nutrientValue(1004) * scale),
    fiber: round1(nutrientValue(1079) * scale),
    image: "",
    source: "USDA FoodData Central"
  };
}

export async function searchFoodDatabase(query, fetchImpl = fetch) {
  const cleaned = cleanFoodSearchQuery(query);
  if (!cleaned) return [];
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("api_key", DEMO_API_KEY);
  url.searchParams.set("query", cleaned);
  url.searchParams.set("pageSize", "8");
  const response = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 429) throw new Error("The free food-database limit was reached. Enter the nutrition manually below.");
    throw new Error("The food database is temporarily unavailable.");
  }
  const data = await response.json();
  const seen = new Set();
  return (data.foods || [])
    .map((food, index) => mapUsdaFood(food, cleaned, index))
    .filter(food => {
      if (!food) return false;
      const key = `${food.name.toLowerCase()}|${food.brand.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function positiveNumber(value, allowZero = false) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) return null;
  return parsed;
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, letter => letter.toUpperCase());
}
