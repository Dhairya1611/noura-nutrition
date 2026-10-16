const USDA_SEARCH_ENDPOINT = "https://api.nal.usda.gov/fdc/v1/foods/search";
const OPEN_FOOD_FACTS_SEARCH_ENDPOINT = "https://search.openfoodfacts.org/search";
const OPEN_FOOD_FACTS_LEGACY_ENDPOINT = "https://world.openfoodfacts.org/cgi/search.pl";
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
  const name = description;
  return {
    id: `usda-${food?.fdcId || index}`,
    name,
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
    description: `${name}${brand ? ` from ${brand}` : ""}. Nutrition is listed for ${serving}; choose it only if that serving matches what you ate.`,
    source: "USDA FoodData Central"
  };
}

export function mapOpenFoodFactsProduct(product, query = "food", index = 0) {
  const nutrients = product?.nutriments || {};
  const servingGrams = positiveNumber(product?.serving_quantity);
  const scale = servingGrams ? servingGrams / 100 : 1;
  const nutrientValue = name => {
    const perServing = positiveNumber(nutrients[`${name}_serving`], true);
    if (perServing != null) return perServing;
    const perHundred = positiveNumber(nutrients[`${name}_100g`], true);
    return perHundred == null ? 0 : perHundred * scale;
  };
  const kcal = nutrientValue("energy-kcal");
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  const rawName = product?.product_name || product?.generic_name || cleanFoodSearchQuery(query) || "Database food";
  const name = titleCase(String(rawName).toLowerCase());
  const serving = product?.serving_size || (servingGrams ? `${round1(servingGrams)} g` : "100 g");
  const brand = product?.brands || "Open Food Facts";
  const genericName = titleCase(String(product?.generic_name || "").trim().toLowerCase());
  const detail = genericName && genericName.toLowerCase() !== name.toLowerCase() ? `${genericName}. ` : "";
  return {
    id: `off-${product?.code || index}`,
    name,
    brand,
    emoji: "🍽️",
    serving,
    grams: round1(servingGrams || 100),
    servings: 1,
    kcal: Math.round(kcal),
    protein: round1(nutrientValue("proteins")),
    carbs: round1(nutrientValue("carbohydrates")),
    fat: round1(nutrientValue("fat")),
    fiber: round1(nutrientValue("fiber")),
    image: safeOpenFoodFactsImage(product?.image_front_small_url || product?.image_small_url || product?.image_front_url || product?.image_url),
    description: `${detail}${name}${brand ? ` by ${brand}` : ""}. The label serving is ${serving}; compare the photo and serving before choosing.`,
    source: "Open Food Facts"
  };
}

export async function searchFoodDatabase(query, fetchImpl = fetch) {
  const cleaned = cleanFoodSearchQuery(query);
  if (!cleaned) return [];
  const [usdaSearch, openFoodFactsSearch] = await Promise.allSettled([
    searchUsda(cleaned, fetchImpl),
    searchOpenFoodFacts(cleaned, fetchImpl)
  ]);
  const usdaResults = usdaSearch.status === "fulfilled" ? usdaSearch.value : [];
  const openFoodFactsResults = openFoodFactsSearch.status === "fulfilled" ? openFoodFactsSearch.value : [];
  const photographed = openFoodFactsResults.filter(food => food.image);
  const remaining = [...usdaResults, ...openFoodFactsResults.filter(food => !food.image)];
  const combined = uniqueFoods([...photographed, ...remaining]).slice(0, 3);
  if (combined.length) return combined;
  if (usdaSearch.status === "rejected" && openFoodFactsSearch.status === "rejected") {
    throw new Error("The free global food databases are temporarily unavailable. Enter the nutrition manually below.");
  }
  return [];
}

async function searchUsda(cleaned, fetchImpl) {
  const url = new URL(USDA_SEARCH_ENDPOINT);
  url.searchParams.set("api_key", DEMO_API_KEY);
  url.searchParams.set("query", cleaned);
  url.searchParams.set("pageSize", "8");
  const response = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(response.status === 429 ? "USDA FoodData Central reached its free demo limit." : "USDA FoodData Central is unavailable.");
  }
  const data = await response.json();
  return uniqueFoods((data.foods || [])
    .map((food, index) => mapUsdaFood(food, cleaned, index))
    .filter(Boolean));
}

async function searchOpenFoodFacts(cleaned, fetchImpl) {
  const url = new URL(OPEN_FOOD_FACTS_SEARCH_ENDPOINT);
  url.searchParams.set("q", cleaned);
  url.searchParams.set("page_size", "8");
  url.searchParams.set("langs", "en");
  url.searchParams.set("fields", "code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments,image_front_small_url,image_small_url,image_front_url,image_url");
  try {
    const results = await fetchOpenFoodFacts(url, cleaned, fetchImpl);
    if (results.length) return results;
  } catch {
    // The current full-text service may be blocked by an older browser; try the legacy public search below.
  }

  const legacyUrl = new URL(OPEN_FOOD_FACTS_LEGACY_ENDPOINT);
  legacyUrl.searchParams.set("search_terms", cleaned);
  legacyUrl.searchParams.set("search_simple", "1");
  legacyUrl.searchParams.set("action", "process");
  legacyUrl.searchParams.set("json", "1");
  legacyUrl.searchParams.set("page_size", "8");
  legacyUrl.searchParams.set("fields", "code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments,image_front_small_url,image_small_url,image_front_url,image_url");
  return fetchOpenFoodFacts(legacyUrl, cleaned, fetchImpl);
}

async function fetchOpenFoodFacts(url, cleaned, fetchImpl) {
  const response = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Open Food Facts is unavailable.");
  const data = await response.json();
  return uniqueFoods((data.hits || data.products || [])
    .map((product, index) => mapOpenFoodFactsProduct(product, cleaned, index))
    .filter(Boolean));
}

function uniqueFoods(foods) {
  const seen = new Set();
  return foods.filter(food => {
    const key = `${food.name.toLowerCase()}|${String(food.brand || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function positiveNumber(value, allowZero = false) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) return null;
  return parsed;
}

function safeOpenFoodFactsImage(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(host === "openfoodfacts.org" || host.endsWith(".openfoodfacts.org"))) return "";
    return url.href;
  } catch {
    return "";
  }
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, letter => letter.toUpperCase());
}
