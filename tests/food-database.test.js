import test from "node:test";
import assert from "node:assert/strict";
import { cleanFoodSearchQuery, mapUsdaFood, searchFoodDatabase } from "../src/food-database.js";

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
  assert.equal(food.source, "USDA FoodData Central");
});

test("food search requests only usable results and caps suggestions", async () => {
  let requestedUrl = "";
  const foods = Array.from({ length: 5 }, (_, index) => ({
    fdcId: index + 1,
    description: `Food ${index + 1}`,
    brandName: "Example",
    servingSize: 100,
    foodNutrients: [{ nutrientId: 1008, value: 100 + index }]
  }));
  foods.push({ fdcId: 99, description: "No nutrition", foodNutrients: [] });
  const results = await searchFoodDatabase("1 bowl noodles", async url => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ foods }) };
  });
  assert.equal(new URL(requestedUrl).searchParams.get("query"), "noodles");
  assert.equal(results.length, 3);
  assert.ok(results.every(food => food.kcal > 0));
});
