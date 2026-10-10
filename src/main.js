import "./styles.css";
import { BODY_TYPES, DEFAULT_REMINDERS, FOOD_LIBRARY, GOALS } from "./data.js";
import {
  calculateDayScore, calculateTargets, chartSeries, dayKey, findFood, getStreak,
  mealTypeForTime, normaliseLogDate, parseMealText, recommendNext, round1, scaleFood, totalsForDate
} from "./logic.js";
import { getNotificationState } from "./notifications.js";

const STORAGE_KEY = "noura-state-v1";
const app = document.querySelector("#app");
const assetUrl = path => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, "")}`;

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
  pendingFoods: [],
  toast: null
};

let state = loadState();
let toastTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...structuredClone(defaults), ...saved, route: "today", scanStatus: null, scanResults: [], pendingFoods: [], toast: null };
  } catch {
    return structuredClone(defaults);
  }
}

function persist() {
  const { profile, logs, reminders } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile, logs, reminders }));
}

function targets() {
  return state.profile?.targets || calculateTargets(state.profile || state.onboarding);
}

function todayTotals() {
  return totalsForDate(state.logs, new Date());
}

function render() {
  const shell = state.profile ? renderAppShell() : renderOnboarding();
  app.innerHTML = shell + (state.toast ? `<div class="toast ${state.toast.kind || ""}" role="status">${icon("check", 18)}<span>${escapeHtml(state.toast.message)}</span></div>` : "");
  wireAfterRender();
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
        <p class="privacy-note">${icon("shield", 14)} Your health data stays on this device.</p>
      </aside>
      <div class="app-frame">
        <header class="topbar">
          <button class="mobile-brand" data-route="today" aria-label="Go home">${brand(true)}</button>
          <div class="topbar-date">${formatDate(new Date())}</div>
          <div class="topbar-actions">
            <button class="icon-button" data-action="enable-notifications" aria-label="Meal reminders">${icon("bell", 20)}<span class="notification-dot ${notificationContext().permission === "granted" ? "enabled" : ""}"></span></button>
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
  const recommendations = recommendNext(totals, target, state.profile);
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
        <aside class="card estimate-card">
          <span class="eyebrow">A better estimate</span>
          <h2>Portion is everything.</h2>
          <div class="tip-visual"><div>½</div><div class="active">1×</div><div>1½</div></div>
          <p>A photo can identify a dish, not weigh it. Confirm the serving size for a more useful calorie estimate.</p>
          <div class="trust-row">${icon("shield", 20)}<span><strong>Private by design</strong>Your photo is processed locally and is not uploaded to Noura.</span></div>
        </aside>
      </div>
    </section>`;
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
      <div class="manual-heading"><span class="manual-spark">✦</span><div><h2>Tell me naturally</h2><p>I’ll match foods and portions from our offline catalogue.</p></div></div>
      <form id="manual-form">
        <label for="meal-text">What did you eat?</label>
        <textarea id="meal-text" name="meal" rows="4" placeholder="Try “2 eggs, 1 bowl of rice and dal”" required></textarea>
        <div class="examples"><span>Try:</span><button type="button" data-example="2 eggs and a banana">2 eggs + banana</button><button type="button" data-example="1 roti, dal and salad">roti + dal + salad</button></div>
        <button class="big-submit">Estimate my meal ${icon("spark", 19)}</button>
      </form>
      ${renderPendingFoods()}
    </div>`;
  }
  return `<div class="scanner-zone">
    <div class="scanner-illustration food-illustration"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span><div>🥗</div></div>
    <h2>Point. Snap. Confirm.</h2>
    <p>The first scan downloads a ~60 MB Food‑101 model. After that, recognition is cached and runs locally.</p>
    <label class="upload-button">${icon("camera", 19)} Take or choose photo<input id="food-photo" type="file" accept="image/*" capture="environment" hidden></label>
    <span class="supported-note">Recognises 101 common dishes · manual correction always available</span>
    ${renderScanStatus()}
    ${renderScanResults()}
  </div>`;
}

function renderScanStatus() {
  if (!state.scanStatus) return "";
  return `<div class="scan-status ${state.scanStatus.kind || ""}"><span class="status-spinner"></span><div><strong>${escapeHtml(state.scanStatus.title)}</strong><span>${escapeHtml(state.scanStatus.detail || "")}</span></div>${state.scanStatus.progress != null ? `<div class="status-progress"><i style="width:${state.scanStatus.progress}%"></i></div>` : ""}</div>`;
}

function renderScanResults() {
  if (!state.scanResults.length) return "";
  return `<div class="result-panel"><span class="eyebrow">AI suggestions</span><p>Tap the closest match, then confirm its portion.</p>${state.scanResults.map((result, index) => `<button data-scan-result="${index}"><span>${result.food?.emoji || "🍽️"}</span><div><strong>${escapeHtml(result.display)}</strong><small>${Math.round(result.score * 100)}% visual match${result.food ? ` · ${result.food.kcal} kcal/serving` : " · search manually"}</small></div>${icon("arrow", 16)}</button>`).join("")}</div>`;
}

function renderPendingFoods() {
  if (!state.pendingFoods.length) return "";
  const known = state.pendingFoods.filter(item => !item.unknown);
  const unknown = state.pendingFoods.filter(item => item.unknown);
  return `<div class="pending-panel">
    <div class="card-title-row"><div><span class="eyebrow">Meal estimate</span><h3>${known.length} ${known.length === 1 ? "item" : "items"} matched</h3></div><strong>${known.reduce((sum, food) => sum + food.kcal, 0)} kcal</strong></div>
    ${known.map((food, index) => `<div class="pending-row"><span>${food.emoji}</span><div><strong>${food.name}</strong><small>${food.servings || 1} × ${food.serving}</small></div><span>${food.kcal} kcal</span><button data-remove-pending="${index}" aria-label="Remove">×</button></div>`).join("")}
    ${unknown.length ? `<p class="unknown-note">Couldn’t match: ${unknown.map(item => escapeHtml(item.name)).join(", ")}. Add those separately or try another name.</p>` : ""}
    ${known.length ? `<button class="big-submit" data-action="log-pending">Add meal to today ${icon("check", 18)}</button>` : ""}
  </div>`;
}

function renderInsights() {
  const target = targets();
  const series = chartSeries(state.logs, state.period, target);
  const activeValues = series.filter(point => point.value > 0);
  const average = activeValues.length ? Math.round(activeValues.reduce((sum, point) => sum + point.value, 0) / activeValues.length) : 0;
  const max = Math.max(target.calories * 1.25, ...series.map(point => point.value), 1);
  const streak = getStreak(state.logs);
  const onTarget = activeValues.filter(point => point.value >= target.calories * 0.85 && point.value <= target.calories * 1.1).length;
  return `<section class="page insights-page">
    <div class="page-heading"><div><span class="eyebrow">Your patterns</span><h1>Progress, without the pressure.</h1><p>Look beyond a single meal. Consistency over time is what counts.</p></div><div class="segmented-control period-control">${["week", "month", "year"].map(period => `<button class="${state.period === period ? "active" : ""}" data-period="${period}">${period[0].toUpperCase() + period.slice(1)}</button>`).join("")}</div></div>
    <div class="insight-stats">
      ${statCard("Average", average ? `${average.toLocaleString()} kcal` : "—", average ? `${average - target.calories > 0 ? "+" : ""}${average - target.calories} vs target` : "Start logging to see this", "pulse")}
      ${statCard("On-target days", `${onTarget}/${activeValues.length || series.length}`, "Within 85–110% of goal", "target")}
      ${statCard("Current streak", `${streak.current} days`, `Personal best: ${streak.best}`, "flame")}
    </div>
    <article class="card chart-card">
      <div class="card-title-row"><div><span class="eyebrow">Calories</span><h2>${state.period === "week" ? "Last 7 days" : state.period === "month" ? "Last 30 days" : "12-month average"}</h2></div><div class="chart-legend"><i></i>Your intake <span></span>Target</div></div>
      <div class="bar-chart" style="--target-pos:${Math.min(94, (target.calories / max) * 100)}%">
        <div class="target-line"><span>${target.calories}</span></div>
        ${series.map(point => `<div class="bar-column" title="${point.label}: ${point.value} kcal"><div class="bar-track"><i style="height:${Math.max(point.value ? 5 : 0, (point.value / max) * 100)}%"></i></div><span>${point.label}</span></div>`).join("")}
      </div>
      ${!activeValues.length ? `<div class="chart-empty">Your chart will come alive as you log meals.</div>` : ""}
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
  return `<section class="page profile-page">
    <div class="page-heading"><div><span class="eyebrow">Your settings</span><h1>Built around you.</h1><p>Adjust your goal, diet, targets, and meal reminders any time.</p></div></div>
    <div class="profile-grid">
      <article class="card profile-summary">
        <div class="large-avatar">${initials(state.profile.name || "You")}</div>
        <h2>${escapeHtml(state.profile.name || "Your profile")}</h2><p>${body?.name || "Balanced frame"} · ${goal?.name || "Maintain"}</p>
        <div class="profile-metrics"><span><strong>${state.profile.weight}</strong>kg</span><span><strong>${state.profile.height}</strong>cm</span><span><strong>${target.calories}</strong>kcal</span></div>
        <div class="profile-actions"><button class="outline-button" data-action="restart-onboarding">Edit my plan</button><button class="logout-button" data-action="logout">${icon("logout", 16)} Log out</button></div>
        <p class="local-session-note">Noura has no online account. Logging out clears this browser’s locally stored profile, meal history, streaks, and reminders.</p>
      </article>
      <article class="card settings-card">
        <div class="card-title-row"><div><span class="eyebrow">Meal reminders</span><h2>A gentle nudge, before you eat.</h2></div><span class="permission-badge ${notification.code}">${notification.label}</span></div>
        <p>Browser notifications are sent while Noura is open or installed and active. Exact closed-app scheduling depends on your device.</p>
        <div class="notification-guidance ${notification.code}" role="status">${icon(notification.code === "granted" ? "check" : "bell", 19)}<div><strong>${notification.title}</strong><span>${notification.message}</span></div></div>
        <div class="reminder-list">${state.reminders.map(reminder => `<label class="reminder-row"><span><strong>${reminder.label}</strong><input type="time" value="${reminder.time}" data-reminder-time="${reminder.id}"></span><input class="switch-input" type="checkbox" data-reminder-toggle="${reminder.id}" ${reminder.enabled ? "checked" : ""}><i class="switch"></i></label>`).join("")}</div>
        <button class="compact-button" data-action="enable-notifications">${icon("bell", 16)} ${notification.action}</button>
      </article>
      <article class="card diet-card">
        <span class="eyebrow">Food preference</span><h2>What works for you?</h2>
        <div class="choice-chips">${[["everything", "Everything"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"]].map(([value, label]) => `<button class="${state.profile.diet === value ? "active" : ""}" data-diet="${value}">${label}</button>`).join("")}</div>
        <p>This filters coach recommendations. It does not hide foods from manual search.</p>
      </article>
      <article class="card privacy-card">
        <div class="privacy-mark">${icon("shield", 27)}</div><div><span class="eyebrow">Local-first privacy</span><h2>Your meals stay yours.</h2><p>Profile and logs are kept in this browser’s local storage. Photos are processed on-device; barcode details come from Open Food Facts.</p><button class="danger-link" data-action="reset-data">Erase all local data</button></div>
      </article>
    </div>
  </section>`;
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
  const percentage = Math.min(100, Math.round(value / goal * 100));
  return `<div class="macro"><span><i style="background:${color}"></i>${label}</span><strong>${Math.round(value)}<small> / ${goal}g</small></strong><div><i style="width:${percentage}%;background:${color}"></i></div></div>`;
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

function wireAfterRender() {
  document.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", () => { state.route = button.dataset.route; render(); scrollTo(0, 0); }));
  document.querySelectorAll("[data-scan-mode]").forEach(button => button.addEventListener("click", () => { state.scanMode = button.dataset.scanMode; state.scanStatus = null; state.scanResults = []; state.pendingFoods = []; render(); }));
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
  document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => { const text = document.querySelector("#meal-text"); text.value = button.dataset.example; text.focus(); }));
  document.querySelectorAll("[data-scan-result]").forEach(button => button.addEventListener("click", () => chooseScanResult(Number(button.dataset.scanResult))));
  document.querySelectorAll("[data-remove-pending]").forEach(button => button.addEventListener("click", () => { state.pendingFoods.splice(Number(button.dataset.removePending), 1); render(); }));
  document.querySelector("[data-action='log-pending']")?.addEventListener("click", logPendingFoods);
  document.querySelector("[data-action='manual-focus']")?.addEventListener("click", () => { state.route = "scan"; state.scanMode = "manual"; render(); setTimeout(() => document.querySelector("#meal-text")?.focus(), 50); });
  document.querySelectorAll("[data-delete-log]").forEach(button => button.addEventListener("click", () => { state.logs = state.logs.filter(log => log.id !== button.dataset.deleteLog); persist(); showToast("Meal removed."); }));
  document.querySelectorAll("[data-quick-log]").forEach(button => button.addEventListener("click", () => addFoodLog(FOOD_LIBRARY.find(food => food.id === button.dataset.quickLog))));
  document.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => { state.period = button.dataset.period; render(); }));
  document.querySelectorAll("[data-diet]").forEach(button => button.addEventListener("click", () => { state.profile.diet = button.dataset.diet; persist(); render(); }));
  document.querySelectorAll("[data-reminder-time]").forEach(input => input.addEventListener("change", () => updateReminder(input.dataset.reminderTime, { time: input.value })));
  document.querySelectorAll("[data-reminder-toggle]").forEach(input => input.addEventListener("change", () => updateReminder(input.dataset.reminderToggle, { enabled: input.checked })));
  document.querySelectorAll("[data-action='enable-notifications']").forEach(button => button.addEventListener("click", enableNotifications));
  document.querySelector("[data-action='restart-onboarding']")?.addEventListener("click", () => { state.onboarding = { ...state.profile }; state.onboardingStep = 1; state.profile = null; render(); });
  document.querySelector("[data-action='logout']")?.addEventListener("click", logout);
  document.querySelector("[data-action='reset-data']")?.addEventListener("click", resetData);
}

async function handleFoodPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.scanResults = [];
  state.scanStatus = { title: "Preparing local AI", detail: "The first scan may take a minute.", progress: 2 };
  render();
  try {
    const { classifyFoodImage } = await import("./food-ai.js");
    const results = await classifyFoodImage(file, (progress, title) => {
      state.scanStatus = { title, detail: progress < 100 ? `${progress}% downloaded` : "Your photo never leaves this device.", progress };
      render();
    });
    state.scanResults = results.map(result => {
      const display = result.label.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
      return { ...result, display, food: findFood(result.label) || findFood(display) };
    });
    state.scanStatus = { title: "Scan complete", detail: "Choose the closest match below.", kind: "success" };
  } catch (error) {
    state.scanStatus = { title: "Local AI couldn’t start", detail: friendlyError(error), kind: "error" };
  }
  render();
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

function handleManualMeal(event) {
  event.preventDefault();
  const result = parseMealText(new FormData(event.currentTarget).get("meal"));
  state.pendingFoods = [...result.matched, ...result.unknown.map(name => ({ unknown: true, name }))];
  render();
}

function chooseScanResult(index) {
  const result = state.scanResults[index];
  if (!result?.food) {
    state.scanMode = "manual";
    state.pendingFoods = [{ unknown: true, name: result?.display || "Unknown food" }];
  } else {
    state.pendingFoods = [scaleFood(result.food, 1)];
    state.scanMode = "manual";
  }
  render();
}

function logPendingFoods() {
  const foods = state.pendingFoods.filter(item => !item.unknown);
  foods.forEach(addFoodLog);
  state.pendingFoods = [];
  state.scanResults = [];
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
    meal: mealTypeForTime(now), at: now.toISOString(), source: food.source || "catalogue"
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
    await sendNotification("Noura reminders are on", "This test worked. I’ll gently remind you around your chosen meal times.");
    showToast(status.code === "granted" ? "Test notification sent." : "Meal reminders are enabled and the test was sent.");
  } catch (error) {
    showToast(`Noura could not send the test: ${friendlyError(error)}`, "error");
  }
}

function updateReminder(id, changes) {
  state.reminders = state.reminders.map(reminder => reminder.id === id ? { ...reminder, ...changes } : reminder);
  persist();
}

async function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !state.profile) return;
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
  if (registration) return registration.showNotification(title, { body, icon: assetUrl("icon.svg"), badge: assetUrl("icon.svg"), tag: "noura-meal" });
  return new Notification(title, { body, icon: assetUrl("icon.svg") });
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register(assetUrl("sw.js"));
  if (registration.active) return registration;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("The reminder service did not become ready. Reload Noura and try again.")), 7000))
  ]);
}

function notificationContext() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  return {
    supported: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported",
    secureContext: window.isSecureContext,
    isIOS,
    isStandalone
  };
}

function clearNouraData() {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key === STORAGE_KEY || key?.startsWith("noura-reminded-")) localStorage.removeItem(key);
  }
  state = structuredClone(defaults);
}

function logout() {
  if (!confirm("Log out of Noura on this device? Because Noura is local-only, this will clear your profile, meal history, streaks, and reminders from this browser.")) return;
  clearNouraData();
  render();
}

function resetData() {
  if (!confirm("Erase your profile, meal history, streaks, and reminder settings from this browser?")) return;
  clearNouraData();
  render();
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

function initials(name) {
  return name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
}

function friendlyError(error) {
  const message = error?.message || "Please try again.";
  if (/fetch|network|load/i.test(message)) return "The model or nutrition database could not be reached. Check your connection, then retry.";
  return message;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function icon(name, size = 20) {
  const paths = {
    leaf: '<path d="M18.7 3.8C12.7 3.9 7.6 6.5 6.3 11.4c-.7 2.7.6 5.3 3 6.2 3.8 1.3 7.5-1.9 8.3-5.7.4-2 .5-5 .1-7.1M5 20c1.8-5.4 5.3-8.8 10.6-11.3"/>', logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
    home: '<path d="m3 10 9-7 9 7v10h-6v-6H9v6H3Z"/>', scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8"/>', chart: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>', spark: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5ZM19 3v4M21 5h-4"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-4.2 3.2-6 8-6s7.4 1.8 8 6"/>', bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', shield: '<path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6Z"/><path d="m9 12 2 2 4-4"/>', type: '<path d="M5 5h14M12 5v14M8 19h8"/>', barcode: '<path d="M4 5v14M7 5v14M11 5v14M13 5v14M17 5v14M20 5v14"/>', camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4Z"/><circle cx="12" cy="13" r="4"/>', check: '<path d="m5 12 4 4L19 6"/>', back: '<path d="m15 18-6-6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', plate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>', pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', flame: '<path d="M12 21c4 0 7-2.8 7-6.5 0-3-1.7-5.7-5.2-8.5.1 2.5-.7 4-2 4.8.1-3.1-1.4-5.7-4-7.8.1 4-3 6.6-3 11.5C4.8 18.2 8 21 12 21Z"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

if ("serviceWorker" in navigator) window.addEventListener("load", () => ensureServiceWorker().catch(() => {}));
setInterval(checkReminders, 30000);
render();
