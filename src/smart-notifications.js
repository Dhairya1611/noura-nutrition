export const DEFAULT_SMART_NOTIFICATION_PREFERENCES = Object.freeze({
  inactivityEnabled: true,
  inactivityDays: 3,
  inactivityTime: "18:30",
  macroEnabled: true,
  macroThreshold: 1
});

const INACTIVITY_DAYS = new Set([2, 3, 7, 14]);
const INACTIVITY_TIMES = new Set(["09:00", "13:00", "18:30", "20:00"]);
const MACRO_THRESHOLDS = new Set([1, 1.1, 1.2]);

export function smartNotificationPreferences(profile = {}) {
  const saved = profile?.notificationPreferences || {};
  const inactivityDays = Number(saved.inactivityDays);
  const macroThreshold = Number(saved.macroThreshold);
  return {
    inactivityEnabled: saved.inactivityEnabled !== false,
    inactivityDays: INACTIVITY_DAYS.has(inactivityDays) ? inactivityDays : DEFAULT_SMART_NOTIFICATION_PREFERENCES.inactivityDays,
    inactivityTime: INACTIVITY_TIMES.has(saved.inactivityTime) ? saved.inactivityTime : DEFAULT_SMART_NOTIFICATION_PREFERENCES.inactivityTime,
    macroEnabled: saved.macroEnabled !== false,
    macroThreshold: MACRO_THRESHOLDS.has(macroThreshold) ? macroThreshold : DEFAULT_SMART_NOTIFICATION_PREFERENCES.macroThreshold
  };
}

export function macroLimitNotification(totals = {}, targets = {}, preferences = DEFAULT_SMART_NOTIFICATION_PREFERENCES) {
  if (!preferences.macroEnabled) return null;
  const threshold = Number(preferences.macroThreshold) || 1;
  const exceeded = [
    ["Fat", "fat", "is", totals.fat, targets.fat],
    ["Carbs", "carbs", "are", totals.carbs, targets.carbs],
    ["Protein", "protein", "is", totals.protein, targets.protein]
  ].filter(([, , , value, target]) => Number(target) > 0 && Number(value) > Number(target) * threshold);
  if (!exceeded.length) return null;
  const details = exceeded.map(([label, , verb, value, target]) => `${label} ${verb} ${formatAmount(Number(value) - Number(target))}g over`).join(" · ");
  return {
    title: "A quick nutrition check",
    body: `${details}. Review today’s log and choose what fits your plan—no guilt, just awareness.`,
    tag: `noura-smart-macro-${new Date().toISOString().slice(0, 10)}`,
    nutrients: exceeded.map(([, nutrient]) => nutrient)
  };
}

function formatAmount(value) {
  return Number(value.toFixed(1)).toLocaleString("en", { maximumFractionDigits: 1 });
}
