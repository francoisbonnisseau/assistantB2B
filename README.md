# B2B Realtime Coach — Documentation technique complète

Assistant commercial en temps réel : transcription audio, détection d'objections, battle cards, scoring MEDDIC/BANT/SPICED et suggestions IA pendant les calls Google Meet / Zoom / Teams.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture globale](#2-architecture-globale)
3. [Structure du dépôt](#3-structure-du-dépôt)
4. [Sous-projet : extension/](#4-sous-projet--extension)
5. [Sous-projet : realtime-backend/](#5-sous-projet--realtime-backend)
6. [Sous-projet : dashboard/](#6-sous-projet--dashboard)
7. [Base de données Supabase](#7-base-de-données-supabase)
8. [Edge Functions Supabase](#8-edge-functions-supabase)
9. [Prompts — comment ça marche](#9-prompts--comment-ça-marche)
10. [Variables d'environnement](#10-variables-denvironnement)
11. [Installation et démarrage](#11-installation-et-démarrage)
12. [Chargement de l'extension dans Chrome](#12-chargement-de-lextension-dans-chrome)
13. [Flux de données complet](#13-flux-de-données-complet)
14. [Ce qui est modifiable facilement](#14-ce-qui-est-modifiable-facilement)
15. [Limitations et points d'attention](#15-limitations-et-points-dattention)

---

## 1. Vue d'ensemble

Le projet se compose de **trois sous-projets indépendants** :

| Sous-projet | Rôle | Stack |
|---|---|---|
| `extension/` | Chrome MV3 — UI coaching + capture audio | React 19, Vite 7, Tailwind CSS v4, CRXJS |
| `realtime-backend/` | Serveur WebSocket — transcription + analyse IA | Node.js ESM, ws, Deepgram, Groq |
| `dashboard/` | Interface d'administration | React 19, Vite 7, Tailwind CSS v3, Supabase JS |

**Package manager partout : `pnpm`**. Chaque sous-projet a son propre `pnpm install`.

---

## 2. Architecture globale

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                          │
│                                                                  │
│  ┌──────────┐   popup   ┌────────────────────────────────────┐  │
│  │ App.jsx  │──────────▶│         SidePanel.jsx               │  │
│  │ (popup)  │           │  - Auth (login/logout)              │  │
│  └──────────┘           │  - Sélection type meeting           │  │
│                         │  - Start/Stop coaching              │  │
│  ┌──────────────────┐   │  - Tab audio capture (tabCapture)   │  │
│  │  content.jsx     │   │  - Affichage insights complets      │  │
│  │  (overlay DOM)   │◀──│                                     │  │
│  │  1 suggestion    │   └───────────────┬────────────────────┘  │
│  │  1 objection     │                   │ chrome.runtime         │
│  └──────────────────┘                   │ messages               │
│                                         ▼                        │
│                         ┌──────────────────────────────────┐    │
│                         │       background.js               │    │
│                         │  (Service Worker MV3)             │    │
│                         │  - Gère le WebSocket              │    │
│                         │  - Route les messages             │    │
│                         │  - Relaie audio tab → WS          │    │
│                         └──────────┬───────────────────────┘    │
│                                    │                              │
│  ┌──────────────────┐              │ chrome.runtime               │
│  │  offscreen.js    │◀─────────────┘                              │
│  │  (Offscreen Doc) │                                             │
│  │  - Mic capture   │                                             │
│  │    getUserMedia  │                                             │
│  └──────┬───────────┘                                            │
└─────────┼───────────────────────────────────────────────────────┘
          │ Audio PCM base64
          │ WebSocket ws://localhost:8788
          ▼
┌─────────────────────────────────┐
│     realtime-backend/           │
│     src/server.js               │
│                                 │
│  ┌──────────┐  ┌─────────────┐  │
│  │ Deepgram │  │    Groq     │  │
│  │ nova-2   │  │ llama-3.3   │  │
│  │ (STT FR) │  │ -70b        │  │
│  └────┬─────┘  └──────┬──────┘  │
│       │ transcripts   │ insights│
│       └───────────────┘         │
│             INSIGHT_UPDATE →    │
└─────────────────────────────────┘
          ▲
          │ JWT + fetch
          │
┌─────────────────────────────────┐
│   Supabase                      │
│   - Edge Function client-login  │
│   - Edge Function client-config │
│   - Table clients               │
│   - Table meeting_types         │
│   - Table client_prompts        │
└─────────────────────────────────┘
          ▲
          │ Supabase Auth + JS SDK
          │
┌─────────────────────────────────┐
│   dashboard/                    │
│   (Admin SPA)                   │
│   - Gestion clients             │
│   - Gestion types de meeting    │
│   - Gestion prompts par client  │
└─────────────────────────────────┘
```

---

## 3. Structure du dépôt

```
assistantB2B/
├── extension/                        # Chrome MV3 extension
│   ├── manifest.config.js            # Manifest MV3 (permissions, content scripts)
│   ├── vite.config.js                # Build config (Tailwind v4, CRXJS, @ alias)
│   ├── jsconfig.json                 # Path alias @ → ./src/
│   ├── components.json               # Shadcn/ui config
│   ├── index.html                    # Popup HTML entry
│   ├── sidepanel.html                # Side panel HTML entry
│   ├── offscreen.html                # Offscreen document HTML
│   ├── package.json
│   ├── .env                          # Variables d'env (non committé)
│   └── src/
│       ├── config.js                 # Lecture des VITE_* env vars + isAllowedMeetingUrl()
│       ├── main.jsx                  # Entry popup (monte App)
│       ├── sidepanel-main.jsx        # Entry side panel (monte SidePanel)
│       ├── App.jsx                   # Popup : bouton ouvrir side panel
│       ├── SidePanel.jsx             # UI coaching complète + tab audio capture
│       ├── content.jsx               # Overlay minimaliste (Shadow DOM) : 1 suggestion + 1 objection
│       ├── background.js             # Service worker : WS, routing messages, offscreen
│       ├── globals.css               # Tailwind v4 + shadcn CSS variables (primary = teal)
│       ├── lib/
│       │   └── utils.js              # cn() helper (clsx + tailwind-merge)
│       ├── components/
│       │   └── ui/
│       │       ├── button.jsx        # shadcn Button (CVA variants)
│       │       ├── badge.jsx         # shadcn Badge (default/secondary/destructive/warning/success)
│       │       ├── card.jsx          # shadcn Card, CardHeader, CardTitle, CardContent
│       │       ├── progress.jsx      # shadcn Progress (Radix UI)
│       │       ├── scroll-area.jsx   # shadcn ScrollArea (Radix UI)
│       │       └── separator.jsx     # shadcn Separator (Radix UI)
│       └── services/
│           ├── edgeApi.js            # loginClient() + fetchClientConfig() → Edge Functions
│           └── storage.js            # Session JWT dans chrome.storage.local
│   └── public/
│       ├── offscreen.js              # Capture micro (getUserMedia) dans le doc offscreen
│       ├── pcm-processor.js          # AudioWorklet (non utilisé actuellement)
│       └── microphone-permission.js  # Page ouverte à l'install pour autoriser le micro
│
├── realtime-backend/                 # Serveur WebSocket Node.js
│   ├── package.json
│   ├── .env                          # Variables d'env (non committé)
│   └── src/
│       └── server.js                 # Tout le serveur : WS, Deepgram, Groq, analyse IA
│
├── dashboard/                        # Admin SPA
│   ├── package.json
│   ├── vite.config.js
│   ├── .env                          # Variables d'env (non committé)
│   ├── src/
│   │   ├── App.jsx                   # Router + auth guard
│   │   ├── services/
│   │   │   ├── supabaseClient.js     # Instance Supabase JS SDK
│   │   │   ├── adminApi.js           # Gestion des admin_users
│   │   │   ├── clientsApi.js         # CRUD clients
│   │   │   ├── meetingTypesApi.js    # CRUD meeting_types
│   │   │   └── clientPromptsApi.js   # CRUD client_prompts (prompts IA)
│   │   └── utils/
│   │       ├── auth.js               # Helpers auth Supabase
│   │       └── validators.js         # Zod schemas
│   └── supabase/
│       ├── functions/
│       │   ├── client-login/
│       │   │   └── index.ts          # POST /functions/v1/client-login
│       │   └── client-config/
│       │       └── index.ts          # POST /functions/v1/client-config
│       └── migrations/
│           ├── 20260213130000_init_admin_dashboard.sql   # Schéma complet + RLS
│           └── 20260213133000_fix_set_updated_at_search_path.sql  # Fix sécurité trigger
│
└── README.md                         # Ce fichier
```

---

## 4. Sous-projet : extension/

### Permissions Chrome (manifest.config.js)

```js
permissions: ['storage', 'tabs', 'tabCapture', 'offscreen', 'activeTab', 'scripting', 'sidePanel']
host_permissions: [
  'https://meet.google.com/*',
  'https://*.zoom.us/*',
  'https://teams.microsoft.com/*',
  'https://*.supabase.co/*',    // pour les Edge Functions
]
```

Le content script est injecté **uniquement** sur Meet, Zoom et Teams (pas YouTube). Le `background.js` accepte YouTube comme onglet valide pour le tab capture (via `isAllowedMeetingUrl` dans `config.js`).

### Capture audio

Deux flux audio en parallèle, traités identiquement :

| Source | Où | API |
|---|---|---|
| `mic` | `public/offscreen.js` (Offscreen Document) | `getUserMedia({ audio: true })` |
| `tab` | `src/SidePanel.jsx` | `chrome.tabCapture.capture({ audio: true })` |

Pipeline de traitement :
1. `ScriptProcessorNode` (4096 samples buffer)
2. Downsampling vers 16 kHz (interpolation linéaire)
3. Float32 → Int16 PCM
4. Int16 → base64
5. `chrome.runtime.sendMessage({ type: 'SIDEPANEL_TAB_AUDIO_CHUNK' | 'OFFSCREEN_AUDIO_CHUNK' })`
6. `background.js` relaie vers le WebSocket comme `AUDIO_CHUNK`

> **Note :** `public/pcm-processor.js` (AudioWorklet) existe mais n'est pas branché. L'approche `ScriptProcessorNode` est utilisée à la place.

### Messages entre composants

```
SidePanel → background :  START_COACHING, STOP_COACHING, SIDEPANEL_TAB_AUDIO_CHUNK
background → SidePanel :  SIDEPANEL_INSIGHT_UPDATE, SIDEPANEL_TRANSCRIPT_UPDATE, SIDEPANEL_COACHING_STOPPED
background → offscreen :  OFFSCREEN_START_MIC, OFFSCREEN_STOP_MIC
offscreen → background :  OFFSCREEN_AUDIO_CHUNK
content → background :    B2B_COACH_PING, REQUEST_CONTENT_STATE
background → content :    COACHING_STATE (patch de l'état complet)
```

### UI — shadcn/ui + Tailwind CSS v4

- Composants dans `src/components/ui/` — écrits manuellement en `.jsx` (pas TypeScript)
- Couleur primaire : teal `hsl(173 80% 26%)` — modifiable dans `src/globals.css` (variable `--primary`)
- Alias `@` → `./src/` configuré dans `vite.config.js` et `jsconfig.json`
- CSS entry point unique : `src/globals.css` (remplace les anciens `index.css` et `sidepanel.css`)

Pour changer la couleur primaire, modifier dans `src/globals.css` :
```css
--primary: 173 80% 26%;         /* teal — changer ici */
--primary-foreground: 0 0% 98%;
```

### Overlay (content.jsx)

L'overlay utilise **Shadow DOM** (`mode: open`) — les styles Tailwind ne fonctionnent **pas** à l'intérieur. Tout le style est en CSS inline injecté dans le Shadow DOM via la constante `INLINE_CSS`.

L'overlay affiche au maximum :
- 1 suggestion (puce teal, `#14b8a6`)
- 1 objection (puce ambre, `#f59e0b`)

Il est invisible si `status !== 'running'` ou si les deux champs sont vides.

Pour modifier l'apparence de l'overlay, éditer la constante `INLINE_CSS` dans `src/content.jsx`.

### Build

```bash
cd extension
pnpm install
pnpm run build       # → dist/
pnpm run dev         # build watch + HMR (extensions Chrome uniquement)
```

Le dossier `dist/` est ce qu'on charge dans Chrome.

---

## 5. Sous-projet : realtime-backend/

### Démarrage

```bash
cd realtime-backend
pnpm install
cp .env.example .env   # puis remplir les clés
pnpm run dev           # node --watch (redémarre automatiquement)
pnpm run start         # production
```

Le serveur écoute sur `ws://localhost:8788` par défaut (variable `PORT`).

### Protocole WebSocket

#### Extension → Backend

| Type | Payload | Description |
|---|---|---|
| `START_SESSION` | `{ accessToken, meetingType, description, sources, startedAt }` | Démarre une session, ouvre les sockets Deepgram |
| `AUDIO_CHUNK` | `{ source: 'mic'|'tab', chunk: string (base64), ts: number }` | Chunk PCM 16 kHz Int16 |

#### Backend → Extension

| Type | Payload | Description |
|---|---|---|
| `TRANSCRIPT_UPDATE` | `{ source, text, isFinal }` | Transcription Deepgram (partielle ou finale) |
| `INSIGHT_UPDATE` | voir ci-dessous | Résultat analyse Groq |

#### Structure INSIGHT_UPDATE payload

```json
{
  "status": "running",
  "talkRatio": { "seller": 60, "buyer": 40 },
  "suggestions": [
    { "title": "...", "keyPoints": ["...", "..."] }
  ],
  "objections": [
    { "title": "Objection détectée", "keyPoints": ["Réponse 1", "Réponse 2"] }
  ],
  "battleCards": [
    { "title": "Concurrent mentionné", "keyPoints": ["Arg différenciant", "Question piège"] }
  ],
  "frameworkScores": { "meddic": 75, "bant": 50, "spiced": 30 },
  "missingSignals": ["Décideur final non identifié"],
  "nextStepAlerts": ["Tu n'as pas verrouillé de next step concret."]
}
```

### Pipeline d'analyse IA

```
Transcript Deepgram (finale)
        ↓
session.transcript[]   (toutes les utterances, accumulées)
        ↓
pushInsights()         (appelé à chaque transcript)
        ↓
  ┌─────────────────────────────────────────┐
  │  Cooldown 10s écoulé ?                  │
  │  Oui → generateGroqInsights()           │
  │         → stocké dans session.lastInsights │
  │  Non → réutilise session.lastInsights   │
  └─────────────────────────────────────────┘
        ↓
  INSIGHT_UPDATE envoyé à l'extension
```

### Paramètres modifiables dans server.js

| Constante | Ligne | Valeur | Description |
|---|---|---|---|
| `PORT` | 6 | `8788` | Port WebSocket (override via `process.env.PORT`) |
| `GROQ_MODEL` | 9 | `llama-3.3-70b-versatile` | Modèle Groq (override via `GROQ_MODEL` env var) |
| `LLM_COOLDOWN_MS` | 12 | `10_000` | Fréquence d'analyse LLM en ms |
| `buildTranscriptText` utterances limit | ~130 | `200` | Nb max d'utterances envoyées à Groq |

### Deepgram config

Modifiable dans `createDeepgramLiveSocket()` :

```js
model: 'nova-2',       // modèle STT
language: 'fr',        // langue — changer ici pour anglais : 'en-US'
smart_format: true,
punctuate: true,
interim_results: true,
encoding: 'linear16',
sample_rate: 16000,
```

---

## 6. Sous-projet : dashboard/

Interface d'administration React. Gère :
- Les **admins** (whitelist `admin_users` liée à Supabase Auth)
- Les **clients** (username, password hashé bcrypt, metadata)
- Les **types de meeting** (code, label, is_active)
- Les **prompts** par client × type de meeting

### Démarrage

```bash
cd dashboard
pnpm install
cp .env.example .env   # remplir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
pnpm run dev
pnpm run build
```

### Authentification admin

L'admin se connecte avec **Supabase Auth** (email/password standard). Après connexion, le dashboard vérifie que le `user_id` est dans la table `admin_users`. Si ce n'est pas le cas, l'accès est refusé.

**Pour créer un premier admin :**
1. Créer le compte via Supabase Auth (dashboard Supabase → Authentication → Users → Invite)
2. Copier le `user_id` généré
3. Insérer dans la table `admin_users` :
```sql
INSERT INTO public.admin_users (user_id) VALUES ('<uuid>');
```

### Gestion des clients

Un client = un commercial ou une équipe qui utilise l'extension.

Champs importants dans `clients` :
- `username` — identifiant de connexion dans l'extension
- `password_hash` — hash bcrypt du mot de passe (généré dans le dashboard)
- `is_active` — désactiver sans supprimer
- `metadata` — JSON `{ company, name, description }` — `description` est injecté dans chaque analyse Groq

### Gestion des types de meeting

Les types de meeting sont **globaux** (partagés entre tous les clients). Chaque type a :
- `code` — identifiant technique (`meeting_vente`, `discovery_call`, etc.)
- `label` — nom affiché dans l'extension
- `is_active` — masquer sans supprimer

Un client ne voit dans l'extension que les types de meeting pour lesquels il a un prompt configuré **ET** dont `is_active = true`.

---

## 7. Base de données Supabase

### Schéma

```sql
-- Admins (liés à Supabase Auth)
public.admin_users (
  user_id uuid PK → auth.users(id),
  created_at timestamptz
)

-- Clients (commerciaux)
public.clients (
  id uuid PK,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,           -- bcrypt
  is_active boolean DEFAULT true,
  metadata jsonb DEFAULT '{"company":"","name":"","description":""}',
  created_at, updated_at timestamptz
)

-- Types de meeting (globaux)
public.meeting_types (
  id uuid PK,
  code text UNIQUE NOT NULL,             -- ex: "discovery_call"
  label text NOT NULL,                   -- ex: "Discovery Call"
  is_active boolean DEFAULT true,
  created_at, updated_at timestamptz
)

-- Prompts IA par client × type de meeting
public.client_prompts (
  id uuid PK,
  client_id uuid → clients(id) CASCADE,
  meeting_type_id uuid → meeting_types(id) CASCADE,
  prompt text NOT NULL,                  -- instructions pour Groq
  created_at, updated_at timestamptz,
  UNIQUE (client_id, meeting_type_id)    -- 1 prompt max par combinaison
)
```

### RLS (Row Level Security)

Toutes les tables ont RLS activé. Seuls les admins (vérifiés via `is_admin_user()`) peuvent lire/écrire. Les Edge Functions utilisent la `service_role_key` pour bypasser le RLS.

```sql
-- Fonction helper (security definer)
CREATE FUNCTION public.is_admin_user() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
```

### Migrations

Les migrations sont dans `dashboard/supabase/migrations/`. Elles sont appliquées via la CLI Supabase :

```bash
# Depuis dashboard/
supabase db push         # applique les migrations sur le projet Supabase distant
supabase migration new <nom>   # crée une nouvelle migration
```

Les migrations existantes :
1. `20260213130000_init_admin_dashboard.sql` — schéma complet initial
2. `20260213133000_fix_set_updated_at_search_path.sql` — correction sécurité du trigger `set_updated_at`

---

## 8. Edge Functions Supabase

Déployées dans Supabase (Deno runtime). Deux fonctions :

### `POST /functions/v1/client-login`

Authentifie un client (extension) et retourne un JWT custom.

**Corps de la requête :**
```json
{ "username": "Jordan", "password": "motdepasse" }
```

**Réponse :**
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "expires_at": "2026-02-25T...",
  "client_id": "<uuid>"
}
```

**Secrets requis (à configurer dans Supabase → Edge Functions → Secrets) :**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_JWT_SECRET` — chaîne secrète arbitraire pour signer les JWT clients (≥ 32 caractères recommandé)

**Algorithme JWT :** HS256, expiration 7 jours.

### `POST /functions/v1/client-config`

Retourne la configuration complète du client (meeting types + prompts) à partir du JWT.

**Header requis :** `Authorization: Bearer <jwt>`

**Réponse :**
```json
{
  "username": "Jordan",
  "clientName": "Jordan Dupont",
  "description": "Vend un SaaS RH aux PME de 50-500 salariés.",
  "meetingTypes": [
    {
      "id": "<uuid>",
      "code": "discovery_call",
      "label": "Discovery Call",
      "prompt": "Instructions IA complètes pour ce type de meeting..."
    }
  ]
}
```

Seuls les meeting types avec `is_active = true` ET un prompt configuré pour ce client sont retournés.

### Déployer les Edge Functions

```bash
# Depuis la racine du projet (CLI Supabase installée)
supabase functions deploy client-login --project-ref <ref>
supabase functions deploy client-config --project-ref <ref>
```

---

## 9. Prompts — comment ça marche

### Flux complet

```
Dashboard (admin rédige le prompt)
  → table client_prompts (Supabase)
  → Edge Function client-config (retourne le prompt au login)
  → SidePanel.jsx (stocké dans config.meetingTypes[].prompt)
  → background.js (transmis dans START_SESSION au backend WS)
  → server.js session.prompt (injecté dans chaque appel Groq)
```

### Ce que Groq reçoit à chaque analyse

**System prompt** (hardcodé dans `server.js`) :
- Définit le rôle du coach sales B2B
- Définit la structure JSON attendue en sortie
- Définit les règles de remplissage pour chaque champ
- Contient la durée du call et les règles pour `nextStepAlerts`

**User message** (construit dynamiquement) :
```
Contexte client : <clients.metadata.description>
Type de meeting : <meeting_types.label>
Instructions spécifiques : <client_prompts.prompt>   ← CE QUE TU ÉDITES DANS LE DASHBOARD
Durée du call : X minutes
Ratio vendeur/prospect : X% / Y%

Transcript complet :
seller: ...
buyer: ...
```

### Comment rédiger un bon prompt

Le champ `client_prompts.prompt` doit contenir les **instructions métier spécifiques** au client et au type de meeting. Exemples :

**Pour un Discovery Call SaaS RH :**
```
Utilise le framework MEDDIC pour scorer la qualification.
Concurrents principaux à surveiller : Lucca, Factorial, PayFit, Workday.
Objectif du discovery : identifier le pain principal, le décideur final, le budget alloué et la timeline.
Alerte si le commercial parle plus de 50% du temps (il doit écouter).
Objections fréquentes dans ce contexte : "on a déjà un SIRH", "budget pas encore validé", "c'est mon DSI qui décide".
Suggère des questions de qualification MEDDIC si des critères manquent.
Veille à ce qu'un next step concret soit proposé avant la fin du call.
```

**Pour une Démo produit :**
```
Type de meeting : démonstration produit.
Concurrents : Salesforce, HubSpot.
Adapter les arguments différenciants sur : facilité d'intégration, time-to-value, prix.
Si le prospect mentionne un concurrent, afficher les 3 arguments clés différenciants.
Suggérer de demander "Qu'est-ce qui vous empêcherait d'avancer ?" si aucune objection n'a été soulevée après 20 min.
```

### Champs JSON retournés par Groq

| Champ | Type | Description |
|---|---|---|
| `suggestions` | `{title, keyPoints[]}[]` | Actions concrètes à faire maintenant (1-3 max) |
| `objections` | `{title, keyPoints[]}[]` | Objections détectées + réponses/frameworks |
| `battleCards` | `{title, keyPoints[]}[]` | Uniquement si concurrent explicitement mentionné |
| `frameworkScores` | `{meddic, bant, spiced}` | Score 0-100 pour chaque framework |
| `missingSignals` | `string[]` | Critères critiques non couverts |
| `nextStepAlerts` | `string[]` | Alerte si pas de next step verrouillé |

### Modifier le system prompt Groq

Le system prompt est dans `realtime-backend/src/server.js`, fonction `generateGroqInsights()`. C'est lui qui définit le comportement global du coach. Le prompt client (`client_prompts.prompt`) vient en complément dans le message user.

---

## 10. Variables d'environnement

### extension/.env

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_BACKEND_WS_URL=ws://localhost:8788
```

> Ces variables sont **intégrées au build** par Vite (bundling statique). Pour changer l'URL du backend en production, rebuild l'extension.

### realtime-backend/.env

```env
PORT=8788
DEEPGRAM_API_KEY=<deepgram_key>
GROQ_API_KEY=<groq_key>
GROQ_MODEL=llama-3.3-70b-versatile   # optionnel, c'est la valeur par défaut
```

### dashboard/.env

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
```

### Supabase Edge Functions — secrets (configurés dans le dashboard Supabase)

Ces valeurs **ne sont pas dans des fichiers `.env`**, elles sont définies dans Supabase → Settings → Edge Functions → Secrets.

```
SUPABASE_URL             → URL du projet Supabase
SUPABASE_SERVICE_ROLE_KEY → clé service role (bypass RLS)
CLIENT_JWT_SECRET        → secret pour signer les JWT clients (arbitraire, ≥ 32 chars)
```

---

## 11. Installation et démarrage

### Prérequis

- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- Un projet Supabase avec les migrations appliquées
- Clés API Deepgram et Groq

### 1. Backend

```bash
cd realtime-backend
pnpm install
cp .env.example .env
# Remplir DEEPGRAM_API_KEY et GROQ_API_KEY dans .env
pnpm run dev
# Serveur WS actif sur ws://localhost:8788
```

### 2. Extension

```bash
cd extension
pnpm install
cp .env.example .env
# Remplir VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BACKEND_WS_URL
pnpm run build
# Build dans extension/dist/
```

### 3. Dashboard

```bash
cd dashboard
pnpm install
cp .env.example .env
# Remplir VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
pnpm run dev
# SPA accessible sur http://localhost:5173
```

### 4. Supabase — setup initial

```bash
# Installer la CLI Supabase si besoin
npm install -g supabase

# Lier au projet
cd dashboard
supabase login
supabase link --project-ref <ref>

# Appliquer les migrations
supabase db push

# Déployer les Edge Functions
supabase functions deploy client-login
supabase functions deploy client-config

# Configurer les secrets des Edge Functions
supabase secrets set CLIENT_JWT_SECRET=<une_chaine_secrete_longue>
```

---

## 12. Chargement de l'extension dans Chrome

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (coin supérieur droit)
3. Cliquer **Charger l'extension non empaquetée**
4. Sélectionner le dossier `extension/dist/`
5. Au premier chargement, une page "Autoriser micro" s'ouvre automatiquement — cliquer Autoriser
6. Sur un onglet Google Meet / Zoom / Teams, l'icône de l'extension apparaît dans la barre Chrome
7. Cliquer l'icône → **Ouvrir le panneau latéral**

**Pour recharger après un `pnpm run build` :** retourner sur `chrome://extensions` et cliquer l'icône de rechargement sur la carte de l'extension.

---

## 13. Flux de données complet

```
1. DÉMARRAGE
   Utilisateur clique "Demarrer" dans SidePanel
     → SidePanel envoie START_COACHING au background
     → background.js :
         - Trouve l'onglet Meeting actif
         - Injecte le content script si absent
         - Ouvre WebSocket → background envoie START_SESSION au backend
         - Crée l'Offscreen Document
         - Envoie OFFSCREEN_START_MIC à l'offscreen
     → SidePanel démarre chrome.tabCapture.capture()

2. CAPTURE AUDIO
   Offscreen (mic) :
     getUserMedia → ScriptProcessorNode → downsample 16kHz
     → Float32→Int16→base64 → OFFSCREEN_AUDIO_CHUNK → background → WS AUDIO_CHUNK source:mic

   SidePanel (tab) :
     tabCapture.capture() → ScriptProcessorNode → downsample 16kHz
     → Float32→Int16→base64 → SIDEPANEL_TAB_AUDIO_CHUNK → background → WS AUDIO_CHUNK source:tab

3. TRANSCRIPTION
   Backend reçoit AUDIO_CHUNK
     → Forward vers socket Deepgram correspondant (mic ou tab)
     → Deepgram retourne Transcript (partiel ou final)
     → Backend envoie TRANSCRIPT_UPDATE à l'extension
     → background relaye vers SidePanel (affichage live) et offscreen (log)

4. ANALYSE IA (toutes les 10s max)
   Backend accumule les transcripts finals dans session.transcript[]
   À chaque transcript reçu :
     - Calcule talk ratio (comptage mots seller vs buyer)
     - Si cooldown 10s écoulé : appelle Groq avec transcript complet + prompt client
     - Sinon : réutilise session.lastInsights
     - Envoie INSIGHT_UPDATE à l'extension

5. AFFICHAGE
   background reçoit INSIGHT_UPDATE
     → Met à jour state.contentState
     → Envoie COACHING_STATE au content script (overlay)
     → Envoie SIDEPANEL_INSIGHT_UPDATE au SidePanel

   SidePanel affiche : talk ratio, suggestions, objections, battle cards,
                       scores MEDDIC/BANT/SPICED, missing signals, next step alerts, transcript live

   Overlay (Shadow DOM) affiche : max 1 suggestion + 1 objection en chips flottants

6. ARRÊT
   Utilisateur clique "Stop"
     → stopTabCapture() dans SidePanel
     → STOP_COACHING → background
     → OFFSCREEN_STOP_MIC → offscreen
     → WS.close()
     → SIDEPANEL_COACHING_STOPPED → SidePanel (status → idle)
```

---

## 14. Ce qui est modifiable facilement

### Changer la couleur primaire de l'UI

`extension/src/globals.css` — variable `--primary` (format HSL) :
```css
--primary: 173 80% 26%;   /* teal actuel */
```

### Changer la fréquence d'analyse LLM

`realtime-backend/src/server.js` ligne 12 :
```js
const LLM_COOLDOWN_MS = 10_000  // 10 secondes
```

### Changer le modèle Groq

Variable d'env `GROQ_MODEL` dans `realtime-backend/.env`, ou ligne 9 de `server.js` :
```js
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
```

Modèles disponibles sur Groq : `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`.

### Changer la langue de transcription Deepgram

`realtime-backend/src/server.js`, dans `createDeepgramLiveSocket()` :
```js
language: 'fr',   // → 'en-US', 'es', etc.
```

### Ajouter un type de meeting

Dans le dashboard admin :
1. Créer le type de meeting (code + label)
2. Pour chaque client concerné, créer un prompt associé

### Modifier le system prompt Groq (comportement global du coach)

`realtime-backend/src/server.js`, fonction `generateGroqInsights()`, constante `systemPrompt`.

### Modifier les plateformes supportées

`extension/manifest.config.js` — tableau `WHITELIST_MATCHES` :
```js
const WHITELIST_MATCHES = [
  'https://meet.google.com/*',
  'https://*.zoom.us/*',
  'https://teams.microsoft.com/*',
  // Ajouter ici d'autres plateformes
]
```

Et dans `extension/src/config.js` — tableau `ALLOWED_HOST_PATTERNS` (utilisé par le background pour valider les onglets).

### Modifier l'apparence de l'overlay (chips flottants)

`extension/src/content.jsx` — constante `INLINE_CSS` (CSS inline dans Shadow DOM).

### Modifier les champs retournés par Groq

Pour ajouter un nouveau champ (ex: `closingTips`) :
1. Ajouter la clé dans `systemPrompt` dans `server.js` (section structure JSON + règles)
2. Ajouter le parsing dans `generateGroqInsights()` : `closingTips: Array.isArray(parsed.closingTips) ? parsed.closingTips : []`
3. Ajouter le champ dans `payload` de `pushInsights()` et dans `createSession().lastInsights` initial
4. Ajouter le champ dans `state.contentState` de `background.js`
5. Afficher dans `SidePanel.jsx`

---

## 15. Limitations et points d'attention

### `ScriptProcessorNode` déprécié

L'API `ScriptProcessorNode` est dépréciée par les navigateurs au profit des AudioWorklets. Un `pcm-processor.js` (AudioWorklet) existe dans `extension/public/` mais n'est pas encore branché. Le `ScriptProcessorNode` fonctionne mais peut générer des avertissements console dans les futures versions de Chrome.

### CRXJS v2 et side_panel

CRXJS v2.3.0 ne supporte pas nativement le champ `side_panel` du manifest MV3. `sidepanel.html` est ajouté manuellement comme input Rollup dans `vite.config.js`. Si CRXJS est mis à jour, vérifier si ce workaround est toujours nécessaire.

### Tailwind CSS v4 et Shadcn

L'extension utilise **Tailwind CSS v4** (avec `@tailwindcss/vite`, pas de `tailwind.config.js`). Le dashboard utilise **Tailwind CSS v3** (avec `tailwind.config.js` et PostCSS). Les deux coexistent dans le monorepo — ne pas mélanger les configs.

Le CLI Shadcn nécessite un `tsconfig.json` — comme le projet est JS only, les composants shadcn sont écrits manuellement en `.jsx` dans `extension/src/components/ui/`.

### Sécurité JWT client

Le secret `CLIENT_JWT_SECRET` signe des JWT donnant accès aux prompts et à la config d'un client. Il ne donne **pas** accès à Supabase directement (les Edge Functions utilisent la service_role_key côté serveur). Si le JWT est compromis, le client peut être désactivé depuis le dashboard (`is_active = false`).

### Audio tab capture et onglet actif

`chrome.tabCapture.capture()` ne peut être appelé que depuis le side panel **pendant que le side panel est ouvert et que l'onglet ciblé est actif**. Si l'utilisateur change d'onglet après avoir démarré le coaching, la capture tab peut s'interrompre.

### Coût API

- **Deepgram nova-2** : ~$0.0043/min par flux audio (2 flux = mic + tab = ~$0.0086/min)
- **Groq llama-3.3-70b** : ~$0.59/million tokens (analyse toutes les 10s, transcript croissant — surveiller l'usage en production)
