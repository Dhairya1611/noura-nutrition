import { pipeline, env } from "@huggingface/transformers";

let classifierPromise;

export async function classifyFoodImage(file, onProgress = () => {}) {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (!classifierPromise) {
    classifierPromise = pipeline("image-classification", "onnx-community/swin-finetuned-food101-ONNX", {
      dtype: "q8",
      progress_callback: event => {
        if (event.status === "progress") onProgress(Math.round(event.progress || 0), "Downloading local AI…");
        if (event.status === "ready") onProgress(100, "AI ready");
      }
    });
  }
  const classifier = await classifierPromise;
  onProgress(100, "Analysing your food…");
  const url = URL.createObjectURL(file);
  try {
    return await classifier(url, { top_k: 5 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function detectBarcode(file) {
  if (!("BarcodeDetector" in window)) throw new Error("This browser does not support camera barcode detection. Enter the code instead.");
  const formats = await window.BarcodeDetector.getSupportedFormats();
  const detector = new window.BarcodeDetector({ formats: formats.filter(format => ["ean_13", "ean_8", "upc_a", "upc_e"].includes(format)) });
  const bitmap = await createImageBitmap(file);
  const results = await detector.detect(bitmap);
  bitmap.close();
  if (!results.length) throw new Error("No barcode found. Try a brighter, closer photo or enter the number.");
  return results[0].rawValue;
}

export async function lookupBarcode(code) {
  const normalized = String(code).replace(/\D/g, "");
  if (normalized.length < 7) throw new Error("Enter a valid EAN or UPC barcode.");
  const fields = "code,product_name,brands,image_front_small_url,serving_size,nutriments,nutrition_grades";
  const response = await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(normalized)}.json?fields=${fields}`);
  if (!response.ok) throw new Error("Could not reach Open Food Facts. Check your connection and try again.");
  const data = await response.json();
  if (!data.product) throw new Error("That product is not in Open Food Facts yet. Add it manually instead.");
  const product = data.product;
  const n = product.nutriments || {};
  const servingGrams = Number.parseFloat(product.serving_size) || 100;
  const scale = servingGrams / 100;
  const per100 = key => Number(n[`${key}_100g`] ?? n[key] ?? 0);
  return {
    id: `barcode-${normalized}`,
    barcode: normalized,
    name: product.product_name || product.brands || "Packaged food",
    brand: product.brands || "Open Food Facts",
    emoji: "▦",
    serving: product.serving_size || "100 g",
    grams: servingGrams,
    kcal: Math.round(per100("energy-kcal") * scale),
    protein: Math.round(per100("proteins") * scale * 10) / 10,
    carbs: Math.round(per100("carbohydrates") * scale * 10) / 10,
    fat: Math.round(per100("fat") * scale * 10) / 10,
    fiber: Math.round(per100("fiber") * scale * 10) / 10,
    image: product.image_front_small_url || "",
    grade: product.nutrition_grades || null,
    source: "Open Food Facts"
  };
}
