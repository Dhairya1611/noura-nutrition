export function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
}

export function pushSubscriptionRecord(subscription, timezone, userAgent = "") {
  const value = subscription?.toJSON?.() || subscription;
  if (!value?.endpoint || !value?.keys?.p256dh || !value?.keys?.auth) {
    throw new Error("The browser did not return a complete push subscription.");
  }
  return {
    endpoint: value.endpoint,
    p256dh: value.keys.p256dh,
    auth: value.keys.auth,
    timezone: timezone || "UTC",
    userAgent: String(userAgent).slice(0, 500)
  };
}

export function applicationServerKeyMatches(subscription, publicKey) {
  const existing = subscription?.options?.applicationServerKey;
  if (!existing) return true;
  const bytes = new Uint8Array(existing);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === publicKey.replace(/=+$/, "");
}

export function currentTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function pushIsSupported(scope = globalThis) {
  return Boolean(scope?.isSecureContext && scope?.navigator?.serviceWorker && scope?.PushManager && scope?.Notification);
}
