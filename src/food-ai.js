import { pipeline, env } from "@huggingface/transformers";

const FAST_MODEL = "onnx-community/mobilenetv4_conv_small.e2400_r224_in1k";
const DEEP_MODEL = "onnx-community/swin-finetuned-food101-ONNX";
const progressListeners = { fast: new Set(), deep: new Set() };
let fastClassifierPromise;
let deepClassifierPromise;

export function foodAiRuntime({ webgpu = Boolean(globalThis.navigator?.gpu) } = {}) {
  return webgpu
    ? { device: "webgpu", dtype: "fp16", download: "about 8 MB", acceleration: "WebGPU" }
    : { dtype: "q8", download: "about 4 MB", acceleration: "this device" };
}

export async function prepareFoodClassifier(mode = "fast", onProgress = () => {}) {
  const listeners = progressListeners[mode];
  listeners.add(onProgress);
  try {
    if (mode === "deep") {
      if (!deepClassifierPromise) deepClassifierPromise = createClassifier("deep").catch(error => { deepClassifierPromise = undefined; throw error; });
      return await deepClassifierPromise;
    }
    if (!fastClassifierPromise) fastClassifierPromise = createClassifier("fast").catch(error => { fastClassifierPromise = undefined; throw error; });
    return await fastClassifierPromise;
  } finally {
    listeners.delete(onProgress);
  }
}

async function createClassifier(mode) {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const deep = mode === "deep";
  const runtime = foodAiRuntime();
  const model = deep ? DEEP_MODEL : FAST_MODEL;
  const options = deep
    ? { ...(runtime.device ? { device: runtime.device } : {}), dtype: runtime.device ? "q4f16" : "q4" }
    : { ...(runtime.device ? { device: runtime.device } : {}), dtype: runtime.dtype };
  const emit = (progress, title) => progressListeners[mode].forEach(listener => listener(progress, title));

  try {
    return await pipeline("image-classification", model, {
      ...options,
      progress_callback: event => {
        if (event.status === "progress") emit(Math.round(event.progress || 0), deep ? "Preparing deeper scan…" : "Preparing fast scanner…");
        if (event.status === "ready") emit(100, deep ? "Deeper scanner ready" : "Fast scanner ready");
      }
    });
  } catch (error) {
    if (!options.device) throw error;
    emit(0, "Switching to compatible scanner…");
    return pipeline("image-classification", model, {
      dtype: deep ? "q4" : "q8",
      progress_callback: event => {
        if (event.status === "progress") emit(Math.round(event.progress || 0), deep ? "Preparing deeper scan…" : "Preparing fast scanner…");
        if (event.status === "ready") emit(100, deep ? "Deeper scanner ready" : "Fast scanner ready");
      }
    });
  }
}

export async function classifyFoodImage(file, onProgress = () => {}, { mode = "fast" } = {}) {
  const classifier = await prepareFoodClassifier(mode, onProgress);
  onProgress(100, mode === "deep" ? "Taking a closer look…" : "Scanning your photo…");
  const image = await resizeForRecognition(file);
  const url = URL.createObjectURL(image);
  try {
    return await classifier(url, { top_k: mode === "deep" ? 8 : 10 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function resizeForRecognition(file) {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide <= 1024) return file;
    const scale = 1024 / maxSide;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), "image/jpeg", 0.86));
  } finally {
    bitmap.close();
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
