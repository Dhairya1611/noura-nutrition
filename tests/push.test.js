import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applicationServerKeyMatches, pushSubscriptionRecord, urlBase64ToUint8Array } from "../src/push.js";

const migrationUrl = new URL("../supabase/migrations/202610130001_noura_web_push.sql", import.meta.url);
const functionUrl = new URL("../supabase/functions/send-meal-reminders/index.ts", import.meta.url);

test("converts a URL-safe VAPID key into the original bytes", () => {
  const source = Uint8Array.from([1, 2, 3, 250, 251, 252]);
  const encoded = Buffer.from(source).toString("base64url");
  assert.deepEqual(urlBase64ToUint8Array(encoded), source);
  assert.equal(applicationServerKeyMatches({ options: { applicationServerKey: source.buffer } }, encoded), true);
});

test("normalises a browser push subscription for cloud registration", () => {
  const value = pushSubscriptionRecord({
    toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { p256dh: "public-key-material", auth: "auth-secret" } })
  }, "Asia/Kolkata", "Example Browser");
  assert.deepEqual(value, {
    endpoint: "https://push.example/subscription",
    p256dh: "public-key-material",
    auth: "auth-secret",
    timezone: "Asia/Kolkata",
    userAgent: "Example Browser"
  });
});

test("push migration keeps endpoints private and deduplicates scheduled delivery", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /noura_push_subscriptions[\s\S]*enable row level security/i);
  assert.match(sql, /revoke all on table public\.noura_push_subscriptions from anon, authenticated/i);
  assert.match(sql, /unique \(subscription_id, reminder_id, local_date\)/i);
  assert.match(sql, /grant execute on function public\.claim_noura_due_reminders\(\) to service_role/i);
});

test("push sender authenticates cron calls and signed-in server tests", async () => {
  const source = await readFile(functionUrl, "utf8");
  assert.match(source, /x-cron-secret/);
  assert.match(source, /admin\.auth\.getUser\(token\)/);
  assert.match(source, /claim_noura_due_reminders/);
  assert.match(source, /\[404, 410\]/);
});

