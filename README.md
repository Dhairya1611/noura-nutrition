# Noura Nutrition

Noura is an account-synced progressive web app for food recognition, calorie and macro tracking, streaks, nutrition insights, reminders, and next-meal recommendations.

## Accounts and permanent storage

- Supabase Auth provides Google OAuth plus email/password sign-up, login, logout, and password recovery.
- Each user’s profile, meal history, and reminder settings are stored in the `noura_user_data` Postgres table.
- Row-level security restricts every record to its authenticated owner; anonymous users cannot read or write nutrition records.
- Browser storage is retained only as a fast local cache. Existing pre-account data is migrated into the first account that signs in on that browser.
- Food photos are processed on-device and are not uploaded to Supabase.

Create a Supabase project, run [`supabase/migrations/202610100001_noura_user_data.sql`](supabase/migrations/202610100001_noura_user_data.sql) in its SQL editor, and copy `.env.example` to `.env.local` with the project URL and publishable anon key. Never expose a Supabase service-role key in the frontend.

## Closed-app meal reminders

Noura uses standards-based Web Push so a connected browser or installed PWA can receive meal reminders after the app is closed. The browser subscription is stored per user with row-level security, the device timezone keeps meal times local, and a Supabase Cron job invokes the `send-meal-reminders` Edge Function every minute. Delivery claims prevent duplicate reminders.

1. Apply [`supabase/migrations/202610130001_noura_web_push.sql`](supabase/migrations/202610130001_noura_web_push.sql).
2. Deploy `supabase/functions/send-meal-reminders` with JWT verification disabled; the function authenticates scheduled calls with `CRON_SECRET` and user tests with the signed-in user token.
3. Set the Edge Function secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `CRON_SECRET`. The public key must also be the GitHub Actions variable `VITE_VAPID_PUBLIC_KEY`.
4. In Supabase Vault, create `noura_project_url` and `noura_cron_secret`, then schedule the `noura-send-meal-reminders` job using the SQL example at the end of the migration.

The private VAPID key and cron secret belong only in Supabase secrets/Vault. Never commit them or expose them to the frontend.

For Google sign-in, create a Google Cloud Web OAuth client with `https://dhairya1611.github.io` as an authorized JavaScript origin and `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. Enable Google in Supabase Authentication Providers with that client ID and secret, and keep the secret in Supabase only—never in GitHub or frontend code.

## Free AI stack

- Food-photo recognition runs in the browser using Transformers.js and the quantized `onnx-community/swin-finetuned-food101-ONNX` model.
- Packaged-food nutrition comes from the free Open Food Facts API.
- Manual meal understanding, scoring, and recommendations run locally from a bundled nutrition catalogue and deterministic rules.

The first photo scan downloads roughly 60 MB of model data, which the browser can cache. A food photo can identify a likely dish but cannot infer exact ingredients or portion weight, so users always confirm an estimate.

## Local development

```sh
npm install
npm run dev
```

## Checks

```sh
npm test
npm run build
```

## Deployment

Pushes to `main` are tested, built with the `/noura-nutrition/` base path, and deployed automatically through GitHub Actions to GitHub Pages.

The repository must define the GitHub Actions variables `VITE_SUPABASE_URL` and `VITE_VAPID_PUBLIC_KEY`, plus the secret `VITE_SUPABASE_ANON_KEY`. Supabase Authentication should allow `https://dhairya1611.github.io/noura-nutrition/` as a redirect URL.
