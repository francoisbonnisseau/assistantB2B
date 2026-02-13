# Dashboard Admin

Dashboard web admin pour gerer les comptes clients et leurs prompts par type de meeting.

## Stack

- React + Vite
- Tailwind + composants style shadcn/ui
- Supabase (Auth + Postgres)

## Prerequis

- Node.js 20+
- pnpm

## Installation

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Ajoute dans `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Base de donnees

La migration SQL se trouve dans:

- `supabase/migrations/20260213130000_init_admin_dashboard.sql`

Elle cree:

- `admin_users`
- `clients`
- `meeting_types`
- `client_prompts`

Avec:

- contraintes d'unicite
- RLS active
- policies admin-only
- cascade delete des prompts quand un client ou type est supprime

## Auth admin

Le dashboard utilise `Supabase Auth` pour la connexion admin.

Apres creation de l'utilisateur admin dans Supabase Auth, il faut whitelist son `auth.users.id`:

```sql
insert into public.admin_users (user_id)
values ('UUID_DE_L_ADMIN');
```

## Fonctionnalites V1

- Login admin
- CRUD clients (username, password hash, metadata, statut)
- Listing clients (username uniquement)
- Confirmation de suppression hard delete
- CRUD types de meeting globaux
- Association prompts par client et par type de meeting

## Edge Functions pour l'extension

Fonctions deployees:

- `client-login`
- `client-config`

Secrets requis dans Supabase Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_JWT_SECRET`

`CLIENT_JWT_SECRET` doit etre une cle longue et aleatoire (min 32 caracteres).
