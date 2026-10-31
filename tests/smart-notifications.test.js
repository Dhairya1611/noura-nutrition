import test from "node:test";
import assert from "node:assert/strict";
import { macroLimitNotification, smartNotificationPreferences } from "../src/smart-notifications.js";

test("smart notification preferences use safe defaults and supported custom values", () => {
  assert.deepEqual(smartNotificationPreferences({}), {
    inactivityEnabled: true,
    inactivityDays: 3,
    inactivityTime: "18:30",
    macroEnabled: true,
    macroThreshold: 1
  });
  assert.deepEqual(smartNotificationPreferences({ notificationPreferences: {
    inactivityEnabled: false,
    inactivityDays: 7,
    inactivityTime: "20:00",
    macroEnabled: true,
    macroThreshold: 1.2
  } }), {
    inactivityEnabled: false,
    inactivityDays: 7,
    inactivityTime: "20:00",
    macroEnabled: true,
    macroThreshold: 1.2
  });
});

test("macro limit alert names every exceeded target and remains calm", () => {
  const alert = macroLimitNotification(
    { protein: 125, carbs: 275, fat: 82 },
    { protein: 100, carbs: 250, fat: 65 },
    { macroEnabled: true, macroThreshold: 1 }
  );
  assert.deepEqual(alert.nutrients, ["fat", "carbs", "protein"]);
  assert.match(alert.body, /Fat is 17g over/);
  assert.match(alert.body, /Carbs are 25g over/);
  assert.match(alert.body, /Protein is 25g over/);
  assert.match(alert.body, /no guilt/i);
});

test("macro limit alert respects the selected threshold and off switch", () => {
  const totals = { protein: 105, carbs: 255, fat: 68 };
  const targets = { protein: 100, carbs: 250, fat: 65 };
  assert.equal(macroLimitNotification(totals, targets, { macroEnabled: true, macroThreshold: 1.1 }), null);
  assert.equal(macroLimitNotification(totals, targets, { macroEnabled: false, macroThreshold: 1 }), null);
});
