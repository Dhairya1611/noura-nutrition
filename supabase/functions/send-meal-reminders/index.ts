import { createClient } from "npm:@supabase/supabase-js@2.76.1";
import webPush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const required = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

type SubscriptionRow = {
  id?: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type DueReminder = SubscriptionRow & {
  delivery_id: number;
  subscription_id: number;
  user_id: string;
  reminder_id: string;
  reminder_label: string;
  scheduled_for: string;
};

function pushPayload(reminder?: DueReminder) {
  const label = reminder?.reminder_label?.toLowerCase() || "your meal";
  return JSON.stringify({
    title: reminder ? `Before ${label}…` : "Noura server test",
    body: reminder ? "Take a quick photo or tell Noura what’s on your plate." : "Closed-app reminders are connected on this device.",
    tag: reminder ? `noura-${reminder.reminder_id}-${reminder.scheduled_for.slice(0, 10)}` : "noura-push-test",
    url: "https://dhairya1611.github.io/noura-nutrition/"
  });
}

async function deliver(subscription: SubscriptionRow, payload: string) {
  return webPush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth }
  }, payload, { TTL: 600, urgency: "normal" });
}

function statusCode(error: unknown) {
  return Number((error as { statusCode?: number })?.statusCode || 0);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = required("SUPABASE_URL");
    const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = required("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = required("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT")?.trim() || "mailto:kukrejadhairya@gmail.com";
    const cronSecret = required("CRON_SECRET");
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const body = await request.json().catch(() => ({}));

    if (body?.mode === "test") {
      const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ ok: false, error: "Authentication is required" }, 401);
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return json({ ok: false, error: "Authentication is invalid" }, 401);
      const endpoint = String(body?.endpoint || "");
      const { data: subscription, error: subscriptionError } = await admin
        .from("noura_push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", authData.user.id)
        .eq("endpoint", endpoint)
        .eq("enabled", true)
        .maybeSingle();
      if (subscriptionError) throw subscriptionError;
      if (!subscription) return json({ ok: false, error: "This device is not registered" }, 404);
      try {
        await deliver(subscription, pushPayload());
      } catch (error) {
        if ([404, 410].includes(statusCode(error))) {
          await admin.from("noura_push_subscriptions").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", subscription.id);
        }
        throw error;
      }
      return json({ ok: true, sent: 1 });
    }

    if (request.headers.get("x-cron-secret") !== cronSecret) {
      return json({ ok: false, error: "Scheduled-call authentication failed" }, 401);
    }

    const { data, error } = await admin.rpc("claim_noura_due_reminders");
    if (error) throw error;
    const reminders = (data || []) as DueReminder[];
    let sent = 0;
    let expired = 0;
    let retryable = 0;

    for (const reminder of reminders) {
      try {
        await deliver(reminder, pushPayload(reminder));
        sent += 1;
        await admin.from("noura_push_deliveries").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null
        }).eq("id", reminder.delivery_id);
      } catch (pushError) {
        const code = statusCode(pushError);
        if ([404, 410].includes(code)) {
          expired += 1;
          await admin.from("noura_push_subscriptions").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", reminder.subscription_id);
          await admin.from("noura_push_deliveries").update({
            status: "failed",
            last_error: `Push endpoint expired (${code})`,
            updated_at: new Date().toISOString()
          }).eq("id", reminder.delivery_id);
        } else {
          retryable += 1;
          await admin.from("noura_push_deliveries").delete().eq("id", reminder.delivery_id);
        }
      }
    }

    return json({ ok: true, claimed: reminders.length, sent, expired, retryable });
  } catch (error) {
    console.error("Noura push sender failed", error instanceof Error ? error.message : "Unknown error");
    return json({ ok: false, error: "The reminder sender could not complete this run" }, 500);
  }
});

