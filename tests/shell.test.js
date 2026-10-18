import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("service worker only falls back to the app shell for page navigation", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /new Request\(event\.request, \{ cache: "no-store" \}\)/);
  assert.match(worker, /const cacheKey = isNavigation \? ROOT : event\.request/);
  assert.match(worker, /if \(isNavigation\) return caches\.match\(ROOT\)/);
  assert.match(worker, /status: 503/);
  assert.doesNotMatch(worker, /cached \|\| caches\.match\(ROOT\)/);
});

test("the document remains useful while the application bundle starts", async () => {
  const document = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(document, /Opening Noura/);
  assert.match(document, /Loading your saved nutrition plan/);
  assert.match(document, /%BASE_URL%manifest\.webmanifest/);
  assert.match(document, /%BASE_URL%icon\.svg/);
  assert.match(document, /%BASE_URL%apple-touch-icon\.png/);
});

test("service worker updates bypass the browser HTTP cache", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /updateViaCache: "none"/);
});

test("calorie chart target line uses the same plot area as its bars", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(main, /chartGeometry\(series\.map\(point => point\.value\), target\.calories\)/);
  assert.match(main, /--target-pos:calc\(\$\{geometry\.targetPercent\}% \+ \$\{geometry\.targetOffset\}px\)/);
  assert.match(styles, /bottom: var\(--target-pos\)/);
  assert.doesNotMatch(styles, /bottom: calc\(var\(--target-pos\) \+ 25px\)/);
});

test("manual meal logging visibly repeats and confirms what Noura heard", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /Noura heard you/);
  assert.match(main, /Edit what I said/);
  assert.match(main, /Nothing is logged automatically/);
  assert.match(main, /data-adjust-pending/);
  assert.match(main, /I won’t guess and save the wrong food/);
  assert.match(main, /Compare the photo, description, and serving/);
  assert.match(main, /class="suggestion-preview"/);
  assert.match(main, /data-suggestion-image/);
});

test("manual logging invites a complete meal or day in one message", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /whole day in one message/);
  assert.match(main, /Commas are optional/);
  assert.match(main, /Hindi\/Hinglish/);
  assert.match(main, /2 roti chawal dal/);
  assert.match(main, /food\.mealHint \|\| mealTypeForTime/);
});

test("photo recognition uses a fast first scan with an optional deeper scan", async () => {
  const ai = await readFile(new URL("../src/food-ai.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(ai, /mobilenetv4_conv_small/);
  assert.match(ai, /swin-finetuned-food101/);
  assert.match(ai, /resizeForRecognition/);
  assert.match(main, /Try a deeper dish scan/);
  assert.match(main, /None of these — tell Noura/);
  assert.match(main, /Fast local scanner: about 4–8 MB/);
  assert.doesNotMatch(main, /first scan may take a minute/i);
});

test("service worker displays server push messages when the page is closed", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /registration\.showNotification/);
  assert.match(worker, /notification\.data\?\.url/);
  assert.match(worker, /icon: new URL\("notification-icon\.png"/);
  assert.match(worker, /badge: new URL\("notification-badge\.png"/);
  assert.doesNotMatch(worker, /icon: new URL\("icon\.svg"/);
});

test("the install manifest provides PNG and maskable app icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.ok(manifest.icons.some(icon => icon.src === "icon-192.png" && icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(manifest.icons.some(icon => icon.src === "icon-512.png" && icon.sizes === "512x512" && icon.type === "image/png"));
  assert.ok(manifest.icons.some(icon => icon.src === "icon-maskable-512.png" && icon.purpose === "maskable"));
});

test("notification and install PNG assets are present", async () => {
  const assets = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "notification-icon.png", "notification-badge.png"];
  for (const asset of assets) {
    const bytes = await readFile(new URL(`../public/${asset}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${asset} should be a PNG`);
  }
});

test("meal reminders use the custom accessible time editor", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /class="time-stepper"/);
  assert.match(main, /data-time-period/);
  assert.match(main, /data-action="save-reminder-time"/);
  assert.doesNotMatch(main, /type="time"/);
});

test("repair page clears only Noura shell caches before returning to the app", async () => {
  const repair = await readFile(new URL("../public/repair.html", import.meta.url), "utf8");
  assert.match(repair, /registration\.unregister\(\)/);
  assert.match(repair, /key\.startsWith\("noura-shell-"\)/);
  assert.match(repair, /location\.replace/);
  assert.doesNotMatch(repair, /localStorage\.clear/);
});
