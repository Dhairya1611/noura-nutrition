import test from "node:test";
import assert from "node:assert/strict";
import { cleanFoodSearchQuery, mapOpenFoodFactsProduct, mapUsdaFood, searchFoodDatabase } from "../src/food-database.js";

test("removes quantities and serving words before database search", () => {
  assert.equal(cleanFoodSearchQuery("1 bowl chaap"), "chaap");
  assert.equal(cleanFoodSearchQuery("1/2 cup muesli"), "muesli");
});

test("maps USDA nutrition to the labelled serving", () => {
  const food = mapUsdaFood({
    fdcId: 123,
    description: "Sample muesli",
    brandName: "Example",
    servingSize: 50,
    servingSizeUnit: "g",
    foodNutrients: [
      { nutrientId: 1008, value: 400 },
      { nutrientId: 1003, value: 10 },
      { nutrientId: 1005, value: 60 },
      { nutrientId: 1004, value: 12 },
      { nutrientId: 1079, value: 8 }
    ]
  });
  assert.equal(food.kcal, 200);
  assert.equal(food.protein, 5);
  assert.equal(food.serving, "50 g");
  assert.match(food.description, /Example/);
  assert.match(food.description, /50 g/);
  assert.equal(food.source, "USDA FoodData Central");
});

test("maps Open Food Facts nutrition to the product serving", () => {
  const food = mapOpenFoodFactsProduct({
    code: "890123",
    product_name: "Sesame snack",
    brands: "Example Foods",
    generic_name: "Crisp sesame and jaggery snack",
    serving_size: "30 g",
    serving_quantity: 30,
    image_front_small_url: "https://images.openfoodfacts.org/images/products/890/123/front_en.3.200.jpg",
    nutriments: {
      "energy-kcal_100g": 500,
      proteins_100g: 10,
      carbohydrates_100g: 60,
      fat_100g: 24,
      fiber_100g: 8
    }
  });
  assert.equal(food.kcal, 150);
  assert.equal(food.protein, 3);
  assert.equal(food.serving, "30 g");
  assert.match(food.image, /^https:\/\/images\.openfoodfacts\.org\//);
  assert.match(food.description, /Crisp Sesame And Jaggery Snack/);
  assert.equal(food.source, "Open Food Facts");
});

test("rejects non-Open Food Facts product images", () => {
  const food = mapOpenFoodFactsProduct({
    code: "unsafe",
    product_name: "Example food",
    image_front_small_url: "https://tracker.example/image.jpg",
    nutriments: { "energy-kcal_100g": 100 }
  });
  assert.equal(food.image, "");
});

test("food search requests only usable results and caps suggestions", async () => {
  const requestedUrls = [];
  const foods = Array.from({ length: 5 }, (_, index) => ({
    fdcId: index + 1,
    description: `Food ${index + 1}`,
    brandName: "Example",
    servingSize: 100,
    foodNutrients: [{ nutrientId: 1008, value: 100 + index }]
  }));
  foods.push({ fdcId: 99, description: "No nutrition", foodNutrients: [] });
  const results = await searchFoodDatabase("1 bowl noodles", async url => {
    requestedUrls.push(url);
    if (url.includes("api.nal.usda.gov")) return { ok: true, json: async () => ({ foods }) };
    return { ok: true, json: async () => ({ products: [] }) };
  });
  const usdaUrl = requestedUrls.find(url => url.includes("api.nal.usda.gov"));
  assert.equal(new URL(usdaUrl).searchParams.get("query"), "noodles");
  assert.equal(results.length, 3);
  assert.ok(results.every(food => food.kcal > 0));
});

test("photo-backed choices appear before text-only database matches", async () => {
  const results = await searchFoodDatabase("mystery snack", async url => {
    if (url.includes("api.nal.usda.gov")) return { ok: true, json: async () => ({ foods: [{
      fdcId: 1, description: "Text only snack", servingSize: 100,
      foodNutrients: [{ nutrientId: 1008, value: 120 }]
    }] }) };
    return { ok: true, json: async () => ({ products: [{
      code: "photo", product_name: "Photographed snack", serving_size: "30 g", serving_quantity: 30,
      image_front_small_url: "https://images.openfoodfacts.org/images/products/photo/front.1.200.jpg",
      nutriments: { "energy-kcal_100g": 400 }
    }] }) };
  });
  assert.equal(results[0].name, "Photographed Snack");
  assert.ok(results[0].image);
});

test("falls back to the key-free Open Food Facts search when USDA is unavailable", async () => {
  const requested = [];
  const results = await searchFoodDatabase("1 packet global snack", async url => {
    requested.push(url);
    if (url.includes("api.nal.usda.gov")) return { ok: false, status: 429 };
    return {
      ok: true,
      json: async () => ({
        products: [{
          code: "123",
          product_name: "Global snack",
          brands: "World Foods",
          serving_size: "40 g",
          serving_quantity: 40,
          nutriments: {
            "energy-kcal_100g": 400,
            proteins_100g: 10,
            carbohydrates_100g: 50,
            fat_100g: 18,
            fiber_100g: 5
          }
        }]
      })
    };
  });
  assert.equal(requested.length, 2);
  assert.ok(requested[1].includes("openfoodfacts.org"));
  assert.equal(results[0].name, "Global Snack");
  assert.equal(results[0].kcal, 160);
  assert.equal(results[0].source, "Open Food Facts");
});
