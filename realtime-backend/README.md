# Realtime Backend

Backend WebSocket pour l'extension Chrome:

- recoit les chunks audio (`mic` et `tab`)
- envoie les flux a Deepgram (streaming transcription)
- produit des insights en temps reel (heuristiques + Groq)
- renvoie les mises a jour a l'overlay extension

## Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Variables:

- `PORT`
- `DEEPGRAM_API_KEY`
- `GROQ_API_KEY`
- `GROQ_MODEL`
