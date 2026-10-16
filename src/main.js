import "./styles.css";
import { BODY_TYPES, DEFAULT_REMINDERS, FOOD_LIBRARY, GOALS } from "./data.js";
import {
  calculateDayScore, calculateTargets, chartGeometry, chartSeries, dayKey, findFood, findVisualFood, formatFoodPortion, getStreak,
  adjustReminderTime, formatReminderTime, macroStatus, mealTypeForTime, normaliseLogDate, parseMealText,
  recommendNext, reminderTimeParts, round1, scaleFood, setReminderPeriod, totalsForDate
} from "./logic.js";
import { getNotificationState } from "./notifications.js";
import { applicationServerKeyMatches, currentTimezone, pushIsSupported, pushSubscriptionRecord, urlBase64ToUint8Array } from "./push.js";
import {
  cloudConfigured, createAccount, deleteCloudState, fetchCloudState, getCloudSession,
  onCloudAuthChange, registerPushSubscription, requestPasswordReset, saveCloudState, sendPushTest,
  signIn, signInWithGoogle, signOut, unregisterPushSubscription, updatePassword
} from "./cloud.js";

const STORAGE_KEY = "noura-state-v1";
const app = document.querySelector("#app");
const assetUrl = path => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, "")}`;
const authPreview = import.meta.env.DEV && new URLSearchParams(location.search).has("auth-preview");
const vapidPublicKey = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || "").trim();
const serverPushConfigured = Boolean(vapidPublicKey && cloudConfigured);

const defaults = {
  profile: null,
  logs: [],
  reminders: DEFAULT_REMINDERS,
  route: "today",
  period: "week",
  onboardingStep: 1,
  onboarding: { bodyType: "balanced", goal: "maintain", name: "", basis: "female", age: 28, height: 168, weight: 68, activity: 1.375, diet: "everything" },
  scanMode: "photo",
  scanStatus: null,
  scanResults: [],
  photoPreviewUrl: null,
  photoScanDepth: "fast",
  photoElapsedMs: null,
  photoAiReady: false,
  pendingFoods: [],
  foodLookupToken: null,
  mealDraft: "",
  mealConversation: null,
  reminderEditor: null,
  insightSelectionKey: null,
  auth: { status: authPreview ? "anonymous" : cloudConfigured ? "loading" : "unconfigured", mode: "signin", message: "", kind: "", recovery: false },
  sync: { status: "offline", message: "Not signed in" },
  push: { status: "idle", message: "" },
  toast: null
};

let state = loadState();
let toastTimer;
let syncTimer;
let currentUser = null;
let authSubscription = null;
let hydrationToken = 0;
let lastPhotoFile = null;
let foodAiWarmStarted = false;
let photoScanToken = 0;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { ...structuredClone(defaults), ...saved, route: "today", scanStatus: null, scanResults: [], photoPreviewUrl: null, photoScanDepth: "fast", photoElapsedMs: null, photoAiReady: false, pendingFoods: [], foodLookupToken: null, mealDraft: "", mealConversation: null, reminderEditor: null, auth: structuredClone(defaults.auth), sync: structuredClone(defaults.sync), push: structuredClone(defaults.push), toast: null };
  } catch {
    return structuredClone(defaults);
  }
}

function persist({ sync = true } = {}) {
  const { profile, logs, reminders } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile, logs, reminders }));
  if (sync && currentUser) scheduleCloudSave();
}

function targets() {
  return state.profile?.targets || calculateTargets(state.profile || state.onboarding);
}

function todayTotals() {
  return totalsForDate(state.logs, new Date());
}

function render() {
  let shell;
  if (state.auth.status === "loading") shell = renderAuthLoading();
  else if (state.auth.status === "unconfigured") shell = renderCloudSetupRequired();
  else if (state.auth.status !== "authenticated") shell = renderAuth();
  else shell = state.profile ? renderAppShell() : renderOnboarding();
  app.innerHTML = shell + (state.toast ? `<div class="toast ${state.toast.kind || ""}" role="status">${icon("check", 18)}<span>${escapeHtml(state.toast.message)}</span></div>` : "");
  wireAfterRender();
}

function renderAuthLoading() {
  return `<div class="auth-shell auth-loading"><header>${brand()}<span>Secure account sync</span></header><main><div class="auth-loader">${icon("leaf", 26)}</div><h1>Opening your Noura account…</h1><p>Checking for your saved profile and meal history.</p></main></div>`;
}

function renderCloudSetupRequired() {
  return `<div class="auth-shell"><header>${brand()}<span>Secure account sync</span></header><main class="auth-layout"><section class="auth-story"><span class="eyebrow light">Noura Cloud</span><h1>Your nutrition history, wherever you sign in.</h1><p>The app is ready for account-based storage, but its cloud connection still needs to be configured before users can create accounts.</p><div class="auth-benefits"><span>${icon("shield", 20)} Private records protected per user</span><span>${icon("pulse", 20)} Meals and progress restored on every device</span><span>${icon("spark", 20)} Existing local history migrates after login</span></div></section><article class="auth-card"><span class="eyebrow">Setup in progress</span><h2>Noura Cloud is not connected yet.</h2><p>Add the Supabase project URL and publishable key to the deployment environment, then rebuild the app.</p></article></main></div>`;
}

function renderAuth() {
  if (state.auth.recovery) return renderPasswordRecovery();
  const signup = state.auth.mode === "signup";
  const working = state.auth.kind === "working";
  return `<div class="auth-shell"><header>${brand()}<span>Secure account sync</span></header><main class="auth-layout"><section class="auth-story"><span class="eyebrow light">Your plan follows you</span><h1>Eat with intention, on every device.</h1><p>Sign in to keep your profile, meal history, streaks, reminders, and progress safely attached to your account.</p><div class="auth-benefits"><span>${icon("shield", 20)} Only you can read your nutrition data</span><span>${icon("pulse", 20)} Automatic cloud backup after every change</span><span>${icon("spark", 20)} Existing browser data migrates on first login</span></div></section><article class="auth-card"><div class="auth-tabs"><button class="${signup ? "" : "active"}" data-auth-mode="signin">Sign in</button><button class="${signup ? "active" : ""}" data-auth-mode="signup">Create account</button></div><span class="eyebrow">${signup ? "Start your account" : "Welcome back"}</span><h2>${signup ? "Keep your progress for good." : "Continue your Noura journey."}</h2><p>${signup ? "Create an account with Google or use an email address you can access." : "Your saved plan and meals will load after you sign in."}</p>${state.auth.message ? `<div class="auth-message ${state.auth.kind || ""}" role="status">${escapeHtml(state.auth.message)}</div>` : ""}<button class="google-auth-button" data-action="google-auth" ${working ? "disabled" : ""}>${googleMark()}<span>Continue with Google</span></button><div class="auth-divider"><span>or use email</span></div><form id="auth-form"><label>Email address<input type="email" name="email" autocomplete="email" placeholder="you@example.com" required></label><label>Password<input type="password" name="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" placeholder="At least 6 characters" required></label><button class="continue-button" ${working ? "disabled" : ""}>${signup ? "Create my account" : "Sign in"} ${icon("arrow", 18)}</button></form>${signup ? "" : `<button class="forgot-button" data-action="forgot-password">Forgot password?</button>`}<p class="auth-privacy">Google shares your name, email address, and profile image for sign-in. Your Noura profile and nutrition history are stored in your private cloud account. Food photos still stay on your device. <a href="${assetUrl("privacy.html")}" target="_blank" rel="noopener">Privacy</a> · <a href="${assetUrl("terms.html")}" target="_blank" rel="noopener">Terms</a></p></article></main></div>`;
}

function renderPasswordRecovery() {
  return `<div class="auth-shell"><header>${brand()}<span>Secure account sync</span></header><main class="auth-layout"><section class="auth-story"><span class="eyebrow light">Account recovery</span><h1>Choose a new password.</h1><p>Once saved, your profile and meal history will remain attached to the same account.</p></section><article class="auth-card"><span class="eyebrow">Reset password</span><h2>Secure your Noura account.</h2>${state.auth.message ? `<div class="auth-message ${state.auth.kind || ""}" role="status">${escapeHtml(state.auth.message)}</div>` : ""}<form id="recovery-form"><label>New password<input type="password" name="password" autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required></label><button class="continue-button">Save new password ${icon("check", 18)}</button></form></article></main></div>`;
}

function renderAppShell() {
  const nav = [
    ["today", "home", "Today"], ["scan", "scan", "Scan"], ["insights", "chart", "Insights"],
    ["coach", "spark", "Coach"], ["profile", "user", "Profile"]
  ];
  return `
    <div class="app-shell">
      <aside class="sidebar">
        ${brand()}
        <nav aria-label="Main navigation">
          ${nav.map(([route, glyph, label]) => navButton(route, glyph, label)).join("")}
        </nav>
        <div class="sidebar-coach">
          <span class="eyebrow">Noura coach</span>
          <strong>${getCoachNudge()}</strong>
          <button class="text-button" data-route="coach">See my next meal ${icon("arrow", 15)}</button>
        </div>
        <p class="privacy-note">${icon("shield", 14)} Your data syncs securely to your account.</p>
      </aside>
      <div class="app-frame">
        <header class="topbar">
          <button class="mobile-brand" data-route="today" aria-label="Go home">${brand(true)}</button>
          <div class="topbar-date">${formatDate(new Date())}</div>
          <div class="topbar-actions">
            <button class="icon-button" data-action="enable-notifications" aria-label="Meal reminders">${icon("bell", 20)}<span class="notification-dot ${notificationContext().pushStatus === "connected" ? "enabled" : ""}"></span></button>
            <button class="avatar" data-route="profile" aria-label="Profile">${initials(state.profile.name || "You")}</button>
          </div>
        </header>
        <main class="main-content">${renderRoute()}</main>
        <nav class="bottom-nav" aria-label="Mobile navigation">
          ${nav.slice(0, 4).map(([route, glyph, label]) => navButton(route, glyph, label, true)).join("")}
          ${navButton("profile", "user", "You", true)}
        </nav>
      </div>
    </div>`;
}

function renderRoute() {
  if (state.route === "scan") return renderScan();
  if (state.route === "insights") return renderInsights();
  if (state.route === "coach") return renderCoach();
  if (state.route === "profile") return renderProfile();
  return renderToday();
}

function renderToday() {
  const totals = todayTotals();
  const target = targets();
  const remaining = Math.max(0, target.calories - totals.kcal);
  const caloriePercent = Math.min(100, Math.round((totals.kcal / target.calories) * 100));
  const score = calculateDayScore(totals, target);
  const streak = getStreak(state.logs);
  const recommendations = recommendNext(totals, target, state.profile, 1);
  const todayLogs = state.logs.filter(log => dayKey(normaliseLogDate(log.at)) === dayKey());
  return `
    <section class="page today-page">
      <div class="page-heading welcome-heading">
        <div>
          <span class="eyebrow">Good ${dayPart()}</span>
          <h1>${state.profile.name ? `Hey, ${escapeHtml(state.profile.name.split(" ")[0])}.` : "Your day, at a glance."}</h1>
          <p>${todayLogs.length ? "You’re building a clear picture, one meal at a time." : "Start by logging your first meal—photo or words both work."}</p>
        </div>
        <div class="streak-pill">🔥 <strong>${streak.current}</strong> day streak</div>
      </div>

      <div class="dashboard-grid">
        <article class="card calorie-card">
          <div class="card-title-row"><span class="eyebrow light">Daily energy</span><span class="score-chip">${score || "—"} score</span></div>
          <div class="calorie-main">
            <div class="calorie-ring" style="--progress:${caloriePercent * 3.6}deg">
              <div><strong>${Math.round(totals.kcal).toLocaleString()}</strong><span>of ${target.calories.toLocaleString()} kcal</span></div>
            </div>
            <div class="energy-copy"><strong>${remaining.toLocaleString()}</strong><span>kcal left today</span><p>${energyMessage(caloriePercent, totals.kcal)}</p></div>
          </div>
          <div class="macro-row">
            ${macroMeter("Protein", totals.protein, target.protein, "#c9f36a")}
            ${macroMeter("Carbs", totals.carbs, target.carbs, "#8fd7ff")}
            ${macroMeter("Fat", totals.fat, target.fat, "#ffb777")}
          </div>
        </article>

        <article class="card log-card">
          <div><span class="eyebrow">Log a meal</span><h2>Before the first bite.</h2><p>Snap it, scan the pack, or simply tell Noura what you ate.</p></div>
          <div class="log-actions">
            <button class="primary-action" data-route="scan">${icon("scan", 22)}<span>Scan food<small>Use your camera</small></span>${icon("arrow", 18)}</button>
            <button class="secondary-action" data-action="manual-focus">${icon("type", 21)}<span>Tell what you ate<small>“2 eggs and a banana”</small></span>${icon("arrow", 18)}</button>
          </div>
        </article>

        <article class="card coach-card">
          <div class="card-title-row"><div><span class="eyebrow">Eat next</span><h2>${recommendations[0]?.name || "Build a balanced plate"}</h2></div><span class="coach-orb">${recommendations[0]?.emoji || "✦"}</span></div>
          <p>${recommendations[0]?.reason || "Log a meal and I’ll use your remaining calories and macros to adapt."}</p>
          ${recommendations[0] ? `<div class="coach-macros"><span>${recommendations[0].kcal} kcal</span><span>${recommendations[0].protein}g protein</span><span>${recommendations[0].fiber}g fiber</span></div>` : ""}
          <button class="outline-button" data-route="coach">View full recommendation ${icon("arrow", 16)}</button>
        </article>

        <article class="card meals-card">
          <div class="card-title-row"><div><span class="eyebrow">Today’s log</span><h2>${todayLogs.length} ${todayLogs.length === 1 ? "item" : "items"}</h2></div><button class="compact-button" data-route="scan">+ Add food</button></div>
          <div class="meal-list">${todayLogs.length ? todayLogs.slice().reverse().map(renderMealRow).join("") : emptyMeals()}</div>
        </article>
      </div>
    </section>`;
}

function renderScan() {
  const modes = [["photo", "scan", "Food photo"], ["barcode", "barcode", "Barcode"], ["manual", "type", "Tell Noura"]];
  return `
    <section class="page scan-page">
      <div class="page-heading"><div><span class="eyebrow">Smart log</span><h1>What are you having?</h1><p>Recognition happens on your device. You always confirm the food and portion before it is logged.</p></div></div>
      <div class="scan-layout">
        <article class="card scan-card">
          <div class="segmented-control">${modes.map(([mode, glyph, label]) => `<button class="${state.scanMode === mode ? "active" : ""}" data-scan-mode="${mode}">${icon(glyph, 18)}${label}</button>`).join("")}</div>
          ${renderScanMode()}
        </article>
        ${renderScanGuide()}
      </div>
    </section>`;
}

function renderScanGuide() {
  if (state.scanMode === "manual") {
    return `<aside class="card listening-guide">
      <span class="eyebrow">You stay in control</span>
      <h2>Noura listens, then checks.</h2>
      <div class="listening-steps">
        <div><span>1</span><p><strong>Say it your way</strong>Include portions, preparation, or extras when you know them.</p></div>
        <div><span>2</span><p><strong>See what I heard</strong>I repeat the meal back and flag anything uncertain.</p></div>
        <div><span>3</span><p><strong>Confirm before saving</strong>Adjust servings or correct a match. Nothing is logged automatically.</p></div>
      </div>
      <div class="trust-row">${icon("shield", 20)}<span><strong>Your words remain yours</strong>Noura uses them only to prepare this meal estimate.</span></div>
    </aside>`;
  }
  return `<aside class="card estimate-card">
    <span class="eyebrow">A better estimate</span>
    <h2>Portion is everything.</h2>
    <div class="tip-visual"><div>½</div><div class="active">1×</div><div>1½</div></div>
    <p>A photo can identify a dish, not weigh it. Confirm the serving size for a more useful calorie estimate.</p>
    <div class="trust-row">${icon("shield", 20)}<span><strong>Private by design</strong>Your photo is processed locally and is not uploaded to Noura.</span></div>
  </aside>`;
}

function renderScanMode() {
  if (state.scanMode === "barcode") {
    return `<div class="scanner-zone">
      <div class="scanner-illustration barcode-illustration">${icon("barcode", 62)}<span></span></div>
      <h2>Scan a packaged item</h2><p>Photograph the barcode, or enter the digits below.</p>
      <label class="upload-button">${icon("camera", 19)} Take barcode photo<input id="barcode-photo" type="file" accept="image/*" capture="environment" hidden></label>
      <div class="or-divider"><span>or enter code</span></div>
      <form id="barcode-form" class="inline-form"><input name="barcode" inputmode="numeric" autocomplete="off" placeholder="e.g. 3017624010701" required><button>Look up</button></form>
      ${renderScanStatus()}
    </div>`;
  }
  if (state.scanMode === "manual") {
    return `<div class="manual-zone">
      <div class="manual-heading"><span class="manual-spark">✦</span><div><h2>Tell me in your own words</h2><p>I’ll repeat what I understood before anything is added.</p></div></div>
      <form id="manual-form">
        <label for="meal-text">Write it the way you would say it</label>
        <textarea id="meal-text" name="meal" rows="4" placeholder="For example: “2 roti petha sabzi curd”" required>${escapeHtml(state.mealDraft)}</textarea>
        <p class="input-help">Write one food, a whole meal, or your whole day in one message. Commas are optional; breakfast, lunch, dinner, and quantities are understood.</p>
        <div class="examples"><span>Try:</span><button type="button" data-example="2 eggs banana toast">2 eggs banana toast</button><button type="button" data-example="Breakfast 2 eggs; lunch 2 roti petha sabzi curd; dinner dal rice">my whole day</button></div>
        <button class="big-submit">Tell me what you heard ${icon("spark", 19)}</button>
      </form>
      ${renderMealConversation()}
      ${renderScanStatus()}
      ${renderPendingFoods()}
    </div>`;
  }
  return `<div class="scanner-zone photo-zone">
    ${state.photoPreviewUrl ? `<div class="photo-preview"><img src="${state.photoPreviewUrl}" alt="Food selected for recognition"><span>${icon("scan", 22)}</span></div>` : `<div class="scanner-illustration food-illustration"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span><div>🥗</div></div>`}
    <h2>${state.photoPreviewUrl ? "Checking what’s on the plate" : "Point. Snap. Confirm."}</h2>
    <p>${state.photoPreviewUrl ? "Noura checks several possibilities and never adds one without your confirmation." : "The fast scanner warms up while you frame the photo, then checks common foods in a few seconds."}</p>
    <label class="upload-button">${icon("camera", 19)} ${state.photoPreviewUrl ? "Try another photo" : "Take or choose photo"}<input id="food-photo" type="file" accept="image/*" capture="environment" hidden></label>
    <span class="supported-note ${state.photoAiReady ? "ready" : ""}">${state.photoAiReady ? "● Fast local scanner ready" : "Fast local scanner: about 4–8 MB · warming up in the background"}</span>
    <div class="photo-tips"><span>${icon("check", 14)} One dish per photo</span><span>${icon("check", 14)} Bright, close, and unobstructed</span></div>
    ${renderScanStatus()}
    ${renderScanResults()}
  </div>`;
}

function renderMealConversation() {
  if (!state.mealConversation) return "";
  const known = state.pendingFoods.filter(item => !item.unknown);
  const unknown = state.pendingFoods.filter(item => item.unknown);
  const totalKcal = known.reduce((sum, item) => sum + item.kcal, 0);
  const phase = state.mealConversation.phase;
  const title = phase === "searching"
    ? `I heard ${known.length ? `${known.length} ${known.length === 1 ? "item" : "items"} clearly` : "you"}. I’m checking the rest.`
    : unknown.length
      ? "I understood part of that—and I need one detail."
      : known.length
        ? `I heard ${known.length} ${known.length === 1 ? "item" : "items"}, about ${totalKcal} kcal.`
        : "I’m listening—tell me what I missed.";
  const detail = phase === "searching"
    ? "I’m looking for the closest reliable matches now."
    : unknown.length
      ? "Choose the closest match below or enter your own details. I won’t guess and save the wrong food."
      : "Check the portions below. You can adjust them before anything is saved.";
  return `<section class="listening-conversation ${unknown.length ? "needs-help" : ""}" aria-live="polite">
    <div class="speech-row user-speech"><span>You said</span><p>“${escapeHtml(state.mealConversation.message)}”</p></div>
    <div class="speech-row noura-speech"><span class="noura-listening-mark">${icon("spark", 17)}</span><div><span>Noura heard you</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p>
      <div class="heard-items">${known.map(food => `<span class="heard"><b>✓</b>${escapeHtml(food.name)}</span>`).join("")}${unknown.map(food => `<span class="uncertain"><b>?</b>${escapeHtml(cleanCustomFoodName(food.name))}</span>`).join("")}</div>
      <button type="button" class="edit-message" data-action="edit-meal-message">${icon("type", 14)} Edit what I said</button>
    </div></div>
  </section>`;
}

function renderScanStatus() {
  if (!state.scanStatus) return "";
  return `<div class="scan-status ${state.scanStatus.kind || ""}"><span class="status-spinner"></span><div><strong>${escapeHtml(state.scanStatus.title)}</strong><span>${escapeHtml(state.scanStatus.detail || "")}</span></div>${state.scanStatus.progress != null ? `<div class="status-progress"><i style="width:${state.scanStatus.progress}%"></i></div>` : ""}</div>`;
}

function renderScanResults() {
  if (!state.scanResults.length) return "";
  const elapsed = state.photoElapsedMs ? ` · ${formatScanTime(state.photoElapsedMs)}` : "";
  return `<div class="result-panel photo-results"><span class="eyebrow">${state.photoScanDepth === "deep" ? "Deeper scan" : "Fast scan"}${elapsed}</span><p>These are possibilities, not certainties. Tap the closest one to confirm its portion.</p>${state.scanResults.map((result, index) => `<button data-scan-result="${index}"><span>${result.food?.emoji || "🍽️"}</span><div><strong>${escapeHtml(result.food?.name || result.display)}</strong><small>${visualConfidence(result.score)}${result.food ? ` · ${result.food.kcal} kcal/serving` : " · describe it to Noura"}</small></div>${icon("arrow", 16)}</button>`).join("")}
    <div class="photo-result-actions">${state.photoScanDepth !== "deep" ? `<button type="button" class="outline-button" data-action="deep-photo-scan">${icon("spark", 16)} Try a deeper dish scan</button>` : ""}<button type="button" class="outline-button" data-action="manual-photo-correction">${icon("type", 16)} None of these — tell Noura</button></div>
    <small class="scan-honesty">Mixed plates and regional dishes can look alike. Noura asks instead of logging a weak guess.</small>
  </div>`;
}

function renderPendingFoods() {
  if (!state.pendingFoods.length) return "";
  const indexed = state.pendingFoods.map((item, index) => ({ item, index }));
  const known = indexed.filter(({ item }) => !item.unknown);
  const unknown = indexed.filter(({ item }) => item.unknown);
  return `<div class="pending-panel">
    <div class="card-title-row"><div><span class="eyebrow">Meal estimate</span><h3>${known.length} ${known.length === 1 ? "item" : "items"} ready</h3></div><strong>${known.reduce((sum, { item }) => sum + item.kcal, 0)} kcal</strong></div>
    ${known.map(({ item: food, index }) => `<div class="pending-row"><span>${food.emoji}</span><div class="pending-info"><strong>${escapeHtml(food.name)}</strong><div class="portion-editor" aria-label="Adjust ${escapeHtml(food.name)} servings"><button type="button" data-adjust-pending="${index}:-1" aria-label="Decrease ${escapeHtml(food.name)} portion" ${Number(food.servings || 1) <= 1 ? "disabled" : ""}>−</button><span>${escapeHtml(formatFoodPortion(food))}</span><button type="button" data-adjust-pending="${index}:1" aria-label="Increase ${escapeHtml(food.name)} portion">+</button></div>${food.mealHint ? `<small>${escapeHtml(food.mealHint)} · recognised from your message</small>` : food.source ? `<small>${escapeHtml(food.source)}</small>` : ""}</div><span class="pending-kcal">${food.kcal} kcal</span><button type="button" class="remove-pending" data-remove-pending="${index}" aria-label="Remove ${escapeHtml(food.name)}">×</button></div>`).join("")}
    ${unknown.map(({ item, index }) => renderUnmatchedFood(item, index)).join("")}
    ${known.length && !unknown.length ? `<button class="big-submit" data-action="log-pending">Add meal to today ${icon("check", 18)}</button>` : ""}
  </div>`;
}

function renderUnmatchedFood(item, index) {
  const suggestions = item.suggestions || [];
  return `<section class="unmatched-food">
    <div class="unmatched-title"><div><span class="eyebrow">Help me understand</span><h4>What did you mean by “${escapeHtml(item.name)}”?</h4></div><button type="button" data-remove-pending="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>
    ${item.searching ? `<p class="unknown-note listening">I heard it. I’m searching USDA FoodData Central and Open Food Facts for the closest match…</p>` : suggestions.length ? `<p class="lookup-help">Compare the photo, description, and serving. On a computer, hover or focus a photo to enlarge it.</p><div class="database-suggestions">${suggestions.map((food, suggestionIndex) => renderDatabaseSuggestion(food, index, suggestionIndex)).join("")}</div>` : `<p class="unknown-note">${item.lookupError ? escapeHtml(item.lookupError) : "I couldn’t find a reliable match."} Add the label or your best estimate below so I don’t record the wrong food.</p>`}
    <details class="custom-food-entry" ${suggestions.length ? "" : "open"}>
      <summary>Enter nutrition manually</summary>
      <form data-custom-food="${index}">
        <label>Food name<input name="name" value="${escapeHtml(cleanCustomFoodName(item.name))}" required maxlength="80"></label>
        <label>Serving<input name="serving" value="1 serving" required maxlength="40"></label>
        <div class="nutrition-fields">
          <label>Calories<input name="kcal" type="number" min="0" max="10000" step="1" required placeholder="kcal"></label>
          <label>Protein<input name="protein" type="number" min="0" max="1000" step="0.1" placeholder="g"></label>
          <label>Carbs<input name="carbs" type="number" min="0" max="1000" step="0.1" placeholder="g"></label>
          <label>Fat<input name="fat" type="number" min="0" max="1000" step="0.1" placeholder="g"></label>
          <label>Fiber<input name="fiber" type="number" min="0" max="1000" step="0.1" placeholder="g"></label>
        </div>
        <button>Add this food</button>
      </form>
    </details>
  </section>`;
}

function renderDatabaseSuggestion(food, itemIndex, suggestionIndex) {
  const image = food.image ? escapeHtml(food.image) : "";
  const descriptionId = `food-suggestion-${itemIndex}-${suggestionIndex}`;
  const description = food.description || `${food.name} from ${food.brand}. Nutrition is listed for ${food.serving}.`;
  const media = `<span class="suggestion-media ${image ? "has-image" : "no-image"}"><span class="suggestion-fallback" aria-hidden="true">${food.emoji || "🍽️"}</span>${image ? `<img src="${image}" alt="${escapeHtml(food.name)}" loading="lazy" referrerpolicy="no-referrer" data-suggestion-image>` : ""}</span>`;
  const preview = image ? `<span class="suggestion-preview" aria-hidden="true"><img src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer"><span><strong>${escapeHtml(food.name)}</strong><small>${escapeHtml(description)}</small></span></span>` : "";
  return `<button type="button" class="database-suggestion" data-use-database-food="${itemIndex}:${suggestionIndex}" aria-describedby="${descriptionId}">${media}<span class="suggestion-copy"><strong>${escapeHtml(food.name)}</strong><small>${escapeHtml(food.brand)} · ${escapeHtml(food.serving)} · ${food.kcal} kcal</small><span class="suggestion-description" id="${descriptionId}">${escapeHtml(description)}</span></span><span class="suggestion-action">Use this</span>${preview}</button>`;
}

function renderInsights() {
  const target = targets();
  const series = chartSeries(state.logs, state.period, target);
  const activeValues = series.filter(point => point.value > 0);
  const selectedPoint = series.find(point => point.key === state.insightSelectionKey) || activeValues.at(-1) || series.at(-1);
  const average = activeValues.length ? Math.round(activeValues.reduce((sum, point) => sum + point.value, 0) / activeValues.length) : 0;
  const geometry = chartGeometry(series.map(point => point.value), target.calories);
  const streak = getStreak(state.logs);
  const onTarget = activeValues.filter(point => point.value >= target.calories * 0.85 && point.value <= target.calories * 1.1).length;
  const historyMetrics = selectedPoint ? [
    ["Calories", selectedPoint.totals.kcal.toLocaleString(), "kcal", "energy"],
    ["Protein", formatNutrient(selectedPoint.totals.protein), "g", "protein"],
    ["Carbs", formatNutrient(selectedPoint.totals.carbs), "g", "carbs"],
    ["Fat", formatNutrient(selectedPoint.totals.fat), "g", "fat"],
    ["Fiber", formatNutrient(selectedPoint.totals.fiber), "g", "fiber"]
  ] : [];
  return `<section class="page insights-page">
    <div class="page-heading"><div><span class="eyebrow">Your patterns</span><h1>Progress, without the pressure.</h1><p>Look beyond a single meal. Consistency over time is what counts.</p></div><div class="segmented-control period-control">${["week", "month", "year"].map(period => `<button class="${state.period === period ? "active" : ""}" data-period="${period}">${period[0].toUpperCase() + period.slice(1)}</button>`).join("")}</div></div>
    <div class="insight-stats">
      ${statCard("Average", average ? `${average.toLocaleString()} kcal` : "—", average ? `${average - target.calories > 0 ? "+" : ""}${average - target.calories} vs target` : "Start logging to see this", "pulse")}
      ${statCard("On-target days", `${onTarget}/${activeValues.length || series.length}`, "Within 85–110% of goal", "target")}
      ${statCard("Current streak", `${streak.current} days`, `Personal best: ${streak.best}`, "flame")}
    </div>
    <article class="card chart-card">
      <div class="card-title-row"><div><span class="eyebrow">Calories</span><h2>${state.period === "week" ? "Last 7 days" : state.period === "month" ? "Last 30 days" : "12-month average"}</h2></div><div class="chart-legend"><i></i>Your intake <span></span>Target</div></div>
      <div class="bar-chart" style="--target-pos:calc(${geometry.targetPercent}% + ${geometry.targetOffset}px)">
        <div class="target-line"><span>${target.calories}</span></div>
        ${series.map(point => {
          const selected = selectedPoint?.key === point.key;
          const tooltip = `${point.fullLabel}: ${point.value.toLocaleString()} kcal, ${formatNutrient(point.totals.protein)}g protein, ${formatNutrient(point.totals.fat)}g fat`;
          return `<button type="button" class="bar-column ${selected ? "selected" : ""}" data-insight-key="${escapeHtml(point.key)}" aria-pressed="${selected}" aria-label="${escapeHtml(tooltip)}. Select for full details." title="${escapeHtml(tooltip)}"><span class="bar-tooltip" aria-hidden="true"><strong>${escapeHtml(point.fullLabel)}</strong><span>${point.value.toLocaleString()} kcal</span><small>${formatNutrient(point.totals.protein)}g protein · ${formatNutrient(point.totals.fat)}g fat</small></span><span class="bar-track"><i style="height:${geometry.heightPercent(point.value)}%"></i></span><span class="bar-label">${point.label}</span></button>`;
        }).join("")}
      </div>
      ${!activeValues.length ? `<div class="chart-empty">Your chart will come alive as you log meals.</div>` : ""}
      ${selectedPoint ? `<section class="history-detail" aria-live="polite"><div class="history-detail-heading"><div><span class="eyebrow">${state.period === "year" ? "Daily average" : "Selected day"}</span><h3>${escapeHtml(selectedPoint.fullLabel)}</h3></div><p>${selectedPoint.logCount ? state.period === "year" ? `${selectedPoint.loggedDays} logged ${selectedPoint.loggedDays === 1 ? "day" : "days"} · ${selectedPoint.logCount} ${selectedPoint.logCount === 1 ? "entry" : "entries"}` : `${selectedPoint.logCount} ${selectedPoint.logCount === 1 ? "item" : "items"} logged` : "No food logged"}</p></div><div class="history-metrics">${historyMetrics.map(([label, value, unit, kind]) => `<div class="history-metric ${kind}"><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`).join("")}</div>${!selectedPoint.logCount ? `<p class="history-empty-note">Nothing was recorded for this ${state.period === "year" ? "month" : "day"}. Select another bar to review its nutrition.</p>` : ""}</section>` : ""}
    </article>
    <article class="card insight-callout"><span class="insight-icon">${icon("spark", 24)}</span><div><span class="eyebrow">Noura noticed</span><h3>${getInsight(activeValues, average, target)}</h3><p>Estimates are for awareness, not medical diagnosis. Focus on the direction, not perfect numbers.</p></div></article>
  </section>`;
}

function renderCoach() {
  const total = todayTotals();
  const target = targets();
  const recommendations = recommendNext(total, target, state.profile);
  const remaining = { kcal: Math.max(0, target.calories - total.kcal), protein: Math.max(0, target.protein - total.protein), fiber: Math.max(0, target.fiber - total.fiber) };
  return `<section class="page coach-page">
    <div class="coach-hero">
      <div><span class="eyebrow light">Adaptive nutrition coach</span><h1>Here’s what your body could use next.</h1><p>Based on what you’ve logged—not a rigid meal plan.</p></div>
      <div class="coach-remaining"><span>Remaining today</span><strong>${Math.round(remaining.kcal)} <small>kcal</small></strong><div><i style="width:${Math.min(100, remaining.protein / target.protein * 100)}%"></i></div><p>${Math.round(remaining.protein)}g protein · ${Math.round(remaining.fiber)}g fiber to go</p></div>
    </div>
    <div class="coach-list-heading">
      <div><span class="eyebrow">Flexible choices</span><h2>${recommendations.length ? `${recommendations.length} suggestions for what to eat next` : "You’re on track for today"}</h2></div>
      ${recommendations.length ? `<p>Pick the option that fits your appetite and routine.</p>` : ""}
    </div>
    <div class="recommendation-grid">
      ${recommendations.length ? recommendations.map((food, index) => recommendationCard(food, index)).join("") : `<article class="card all-done"><span>✓</span><h2>You’ve met today’s energy goal.</h2><p>If you’re genuinely hungry, choose something light and satisfying rather than chasing the numbers.</p></article>`}
    </div>
    <div class="coach-principles">
      <div><span>01</span><strong>Close the biggest gap</strong><p>Protein and fiber needs are weighted before calories.</p></div>
      <div><span>02</span><strong>Respect your preference</strong><p>Suggestions follow your selected diet.</p></div>
      <div><span>03</span><strong>You make the call</strong><p>These are practical options, never medical prescriptions.</p></div>
    </div>
  </section>`;
}

function renderProfile() {
  const target = targets();
  const notification = getNotificationState(notificationContext());
  const goal = GOALS.find(item => item.id === state.profile.goal);
  const body = BODY_TYPES.find(item => item.id === state.profile.bodyType);
  const dietCopy = state.profile.diet === "vegan"
    ? "Only plant-based foods will appear in Coach suggestions."
    : state.profile.diet === "vegetarian"
      ? "Only vegetarian foods will appear; eggs, meat, and fish are excluded."
      : "Coach can suggest vegetarian, vegan, egg, meat, and fish options.";
  return `<section class="page profile-page">
    <div class="page-heading"><div><span class="eyebrow">Your settings</span><h1>Built around you.</h1><p>Adjust your goal, diet, targets, and meal reminders any time.</p></div></div>
    <div class="profile-grid">
      <article class="card profile-summary">
        <div class="large-avatar">${initials(state.profile.name || "You")}</div>
        <h2>${escapeHtml(state.profile.name || "Your profile")}</h2><p>${body?.name || "Balanced frame"} · ${goal?.name || "Maintain"}</p>
        <div class="profile-metrics"><span><strong>${state.profile.weight}</strong>kg</span><span><strong>${state.profile.height}</strong>cm</span><span><strong>${target.calories}</strong>kcal</span></div>
        <div class="account-sync"><i class="${state.sync.status}"></i><span><strong>${syncLabel()}</strong>${escapeHtml(currentUser?.email || "Signed-in account")}</span></div>
        <div class="profile-actions"><button class="outline-button" data-action="restart-onboarding">Edit my plan</button><button class="logout-button" data-action="logout">${icon("logout", 16)} Log out</button></div>
        <p class="local-session-note">Logging out clears this device’s cache. Your saved profile, meals, streaks, and reminders remain in your account.</p>
      </article>
      <article class="card settings-card">
        <div class="card-title-row"><div><span class="eyebrow">Meal reminders</span><h2>A gentle nudge, before you eat.</h2></div><span class="permission-badge ${notification.code}">${notification.label}</span></div>
        <p>Noura Push uses your device’s timezone to send meal reminders at the times below—even after the app or browser is closed.</p>
        <div class="notification-guidance ${notification.code}" role="status">${icon(notification.code === "granted" ? "check" : "bell", 19)}<div><strong>${notification.title}</strong><span>${notification.message}</span></div></div>
        <div class="reminder-list">${state.reminders.map(renderReminderEditor).join("")}</div>
        <button class="compact-button" data-action="enable-notifications" ${state.push.status === "connecting" ? "disabled" : ""}>${icon("bell", 16)} ${notification.action}</button>
      </article>
      <article class="card diet-card">
        <span class="eyebrow">Food preference</span><h2>What works for you?</h2>
        <div class="choice-chips">${[["everything", "Non-vegetarian"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"]].map(([value, label]) => `<button class="${state.profile.diet === value ? "active" : ""}" data-diet="${value}">${label}</button>`).join("")}</div>
        <p><strong>${dietCopy}</strong> This filters Coach recommendations only; manual food search remains complete.</p>
      </article>
      <article class="card privacy-card">
        <div class="privacy-mark">${icon("shield", 27)}</div><div><span class="eyebrow">Account privacy</span><h2>Your meals stay yours.</h2><p>Your profile, logs, reminders, and this device’s encrypted push endpoint are stored in your private account. Row-level security limits access to the signed-in user. Food photos are still processed on-device.</p><button class="danger-link" data-action="reset-data">Delete my nutrition data</button></div>
      </article>
    </div>
  </section>`;
}

function renderReminderEditor(reminder) {
  const isEditing = state.reminderEditor?.id === reminder.id;
  const draftTime = isEditing ? state.reminderEditor.time : reminder.time;
  const parts = reminderTimeParts(draftTime);
  const marks = { breakfast: "☀", lunch: "◐", dinner: "☾" };
  return `<div class="reminder-item ${isEditing ? "editing" : ""}">
    <div class="reminder-row">
      <div class="reminder-identity"><span class="reminder-mark ${reminder.id}" aria-hidden="true">${marks[reminder.id] || "◷"}</span><div><strong>${escapeHtml(reminder.label)}</strong><small>Every day</small></div></div>
      <div class="reminder-controls">
        <button type="button" class="time-display" data-edit-reminder="${reminder.id}" aria-expanded="${isEditing}" aria-controls="time-editor-${reminder.id}"><span>${icon("clock", 15)}<strong>${formatReminderTime(reminder.time)}</strong></span><small>${isEditing ? "Editing" : "Change"}</small></button>
        <label class="switch-label" aria-label="${reminder.enabled ? "Disable" : "Enable"} ${escapeHtml(reminder.label)} reminder"><input class="switch-input" type="checkbox" data-reminder-toggle="${reminder.id}" ${reminder.enabled ? "checked" : ""}><i class="switch"></i></label>
      </div>
    </div>
    ${isEditing ? `<div class="time-editor" id="time-editor-${reminder.id}">
      <div class="time-editor-heading"><div><strong>Set ${escapeHtml(reminder.label.toLowerCase())} time</strong><span>Use the controls to choose when Noura should remind you.</span></div><button type="button" data-action="cancel-reminder-time" aria-label="Close time editor">×</button></div>
      <div class="time-editor-controls" role="group" aria-label="Reminder time">
        <div class="time-stepper"><span>Hour</span><div><button type="button" data-time-adjust="-60" aria-label="Previous hour">−</button><strong>${String(parts.hour12).padStart(2, "0")}</strong><button type="button" data-time-adjust="60" aria-label="Next hour">+</button></div></div>
        <span class="time-colon" aria-hidden="true">:</span>
        <div class="time-stepper"><span>Minute</span><div><button type="button" data-time-adjust="-5" aria-label="Five minutes earlier">−</button><strong>${String(parts.minute).padStart(2, "0")}</strong><button type="button" data-time-adjust="5" aria-label="Five minutes later">+</button></div></div>
        <div class="period-selector" aria-label="AM or PM">${["AM", "PM"].map(period => `<button type="button" class="${parts.period === period ? "active" : ""}" data-time-period="${period}" aria-pressed="${parts.period === period}">${period}</button>`).join("")}</div>
      </div>
      <div class="time-editor-footer"><span>${icon("bell", 14)} Reminder set for <strong>${formatReminderTime(draftTime)}</strong></span><div><button type="button" class="time-cancel" data-action="cancel-reminder-time">Cancel</button><button type="button" class="time-save" data-action="save-reminder-time">Save time</button></div></div>
    </div>` : ""}
  </div>`;
}

function renderOnboarding() {
  const step = state.onboardingStep;
  return `<div class="onboarding-shell">
    <header>${brand()}<span>Private · local-first · free</span></header>
    <main class="onboarding-main">
      <div class="onboarding-progress"><i style="width:${step / 3 * 100}%"></i></div>
      <div class="step-kicker">STEP ${step} OF 3</div>
      ${step === 1 ? onboardingBody() : step === 2 ? onboardingGoal() : onboardingDetails()}
    </main>
    <aside class="onboarding-aside"><div class="aside-glow"></div><div class="onboarding-quote"><span>✦</span><blockquote>“No guilt. No guesswork.<br>Just a clearer next choice.”</blockquote><p>Photos are processed on your device.</p></div></aside>
  </div>`;
}

function onboardingBody() {
  return `<section class="onboarding-step"><span class="eyebrow">Let’s shape your plan</span><h1>Which build feels most like you?</h1><p>Choose the closest fit. This personalises the experience, but does not change your science-based calorie calculation.</p><div class="body-options">${BODY_TYPES.map(item => `<button class="body-option ${state.onboarding.bodyType === item.id ? "active" : ""}" data-body-type="${item.id}"><span>${item.icon}</span><strong>${item.name}</strong><small>${item.copy}</small><i>${icon("check", 14)}</i></button>`).join("")}</div><button class="continue-button" data-onboarding-next>Continue ${icon("arrow", 18)}</button><p class="step-footnote">You can change this later in your profile.</p></section>`;
}

function onboardingGoal() {
  return `<section class="onboarding-step"><button class="back-button" data-onboarding-back>${icon("back", 16)} Back</button><span class="eyebrow">Choose your direction</span><h1>What are we working towards?</h1><p>Your calorie and protein targets will adapt to this goal.</p><div class="goal-options">${GOALS.map(item => `<button class="goal-option ${state.onboarding.goal === item.id ? "active" : ""}" data-goal="${item.id}" style="--goal-accent:${item.accent}"><span>${item.icon}</span><div><strong>${item.name}</strong><small>${item.copy}</small></div><i>${icon("check", 14)}</i></button>`).join("")}</div><button class="continue-button" data-onboarding-next>Set my starting point ${icon("arrow", 18)}</button></section>`;
}

function onboardingDetails() {
  const draftTarget = calculateTargets(state.onboarding);
  return `<section class="onboarding-step details-step"><button class="back-button" data-onboarding-back>${icon("back", 16)} Back</button><span class="eyebrow">Your starting point</span><h1>A target that fits your day.</h1><p>These details estimate your energy needs with the Mifflin–St Jeor equation. Adjust any time.</p><form id="onboarding-form">
    <label class="wide">First name <input name="name" value="${escapeHtml(state.onboarding.name)}" placeholder="What should we call you?" required></label>
    <label>Calculation basis <select name="basis"><option value="female" ${state.onboarding.basis === "female" ? "selected" : ""}>Female</option><option value="male" ${state.onboarding.basis === "male" ? "selected" : ""}>Male</option><option value="neutral" ${state.onboarding.basis === "neutral" ? "selected" : ""}>Neutral estimate</option></select></label>
    <label>Age <input name="age" type="number" min="16" max="100" value="${state.onboarding.age}" required></label>
    <label>Height <span><input name="height" type="number" min="120" max="230" value="${state.onboarding.height}" required><b>cm</b></span></label>
    <label>Weight <span><input name="weight" type="number" min="35" max="300" step="0.1" value="${state.onboarding.weight}" required><b>kg</b></span></label>
    <label class="wide">Typical activity <select name="activity"><option value="1.2">Mostly seated</option><option value="1.375" selected>Lightly active · 1–3 days/week</option><option value="1.55">Moderately active · 3–5 days/week</option><option value="1.725">Very active · 6–7 days/week</option></select></label>
    <div class="target-preview wide"><span>Suggested daily target</span><strong id="target-preview-value">${draftTarget.calories.toLocaleString()} <small>kcal</small></strong><p>${draftTarget.protein}g protein · ${draftTarget.carbs}g carbs · ${draftTarget.fat}g fat</p></div>
    <button class="continue-button wide">Start my plan ${icon("spark", 18)}</button>
  </form><p class="medical-note">Noura provides estimates for general wellness, not medical advice. Speak with a qualified professional for clinical nutrition needs.</p></section>`;
}

function recommendationCard(food, index) {
  return `<article class="card recommendation-card ${index === 0 ? "featured" : ""}"><div class="recommendation-top"><span class="food-emoji">${food.emoji}</span>${index === 0 ? `<span class="best-fit">Best fit</span>` : ""}</div><h2>${food.name}</h2><p>${food.reason}</p><div class="nutrition-facts"><span><strong>${food.kcal}</strong>kcal</span><span><strong>${food.protein}g</strong>protein</span><span><strong>${food.fiber}g</strong>fiber</span></div><button class="outline-button" data-quick-log="${food.id}">Add to today ${icon("plus", 16)}</button></article>`;
}

function renderMealRow(log) {
  const date = normaliseLogDate(log.at);
  return `<div class="meal-row"><span class="meal-emoji">${log.emoji || "🍽️"}</span><div><strong>${escapeHtml(log.name)}</strong><small>${escapeHtml(log.meal || "Meal")} · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div><span><strong>${Math.round(log.kcal)}</strong><small>kcal</small></span><button data-delete-log="${log.id}" aria-label="Remove ${escapeHtml(log.name)}">×</button></div>`;
}

function emptyMeals() {
  return `<div class="empty-meals"><div>${icon("plate", 28)}</div><strong>No meals logged yet</strong><p>Log what you eat—perfection isn’t required.</p></div>`;
}

function macroMeter(label, value, goal, color) {
  const status = macroStatus(value, goal);
  const warningColor = status.level === "danger" ? "#ff6b63" : status.level === "warning" ? "#ffd166" : color;
  const alertText = status.level === "danger" ? `High · ${status.over}g over` : status.level === "warning" ? `${status.over}g over` : "";
  const accessibleStatus = alertText ? `, ${alertText.toLowerCase()}` : ", within target";
  return `<div class="macro is-${status.level}" aria-label="${label}: ${Math.round(value)} of ${goal} grams${accessibleStatus}"><span><i style="background:${warningColor}"></i>${label}${status.level === "danger" ? `<b aria-hidden="true">!</b>` : ""}</span><strong>${Math.round(value)}<small class="macro-goal"> / ${goal}g</small></strong><div aria-hidden="true"><i style="width:${status.percentage}%;background:${warningColor}"></i></div>${alertText ? `<small class="macro-status">${alertText}</small>` : ""}</div>`;
}

function statCard(label, value, note, glyph) {
  return `<article class="card stat-card"><span class="stat-icon">${icon(glyph, 21)}</span><div><span>${label}</span><strong>${value}</strong><small>${note}</small></div></article>`;
}

function navButton(route, glyph, label, mobile = false) {
  return `<button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" ${state.route === route ? "aria-current=page" : ""}>${icon(glyph, mobile ? 20 : 19)}<span>${label}</span></button>`;
}

function brand(compact = false) {
  return `<div class="brand ${compact ? "compact" : ""}"><span class="brand-mark">${icon("leaf", compact ? 21 : 25)}</span><strong>Noura</strong>${compact ? "" : "<small>eat with intention</small>"}</div>`;
}

function googleMark() {
  return `<svg class="google-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.6-4.1H3v2.7A10.1 10.1 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3a10 10 0 0 0 0 9.3L6.4 14Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 3 7.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z"/></svg>`;
}

function wireAfterRender() {
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => { state.auth.mode = button.dataset.authMode; state.auth.message = ""; state.auth.kind = ""; render(); }));
  document.querySelector("[data-action='google-auth']")?.addEventListener("click", handleGoogleAuth);
  document.querySelector("#auth-form")?.addEventListener("submit", handleAuthSubmit);
  document.querySelector("[data-action='forgot-password']")?.addEventListener("click", handlePasswordResetRequest);
  document.querySelector("#recovery-form")?.addEventListener("submit", handlePasswordUpdate);
  document.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.route !== "scan") clearPhotoScan();
    state.route = button.dataset.route;
    state.reminderEditor = null;
    render();
    scrollTo(0, 0);
  }));
  document.querySelectorAll("[data-scan-mode]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.scanMode !== "photo") clearPhotoScan();
    state.scanMode = button.dataset.scanMode;
    state.scanStatus = null;
    state.scanResults = [];
    state.pendingFoods = [];
    state.foodLookupToken = null;
    state.mealDraft = "";
    state.mealConversation = null;
    render();
  }));
  document.querySelectorAll("[data-body-type]").forEach(button => button.addEventListener("click", () => { state.onboarding.bodyType = button.dataset.bodyType; render(); }));
  document.querySelectorAll("[data-goal]").forEach(button => button.addEventListener("click", () => { state.onboarding.goal = button.dataset.goal; render(); }));
  document.querySelector("[data-onboarding-next]")?.addEventListener("click", () => { state.onboardingStep += 1; render(); });
  document.querySelector("[data-onboarding-back]")?.addEventListener("click", () => { state.onboardingStep -= 1; render(); });
  document.querySelector("#onboarding-form")?.addEventListener("input", event => {
    const form = new FormData(event.currentTarget);
    for (const [key, value] of form) state.onboarding[key] = ["age", "height", "weight", "activity"].includes(key) ? Number(value) : value;
    const preview = calculateTargets(state.onboarding);
    const node = document.querySelector("#target-preview-value");
    if (node) node.innerHTML = `${preview.calories.toLocaleString()} <small>kcal</small>`;
  });
  document.querySelector("#onboarding-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    for (const [key, value] of form) state.onboarding[key] = ["age", "height", "weight", "activity"].includes(key) ? Number(value) : value;
    state.profile = { ...state.onboarding, targets: calculateTargets(state.onboarding) };
    state.onboardingStep = 1;
    persist(); showToast("Your plan is ready. Welcome to Noura!");
  });
  document.querySelector("#food-photo")?.addEventListener("change", handleFoodPhoto);
  document.querySelector("#barcode-photo")?.addEventListener("change", handleBarcodePhoto);
  document.querySelector("#barcode-form")?.addEventListener("submit", event => { event.preventDefault(); lookupProduct(new FormData(event.currentTarget).get("barcode")); });
  document.querySelector("#manual-form")?.addEventListener("submit", handleManualMeal);
  document.querySelector("#meal-text")?.addEventListener("input", event => { state.mealDraft = event.currentTarget.value; });
  document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => { const text = document.querySelector("#meal-text"); state.mealDraft = button.dataset.example; text.value = state.mealDraft; text.focus(); }));
  document.querySelector("[data-action='edit-meal-message']")?.addEventListener("click", () => {
    state.mealDraft = state.mealConversation?.message || "";
    render();
    setTimeout(() => { const text = document.querySelector("#meal-text"); text?.focus(); text?.setSelectionRange(text.value.length, text.value.length); }, 50);
  });
  document.querySelectorAll("[data-scan-result]").forEach(button => button.addEventListener("click", () => chooseScanResult(Number(button.dataset.scanResult))));
  document.querySelector("[data-action='deep-photo-scan']")?.addEventListener("click", () => runPhotoRecognition("deep"));
  document.querySelector("[data-action='manual-photo-correction']")?.addEventListener("click", () => {
    const bestGuess = state.scanResults.find(result => result.food)?.food?.name || "";
    clearPhotoScan();
    state.scanMode = "manual";
    state.mealDraft = bestGuess;
    render();
    setTimeout(() => document.querySelector("#meal-text")?.focus(), 50);
  });
  document.querySelectorAll("[data-use-database-food]").forEach(button => button.addEventListener("click", () => {
    const [itemIndex, suggestionIndex] = button.dataset.useDatabaseFood.split(":").map(Number);
    chooseDatabaseFood(itemIndex, suggestionIndex);
  }));
  document.querySelectorAll("[data-suggestion-image]").forEach(image => image.addEventListener("error", () => {
    image.hidden = true;
    image.closest(".suggestion-media")?.classList.add("image-missing");
  }, { once: true }));
  document.querySelectorAll("[data-custom-food]").forEach(form => form.addEventListener("submit", handleCustomFood));
  document.querySelectorAll("[data-adjust-pending]").forEach(button => button.addEventListener("click", () => {
    const [itemIndex, direction] = button.dataset.adjustPending.split(":").map(Number);
    adjustPendingPortion(itemIndex, direction);
  }));
  document.querySelectorAll("[data-remove-pending]").forEach(button => button.addEventListener("click", () => {
    state.pendingFoods.splice(Number(button.dataset.removePending), 1);
    refreshMealConversation();
    render();
  }));
  document.querySelector("[data-action='log-pending']")?.addEventListener("click", logPendingFoods);
  document.querySelector("[data-action='manual-focus']")?.addEventListener("click", () => { state.route = "scan"; state.scanMode = "manual"; render(); setTimeout(() => document.querySelector("#meal-text")?.focus(), 50); });
  document.querySelectorAll("[data-delete-log]").forEach(button => button.addEventListener("click", () => { state.logs = state.logs.filter(log => log.id !== button.dataset.deleteLog); persist(); showToast("Meal removed."); }));
  document.querySelectorAll("[data-quick-log]").forEach(button => button.addEventListener("click", () => addFoodLog(FOOD_LIBRARY.find(food => food.id === button.dataset.quickLog))));
  document.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => { state.period = button.dataset.period; state.insightSelectionKey = null; render(); }));
  document.querySelectorAll("[data-insight-key]").forEach(button => button.addEventListener("click", () => { state.insightSelectionKey = button.dataset.insightKey; render(); }));
  document.querySelectorAll("[data-diet]").forEach(button => button.addEventListener("click", () => { state.profile.diet = button.dataset.diet; persist(); render(); }));
  document.querySelectorAll("[data-edit-reminder]").forEach(button => button.addEventListener("click", () => {
    const reminder = state.reminders.find(item => item.id === button.dataset.editReminder);
    if (!reminder) return;
    state.reminderEditor = state.reminderEditor?.id === reminder.id ? null : { id: reminder.id, time: reminder.time };
    render();
  }));
  document.querySelectorAll("[data-time-adjust]").forEach(button => button.addEventListener("click", () => {
    if (!state.reminderEditor) return;
    state.reminderEditor.time = adjustReminderTime(state.reminderEditor.time, Number(button.dataset.timeAdjust));
    render();
  }));
  document.querySelectorAll("[data-time-period]").forEach(button => button.addEventListener("click", () => {
    if (!state.reminderEditor) return;
    state.reminderEditor.time = setReminderPeriod(state.reminderEditor.time, button.dataset.timePeriod);
    render();
  }));
  document.querySelectorAll("[data-action='cancel-reminder-time']").forEach(button => button.addEventListener("click", () => { state.reminderEditor = null; render(); }));
  document.querySelector("[data-action='save-reminder-time']")?.addEventListener("click", saveReminderTime);
  document.querySelectorAll("[data-reminder-toggle]").forEach(input => input.addEventListener("change", () => { updateReminder(input.dataset.reminderToggle, { enabled: input.checked }); render(); }));
  document.querySelectorAll("[data-action='enable-notifications']").forEach(button => button.addEventListener("click", enableNotifications));
  document.querySelector("[data-action='restart-onboarding']")?.addEventListener("click", () => { state.onboarding = { ...state.profile }; state.onboardingStep = 1; state.profile = null; render(); });
  document.querySelector("[data-action='logout']")?.addEventListener("click", logout);
  document.querySelector("[data-action='reset-data']")?.addEventListener("click", resetData);
  if (state.route === "scan" && state.scanMode === "photo") warmFastFoodAi();
}

async function handleGoogleAuth() {
  state.auth.message = "Opening Google sign-in…";
  state.auth.kind = "working";
  render();
  try {
    await signInWithGoogle();
  } catch (error) {
    state.auth.status = "anonymous";
    state.auth.message = friendlyAuthError(error);
    state.auth.kind = "error";
    render();
  }
}

function resetGoogleAuthAfterReturn() {
  if (currentUser || state.auth.kind !== "working" || state.auth.message !== "Opening Google sign-in…") return;
  state.auth.status = "anonymous";
  state.auth.message = "";
  state.auth.kind = "";
  render();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const mode = state.auth.mode;
  state.auth.message = mode === "signup" ? "Creating your secure account…" : "Signing you in…";
  state.auth.kind = "working";
  render();

  try {
    const data = mode === "signup" ? await createAccount(email, password) : await signIn(email, password);
    if (data.session?.user) {
      if (currentUser?.id !== data.session.user.id) await hydrateUser(data.session.user);
    } else {
      state.auth.status = "anonymous";
      state.auth.message = "Account created. Check your email to confirm it, then return here and sign in.";
      state.auth.kind = "success";
      state.auth.mode = "signin";
      render();
    }
  } catch (error) {
    state.auth.status = "anonymous";
    state.auth.message = friendlyAuthError(error);
    state.auth.kind = "error";
    render();
  }
}

async function handlePasswordResetRequest() {
  const emailInput = document.querySelector("#auth-form input[name='email']");
  const email = emailInput?.value.trim();
  if (!email || !emailInput.checkValidity()) {
    emailInput?.reportValidity();
    return;
  }
  try {
    await requestPasswordReset(email);
    state.auth.message = "Password reset email sent. Open its link on this device to choose a new password.";
    state.auth.kind = "success";
  } catch (error) {
    state.auth.message = friendlyAuthError(error);
    state.auth.kind = "error";
  }
  render();
}

async function handlePasswordUpdate(event) {
  event.preventDefault();
  const password = String(new FormData(event.currentTarget).get("password") || "");
  state.auth.message = "Saving your new password…";
  state.auth.kind = "working";
  render();
  try {
    await updatePassword(password);
    state.auth.recovery = false;
    if (currentUser) await hydrateUser(currentUser);
    else {
      state.auth.status = "anonymous";
      state.auth.message = "Password updated. Sign in with your new password.";
      state.auth.kind = "success";
      render();
    }
  } catch (error) {
    state.auth.message = friendlyAuthError(error);
    state.auth.kind = "error";
    render();
  }
}

function cloudPayload() {
  return {
    profile: state.profile,
    logs: Array.isArray(state.logs) ? state.logs : [],
    reminders: Array.isArray(state.reminders) ? state.reminders : DEFAULT_REMINDERS
  };
}

function hasLocalNutritionData(value = state) {
  return Boolean(value.profile || value.logs?.length);
}

async function hydrateUser(user) {
  const token = ++hydrationToken;
  const localSnapshot = cloudPayload();
  currentUser = user;
  state.auth = { ...state.auth, status: "loading", user, message: "", kind: "", recovery: false };
  render();

  try {
    const cloudState = await fetchCloudState(user.id);
    if (token !== hydrationToken) return;
    if (cloudState) {
      state.profile = cloudState.profile || null;
      state.logs = Array.isArray(cloudState.logs) ? cloudState.logs : [];
      state.reminders = Array.isArray(cloudState.reminders) && cloudState.reminders.length ? cloudState.reminders : structuredClone(DEFAULT_REMINDERS);
      state.sync = { status: "synced", message: "Restored from your account" };
    } else if (hasLocalNutritionData(localSnapshot)) {
      await saveCloudState(user.id, localSnapshot);
      if (token !== hydrationToken) return;
      state.sync = { status: "synced", message: "Existing data moved to your account" };
    } else {
      state.profile = null;
      state.logs = [];
      state.reminders = structuredClone(DEFAULT_REMINDERS);
      state.sync = { status: "synced", message: "Account ready" };
    }
    state.auth = { status: "authenticated", mode: "signin", message: "", kind: "", recovery: false, user };
    persist({ sync: false });
    render();
    void refreshPushSubscription();
  } catch (error) {
    if (token !== hydrationToken) return;
    state.auth = { status: "authenticated", mode: "signin", message: "", kind: "", recovery: false, user };
    state.sync = { status: "error", message: friendlyAuthError(error) };
    render();
    showToast("Signed in, but cloud data could not be loaded. Check the connection before adding meals.", "error");
  }
}

function scheduleCloudSave() {
  if (!currentUser) return;
  clearTimeout(syncTimer);
  state.sync = { status: "saving", message: "Saving changes…" };
  updateSyncIndicator();
  syncTimer = setTimeout(() => saveCurrentState(), 450);
}

async function saveCurrentState() {
  if (!currentUser) return true;
  clearTimeout(syncTimer);
  syncTimer = null;
  const userId = currentUser.id;
  try {
    await saveCloudState(userId, cloudPayload());
    if (currentUser?.id !== userId) return false;
    state.sync = { status: "synced", message: "Saved to your account" };
    updateSyncIndicator();
    return true;
  } catch (error) {
    if (currentUser?.id !== userId) return false;
    state.sync = { status: "error", message: friendlyAuthError(error) };
    updateSyncIndicator();
    return false;
  }
}

function updateSyncIndicator() {
  const container = document.querySelector(".account-sync");
  if (!container) return;
  const dot = container.querySelector("i");
  const label = container.querySelector("strong");
  if (dot) dot.className = state.sync.status;
  if (label) label.textContent = syncLabel();
}

function syncLabel() {
  if (state.sync.status === "saving") return "Saving to Noura Cloud";
  if (state.sync.status === "error") return "Cloud sync needs attention";
  return "Saved to Noura Cloud";
}

function friendlyAuthError(error) {
  const message = error?.message || "Please try again.";
  if (/invalid login credentials/i.test(message)) return "The email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first, then sign in.";
  if (/user already registered/i.test(message)) return "An account already exists for this email. Sign in instead.";
  if (/provider is not enabled|unsupported provider/i.test(message)) return "Google sign-in is not available yet. Use email for now or try again later.";
  if (/fetch|network/i.test(message)) return "Noura Cloud could not be reached. Check your connection and try again.";
  if (/noura_user_data|schema cache|relation/i.test(message)) return "Noura Cloud is connected, but its private data table has not been set up yet.";
  return message;
}

async function handleCloudAuthEvent(event, session) {
  if (event === "INITIAL_SESSION") return;
  if (event === "PASSWORD_RECOVERY") {
    currentUser = session?.user || null;
    state.auth = { status: "anonymous", mode: "signin", message: "", kind: "", recovery: true, user: currentUser };
    render();
    return;
  }
  if (event === "SIGNED_OUT") {
    ++hydrationToken;
    currentUser = null;
    clearLocalNutritionCache();
    state = structuredClone(defaults);
    state.auth = { status: "anonymous", mode: "signin", message: "You’re logged out. Sign in again to restore your saved data.", kind: "success", recovery: false };
    render();
    return;
  }
  if (session?.user && currentUser?.id !== session.user.id) await hydrateUser(session.user);
}

async function initialiseCloud() {
  if (!cloudConfigured) {
    render();
    return;
  }
  state.auth.status = "loading";
  render();
  try {
    const session = await getCloudSession();
    authSubscription = onCloudAuthChange(handleCloudAuthEvent);
    if (session?.user) await hydrateUser(session.user);
    else {
      state.auth = { status: "anonymous", mode: "signin", message: "", kind: "", recovery: false };
      render();
    }
  } catch (error) {
    state.auth = { status: "anonymous", mode: "signin", message: friendlyAuthError(error), kind: "error", recovery: false };
    render();
  }
}

function warmFastFoodAi() {
  if (foodAiWarmStarted || state.photoAiReady) return;
  foodAiWarmStarted = true;
  setTimeout(async () => {
    try {
      const { prepareFoodClassifier } = await import("./food-ai.js");
      await prepareFoodClassifier("fast", progress => {
        if (progress !== 100 || state.photoAiReady) return;
        state.photoAiReady = true;
        if (state.route === "scan" && state.scanMode === "photo" && !state.scanStatus) render();
      });
      state.photoAiReady = true;
      if (state.route === "scan" && state.scanMode === "photo" && !state.scanStatus) render();
    } catch {
      foodAiWarmStarted = false;
    }
  }, 120);
}

async function handleFoodPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  clearPhotoScan();
  lastPhotoFile = file;
  state.photoPreviewUrl = URL.createObjectURL(file);
  await runPhotoRecognition("fast");
}

async function runPhotoRecognition(mode = "fast") {
  if (!lastPhotoFile) return;
  const token = ++photoScanToken;
  const startedAt = performance.now();
  let shownProgress = -10;
  state.photoScanDepth = mode;
  state.photoElapsedMs = null;
  if (mode === "fast") state.scanResults = [];
  state.scanStatus = {
    title: mode === "deep" ? "Starting a deeper dish scan" : "Starting the fast scanner",
    detail: mode === "deep" ? "This optional model is larger, so you can still use the fast suggestions below." : "Usually ready in a few seconds after the first small download.",
    progress: 3
  };
  render();
  try {
    const { classifyFoodImage } = await import("./food-ai.js");
    const results = await classifyFoodImage(lastPhotoFile, (progress, title) => {
      if (photoScanToken !== token || (progress < 100 && progress < shownProgress + 8)) return;
      shownProgress = progress;
      state.scanStatus = {
        title,
        detail: progress < 100
          ? `${progress}% of the ${mode === "deep" ? "larger optional" : "small fast"} model ready`
          : "Analysing locally—your photo stays on this device.",
        progress
      };
      render();
    }, { mode });
    if (photoScanToken !== token) return;
    const fresh = normalisePhotoResults(results);
    state.scanResults = mode === "deep" ? mergePhotoResults(fresh, state.scanResults) : fresh;
    state.photoElapsedMs = performance.now() - startedAt;
    const catalogMatches = state.scanResults.filter(result => result.food).length;
    state.scanStatus = catalogMatches
      ? { title: `${mode === "deep" ? "Deeper" : "Fast"} scan ready`, detail: `${catalogMatches} catalogue ${catalogMatches === 1 ? "match" : "matches"} found in ${formatScanTime(state.photoElapsedMs)}. Confirm the closest one.`, kind: "success" }
      : { title: "I’m not certain enough yet", detail: `The scan finished in ${formatScanTime(state.photoElapsedMs)}, but I won’t turn a weak visual clue into the wrong meal.`, kind: "notice" };
  } catch (error) {
    if (photoScanToken !== token) return;
    state.scanStatus = { title: "Photo scan couldn’t finish", detail: `${friendlyError(error)} You can tell Noura what you see without waiting.`, kind: "error" };
  }
  render();
}

function normalisePhotoResults(results) {
  const mapped = results.map(result => {
    const display = String(result.label || "Food").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
    return { ...result, display, food: findVisualFood(result.label) || findVisualFood(display) };
  });
  return [...mapped.filter(result => result.food), ...mapped.filter(result => !result.food).slice(0, 2)].slice(0, 6);
}

function mergePhotoResults(primary, secondary) {
  const seen = new Set();
  return [...primary, ...secondary].filter(result => {
    const key = result.food?.id || result.display.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function formatScanTime(milliseconds) {
  if (milliseconds < 1000) return "under 1 second";
  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} seconds`;
}

function visualConfidence(score) {
  const percentage = Math.round((Number(score) || 0) * 100);
  if (percentage >= 50) return `Likely match · ${percentage}% visual confidence`;
  if (percentage >= 20) return `Possible match · ${percentage}% visual confidence`;
  return `Low-confidence clue · ${percentage}%`;
}

function clearPhotoScan() {
  photoScanToken += 1;
  if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
  state.photoPreviewUrl = null;
  state.photoScanDepth = "fast";
  state.photoElapsedMs = null;
  state.scanResults = [];
  lastPhotoFile = null;
}

async function handleBarcodePhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.scanStatus = { title: "Reading barcode", detail: "Looking for an EAN or UPC code…", progress: 30 };
  render();
  try {
    const { detectBarcode } = await import("./food-ai.js");
    const code = await detectBarcode(file);
    await lookupProduct(code);
  } catch (error) {
    state.scanStatus = { title: "Couldn’t scan that code", detail: friendlyError(error), kind: "error" };
    render();
  }
}

async function lookupProduct(code) {
  state.scanStatus = { title: "Checking Open Food Facts", detail: "Fetching nutrition per serving…", progress: 65 };
  render();
  try {
    const { lookupBarcode } = await import("./food-ai.js");
    const food = await lookupBarcode(code);
    state.pendingFoods = [food];
    state.scanMode = "manual";
    state.scanStatus = null;
    render();
  } catch (error) {
    state.scanStatus = { title: "Product not found", detail: friendlyError(error), kind: "error" };
    render();
  }
}

async function handleManualMeal(event) {
  event.preventDefault();
  const message = String(new FormData(event.currentTarget).get("meal") || "").trim();
  const result = parseMealText(message);
  const token = `${Date.now()}-${Math.random()}`;
  state.foodLookupToken = token;
  state.mealDraft = "";
  state.mealConversation = { message, phase: result.unknown.length ? "searching" : "review" };
  state.pendingFoods = [...result.matched, ...result.unknown.map(name => ({ unknown: true, name, searching: true, suggestions: [] }))];
  state.scanStatus = null;
  render();
  if (!result.unknown.length) return;

  try {
    const { searchFoodDatabase } = await import("./food-database.js");
    const lookedUp = await Promise.all(result.unknown.map(async name => {
      try {
        return { unknown: true, name, searching: false, suggestions: await searchFoodDatabase(name) };
      } catch (error) {
        return { unknown: true, name, searching: false, suggestions: [], lookupError: friendlyError(error) };
      }
    }));
    if (state.foodLookupToken !== token) return;
    state.pendingFoods = [...result.matched, ...lookedUp];
    state.mealConversation = { ...state.mealConversation, phase: "clarify" };
    state.scanStatus = null;
    render();
  } catch (error) {
    if (state.foodLookupToken !== token) return;
    state.pendingFoods = state.pendingFoods.map(item => item.unknown ? { ...item, searching: false, lookupError: friendlyError(error) } : item);
    state.mealConversation = { ...state.mealConversation, phase: "clarify" };
    state.scanStatus = null;
    render();
  }
}

function chooseDatabaseFood(itemIndex, suggestionIndex) {
  const item = state.pendingFoods[itemIndex];
  const food = item?.suggestions?.[suggestionIndex];
  if (!item?.unknown || !food) return;
  state.pendingFoods[itemIndex] = food;
  state.scanStatus = null;
  refreshMealConversation();
  render();
}

function handleCustomFood(event) {
  event.preventDefault();
  const index = Number(event.currentTarget.dataset.customFood);
  const item = state.pendingFoods[index];
  if (!item?.unknown) return;
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || item.name).trim().slice(0, 80);
  const number = field => Math.max(0, Number(form.get(field)) || 0);
  state.pendingFoods[index] = {
    id: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "food"}-${Date.now()}`,
    name,
    emoji: "🍽️",
    serving: String(form.get("serving") || "1 serving").trim().slice(0, 40),
    grams: 0,
    servings: 1,
    kcal: Math.round(number("kcal")),
    protein: round1(number("protein")),
    carbs: round1(number("carbs")),
    fat: round1(number("fat")),
    fiber: round1(number("fiber")),
    source: "Custom entry"
  };
  state.scanStatus = null;
  refreshMealConversation();
  render();
}

function refreshMealConversation() {
  if (!state.mealConversation) return;
  state.mealConversation = {
    ...state.mealConversation,
    phase: state.pendingFoods.some(item => item.unknown) ? "clarify" : "review"
  };
}

function adjustPendingPortion(index, direction) {
  const food = state.pendingFoods[index];
  if (!food || food.unknown) return;
  const current = Math.max(0.5, Number(food.servings) || 1);
  const next = direction > 0 ? (current < 1 ? 1 : Math.min(100, current + 1)) : Math.max(1, current - 1);
  if (next === current) return;
  const ratio = next / current;
  state.pendingFoods[index] = {
    ...food,
    servings: next,
    kcal: Math.round(food.kcal * ratio),
    protein: round1(food.protein * ratio),
    carbs: round1(food.carbs * ratio),
    fat: round1(food.fat * ratio),
    fiber: round1(food.fiber * ratio)
  };
  refreshMealConversation();
  render();
}

function cleanCustomFoodName(value) {
  const cleaned = String(value || "Food")
    .replace(/^\s*(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔]|half|quarter)\s*/i, "")
    .replace(/^\s*(?:x|servings?|pieces?|pcs?|bowls?|cups?|plates?|glasses?|slices?)\s+(?:of\s+)?/i, "")
    .trim();
  return cleaned.replace(/\b\w/g, letter => letter.toUpperCase()) || "Food";
}

function chooseScanResult(index) {
  const result = state.scanResults[index];
  const display = result?.display || "This food";
  if (!result?.food) {
    clearPhotoScan();
    state.scanMode = "manual";
    state.pendingFoods = [];
    state.mealDraft = display;
    state.mealConversation = null;
    render();
    setTimeout(() => document.querySelector("#meal-text")?.focus(), 50);
    return;
  } else {
    clearPhotoScan();
    state.pendingFoods = [scaleFood(result.food, 1)];
    state.scanMode = "manual";
    state.mealConversation = { message: display, phase: "review" };
  }
  render();
}

function logPendingFoods() {
  const foods = state.pendingFoods.filter(item => !item.unknown);
  foods.forEach(addFoodLog);
  state.pendingFoods = [];
  state.scanResults = [];
  state.mealDraft = "";
  state.mealConversation = null;
  state.route = "today";
  persist();
  showToast(`${foods.length} ${foods.length === 1 ? "item" : "items"} added to today.`);
}

function addFoodLog(food) {
  if (!food) return;
  const now = new Date();
  state.logs.push({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    foodId: food.id, name: food.name, emoji: food.emoji || "🍽️", serving: food.serving,
    kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber,
    meal: food.mealHint || mealTypeForTime(now), at: now.toISOString(), source: food.source || "catalogue"
  });
  persist();
  if (state.route !== "scan") showToast(`${food.name} added.`);
}

async function enableNotifications() {
  const status = getNotificationState(notificationContext());
  state.route = "profile";

  if (status.code === "blocked") return showToast("Notifications are blocked. Follow the browser steps shown on this page, then reload.", "error");
  if (status.code === "install" || status.code === "unavailable") return showToast(status.message, "error");

  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return showToast("Permission was not enabled. Use the instructions shown on this page to try again.", "error");
    if (!serverPushConfigured || !pushIsSupported(window)) {
      await sendNotification("Noura reminders are on", "This browser can show notifications while Noura is running.");
      return showToast("The local test worked, but closed-app reminders are not available in this browser.", "error");
    }
    state.push = { status: "connecting", message: "Connecting this device…" };
    render();
    const subscription = await ensurePushSubscription();
    await sendPushTest(subscription.endpoint);
    showToast("Closed-app reminders are connected and the server test was sent.");
  } catch (error) {
    state.push = { status: "error", message: friendlyPushError(error) };
    render();
    showToast(`Noura could not send the test: ${friendlyPushError(error)}`, "error");
  }
}

function updateReminder(id, changes) {
  state.reminders = state.reminders.map(reminder => reminder.id === id ? { ...reminder, ...changes } : reminder);
  persist();
}

function saveReminderTime() {
  const draft = state.reminderEditor;
  const reminder = state.reminders.find(item => item.id === draft?.id);
  if (!draft || !reminder) return;
  updateReminder(draft.id, { time: draft.time });
  state.reminderEditor = null;
  showToast(`${reminder.label} reminder changed to ${formatReminderTime(draft.time)}.`);
}

async function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !state.profile) return;
  if (serverPushConfigured && state.push.status === "connected") return;
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const reminder = state.reminders.find(item => item.enabled && item.time === time);
  if (!reminder) return;
  const key = `noura-reminded-${dayKey()}-${reminder.id}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  await sendNotification(`Before ${reminder.label.toLowerCase()}…`, "Take a quick photo or tell Noura what’s on your plate.");
}

async function sendNotification(title, body) {
  if (Notification.permission !== "granted") throw new Error("Notification permission is not enabled.");
  const registration = await ensureServiceWorker();
  if (registration) return registration.showNotification(title, { body, icon: assetUrl("notification-icon.png"), badge: assetUrl("notification-badge.png"), tag: "noura-meal" });
  return new Notification(title, { body, icon: assetUrl("notification-icon.png") });
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register(assetUrl("sw.js"), { updateViaCache: "none" });
  registration.update().catch(() => {});
  if (registration.active) return registration;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("The reminder service did not become ready. Reload Noura and try again.")), 7000))
  ]);
}

async function ensurePushSubscription() {
  if (!currentUser) throw new Error("Sign in before connecting reminders.");
  if (!serverPushConfigured) throw new Error("Closed-app reminder delivery has not been configured.");
  if (!pushIsSupported(window)) throw new Error("This browser does not support closed-app Web Push.");
  const registration = await ensureServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !applicationServerKeyMatches(subscription, vapidPublicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
  }
  await registerPushSubscription(pushSubscriptionRecord(subscription, currentTimezone(), navigator.userAgent));
  state.push = { status: "connected", message: "This device receives closed-app reminders" };
  render();
  return subscription;
}

async function refreshPushSubscription() {
  if (!currentUser || !serverPushConfigured || !pushIsSupported(window) || Notification.permission !== "granted") {
    state.push = { status: "idle", message: "" };
    return;
  }
  try {
    const registration = await ensureServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription || !applicationServerKeyMatches(subscription, vapidPublicKey)) {
      if (subscription) await subscription.unsubscribe();
      state.push = { status: "idle", message: "" };
      render();
      return;
    }
    await registerPushSubscription(pushSubscriptionRecord(subscription, currentTimezone(), navigator.userAgent));
    state.push = { status: "connected", message: "This device receives closed-app reminders" };
  } catch (error) {
    state.push = { status: "error", message: friendlyPushError(error) };
  }
  render();
}

async function disconnectPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  if (currentUser) {
    try {
      await unregisterPushSubscription(subscription.endpoint);
    } catch {
      // Unsubscribing below invalidates the endpoint even if the server is temporarily unavailable.
    }
  }
  await subscription.unsubscribe();
  state.push = { status: "idle", message: "" };
}

function notificationContext() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  return {
    supported: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported",
    secureContext: window.isSecureContext,
    isIOS,
    isStandalone,
    pushSupported: pushIsSupported(window),
    serverConfigured: serverPushConfigured,
    pushStatus: state.push.status
  };
}

function clearLocalNutritionCache() {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key === STORAGE_KEY || key?.startsWith("noura-reminded-")) localStorage.removeItem(key);
  }
}

async function logout() {
  const saved = await saveCurrentState();
  if (!saved) return showToast("Noura could not save your latest changes, so you were not logged out. Check your connection and try again.", "error");
  try {
    await disconnectPushSubscription();
    await signOut();
    ++hydrationToken;
    currentUser = null;
    clearLocalNutritionCache();
    state = structuredClone(defaults);
    state.auth = { status: "anonymous", mode: "signin", message: "You’re logged out. Your data remains safely stored in your account.", kind: "success", recovery: false };
    render();
  } catch (error) {
    showToast(friendlyAuthError(error), "error");
  }
}

async function resetData() {
  if (!currentUser || !confirm("Permanently delete your profile, meal history, streaks, and reminders from Noura Cloud? Your login account will remain active.")) return;
  try {
    await disconnectPushSubscription();
    await deleteCloudState(currentUser.id);
    clearLocalNutritionCache();
    const user = currentUser;
    state = structuredClone(defaults);
    state.auth = { status: "authenticated", mode: "signin", message: "", kind: "", recovery: false, user };
    state.sync = { status: "synced", message: "Nutrition data deleted" };
    render();
    showToast("Your Noura nutrition data was permanently deleted.");
  } catch (error) {
    showToast(`Your data could not be deleted: ${friendlyAuthError(error)}`, "error");
  }
}

function showToast(message, kind = "") {
  state.toast = { message, kind };
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; render(); }, 3200);
}

function getCoachNudge() {
  const total = todayTotals();
  const target = targets();
  if (!total.kcal) return "Log your first meal";
  if (total.protein < target.protein * 0.45) return "Prioritise protein next";
  if (total.fiber < target.fiber * 0.45) return "Add a fibre-rich side";
  return "You’re pacing well today";
}

function energyMessage(percent, kcal) {
  if (!kcal) return "Nothing logged yet. Your day starts with the next honest entry.";
  if (percent < 55) return "Plenty of room left. Build your next meal around protein and plants.";
  if (percent <= 100) return "Right on pace. Your next choice can keep the day balanced.";
  return "You’re over the estimate—no guilt. Log accurately and reset tomorrow.";
}

function getInsight(values, average, target) {
  if (!values.length) return "A week of honest logging is enough to reveal your first useful pattern.";
  const difference = average - target.calories;
  if (Math.abs(difference) < target.calories * 0.08) return "Your average intake is closely aligned with your current energy target.";
  if (difference > 0) return `Your logged average is ${Math.abs(difference)} kcal above target—small portion shifts may be enough.`;
  return `Your logged average is ${Math.abs(difference)} kcal below target—make sure energy and recovery still feel good.`;
}

function dayPart() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

function formatDate(date) {
  return date.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
}

function formatNutrient(value) {
  return Number(value || 0).toLocaleString("en", { maximumFractionDigits: 1 });
}

function initials(name) {
  return name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
}

function friendlyError(error) {
  const message = error?.message || "Please try again.";
  if (/fetch|network|load/i.test(message)) return "The model or nutrition database could not be reached. Check your connection, then retry.";
  return message;
}

function friendlyPushError(error) {
  const message = error?.message || "Please try again.";
  if (/not found|register_noura_push_subscription|schema cache|function/i.test(message)) return "The reminder database update has not been installed yet.";
  if (/vapid|applicationServerKey|push service|registration/i.test(message)) return "This device could not connect to the Web Push service.";
  if (/fetch|network/i.test(message)) return "The reminder server could not be reached. Check your connection and try again.";
  return message;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function icon(name, size = 20) {
  const paths = {
    leaf: '<path d="M18.7 3.8C12.7 3.9 7.6 6.5 6.3 11.4c-.7 2.7.6 5.3 3 6.2 3.8 1.3 7.5-1.9 8.3-5.7.4-2 .5-5 .1-7.1M5 20c1.8-5.4 5.3-8.8 10.6-11.3"/>', logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
    home: '<path d="m3 10 9-7 9 7v10h-6v-6H9v6H3Z"/>', scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8"/>', chart: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>', spark: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5ZM19 3v4M21 5h-4"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-4.2 3.2-6 8-6s7.4 1.8 8 6"/>', bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', shield: '<path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6Z"/><path d="m9 12 2 2 4-4"/>', type: '<path d="M5 5h14M12 5v14M8 19h8"/>', barcode: '<path d="M4 5v14M7 5v14M11 5v14M13 5v14M17 5v14M20 5v14"/>', camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4Z"/><circle cx="12" cy="13" r="4"/>', check: '<path d="m5 12 4 4L19 6"/>', back: '<path d="m15 18-6-6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', plate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>', pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', flame: '<path d="M12 21c4 0 7-2.8 7-6.5 0-3-1.7-5.7-5.2-8.5.1 2.5-.7 4-2 4.8.1-3.1-1.4-5.7-4-7.8.1 4-3 6.6-3 11.5C4.8 18.2 8 21 12 21Z"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

if ("serviceWorker" in navigator) {
  const controlledAtLoad = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtLoad || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => ensureServiceWorker().catch(() => {}));
}
window.addEventListener("pageshow", resetGoogleAuthAfterReturn);
setInterval(checkReminders, 30000);
initialiseCloud();
