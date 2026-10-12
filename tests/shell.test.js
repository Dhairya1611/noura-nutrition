import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("service worker only falls back to the app shell for page navigation", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /event\.request\.mode === "navigate"/);
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
});

test("service worker updates bypass the browser HTTP cache", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /updateViaCache: "none"/);
});
