# Noura Nutrition

Noura is a local-first progressive web app for food recognition, calorie and macro tracking, streaks, nutrition insights, reminders, and next-meal recommendations.

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
