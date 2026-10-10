# Noura Nutrition

Noura is an account-synced progressive web app for food recognition, calorie and macro tracking, streaks, nutrition insights, reminders, and next-meal recommendations.

## Accounts and permanent storage

- Supabase Auth provides email/password sign-up, login, logout, and password recovery.
- Each user’s profile, meal history, and reminder settings are stored in the `noura_user_data` Postgres table.
- Row-level security restricts every record to its authenticated owner; anonymous users cannot read or write nutrition records.
- Browser storage is retained only as a fast local cache. Existing pre-account data is migrated into the first account that signs in on that browser.
- Food photos are processed on-device and are not uploaded to Supabase.

Create a Supabase project, run [`supabase/migrations/202610100001_noura_user_data.sql`](supabase/migrations/202610100001_noura_user_data.sql) in its SQL editor, and copy `.env.example` to `.env.local` with the project URL and publishable anon key. Never expose a Supabase service-role key in the frontend.

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

The repository must define the GitHub Actions variable `VITE_SUPABASE_URL` and secret `VITE_SUPABASE_ANON_KEY`. Supabase Authentication should allow `https://dhairya1611.github.io/noura-nutrition/` as a redirect URL.
