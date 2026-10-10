import { createClient } from "@supabase/supabase-js";

const env = import.meta.env || {};
const supabaseUrl = String(env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(env.VITE_SUPABASE_ANON_KEY || "").trim();

export const cloudConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const client = cloudConfigured ? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
}) : null;

function requireClient() {
  if (!client) throw new Error("Noura Cloud has not been configured yet.");
  return client;
}

export async function getCloudSession() {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onCloudAuthChange(callback) {
  return requireClient().auth.onAuthStateChange((event, session) => callback(event, session));
}

export async function createAccount(email, password) {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.href.split("#")[0].split("?")[0] }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const redirectTo = window.location.href.split("#")[0].split("?")[0];
  const { error } = await requireClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { error } = await requireClient().auth.updateUser({ password });
  if (error) throw error;
}

export async function fetchCloudState(userId) {
  const { data, error } = await requireClient()
    .from("noura_user_data")
    .select("profile, logs, reminders, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCloudState(userId, value) {
  const { data, error } = await requireClient()
    .from("noura_user_data")
    .upsert({
      user_id: userId,
      profile: value.profile,
      logs: value.logs,
      reminders: value.reminders
    }, { onConflict: "user_id" })
    .select("updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCloudState(userId) {
  const { error } = await requireClient().from("noura_user_data").delete().eq("user_id", userId);
  if (error) throw error;
}
