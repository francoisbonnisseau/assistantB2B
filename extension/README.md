# B2B Realtime Coach Extension

Extension Chrome MV3 pour coaching commercial en temps reel.

## Fonctions V1

- Login client via Edge Function Supabase
- Recuperation prompts par type de meeting
- Selection du meeting type dans le popup
- Overlay live sur Google Meet / Zoom web / Teams
- Ingestion audio micro + onglet vers backend websocket
- Affichage insights: talk/listen, objections, battle cards, qualification, next steps

## Setup

```bash
pnpm install
cp .env.example .env
pnpm build
```

Variables `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BACKEND_WS_URL`

## Charger l'extension

1. Ouvre `chrome://extensions`
2. Active Developer mode
3. Load unpacked
4. Selectionne `extension/dist`

## Fichiers principaux

- `src/App.jsx` popup React (login + meeting type + start/stop)
- `src/background.js` orchestration session + websocket + offscreen capture
- `src/content.js` overlay injecte sur la whitelist
- `public/offscreen.js` capture audio micro/tab dans document offscreen
