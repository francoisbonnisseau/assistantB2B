# Supabase Setup — One-Shot Reference

This document contains everything needed to configure the Supabase project from scratch. An LLM with direct Supabase access should be able to follow this document top-to-bottom without asking any questions.

---

## Overview

The Supabase project backs an **admin dashboard** and a **Chrome extension**.

- The **dashboard** uses Supabase Auth (email/password) for admin login and the Supabase JS SDK to manage data.
- The **extension** authenticates with its own custom JWT (HS256) issued by the `client-login` Edge Function — it does **not** use Supabase Auth.
- All data access from the dashboard goes through RLS policies that check `is_admin_user()`.
- Edge Functions bypass RLS using the service role key.

---

## Step-by-Step Setup Sequence

1. Apply migration `20260213130000_init_admin_dashboard.sql`
2. Apply migration `20260213133000_fix_set_updated_at_search_path.sql`
3. Set the three required secrets (see [Secrets](#secrets))
4. Deploy Edge Function `client-login`
5. Deploy Edge Function `client-config`
6. Create the first admin user (see [Creating the First Admin](#creating-the-first-admin))
7. Optionally seed meeting types and clients (see [Seeding Data](#seeding-data))

---

## Secrets

Three environment variables must be set as Supabase project secrets (available to Edge Functions via `Deno.env.get`).

| Secret name | Description |
|---|---|
| `SUPABASE_URL` | Your project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS). Found in Project Settings → API. |
| `CLIENT_JWT_SECRET` | A strong random string (≥32 chars) used to sign/verify client JWTs. Generate with `openssl rand -base64 32`. |

Set secrets via Supabase CLI:

```bash
supabase secrets set SUPABASE_URL=https://xxxx.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase secrets set CLIENT_JWT_SECRET=<random_secret>
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also available as built-in secrets inside Edge Functions — you only need to explicitly set them if you are running locally or the built-in injection is not working.

---

## Migration 1 — `20260213130000_init_admin_dashboard.sql`

Full DDL: schema, indexes, triggers, RLS policies, and helper function.

```sql
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{"company": "", "name": "", "description": ""}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_prompts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  meeting_type_id uuid not null references public.meeting_types(id) on delete cascade,
  prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, meeting_type_id)
);

create index if not exists idx_clients_username on public.clients(username);
create index if not exists idx_client_prompts_client_id on public.client_prompts(client_id);
create index if not exists idx_client_prompts_meeting_type_id on public.client_prompts(meeting_type_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_meeting_types_updated_at on public.meeting_types;
create trigger trg_meeting_types_updated_at
before update on public.meeting_types
for each row execute function public.set_updated_at();

drop trigger if exists trg_client_prompts_updated_at on public.client_prompts;
create trigger trg_client_prompts_updated_at
before update on public.client_prompts
for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.clients enable row level security;
alter table public.meeting_types enable row level security;
alter table public.client_prompts enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin_user() from public;
grant execute on function public.is_admin_user() to authenticated;

drop policy if exists admin_users_select_policy on public.admin_users;
create policy admin_users_select_policy
on public.admin_users
for select
to authenticated
using (public.is_admin_user());

drop policy if exists clients_admin_policy on public.clients;
create policy clients_admin_policy
on public.clients
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists meeting_types_admin_policy on public.meeting_types;
create policy meeting_types_admin_policy
on public.meeting_types
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists client_prompts_admin_policy on public.client_prompts;
create policy client_prompts_admin_policy
on public.client_prompts
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());
```

---

## Migration 2 — `20260213133000_fix_set_updated_at_search_path.sql`

Security fix: adds `set search_path = public` to the trigger function to prevent search path injection.

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

---

## Schema Summary

### `public.admin_users`

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `created_at` | `timestamptz` | Default `now()` |

Rows in this table grant admin access to the dashboard. Any Supabase Auth user whose `id` appears here is an admin.

### `public.clients`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `username` | `text` | Unique, used for extension login |
| `password_hash` | `text` | bcrypt hash of the client's password |
| `is_active` | `boolean` | Default `true`; inactive clients cannot log in |
| `metadata` | `jsonb` | `{"company": "", "name": "", "description": ""}` |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Auto-updated by trigger |

Index: `idx_clients_username` on `username`.

### `public.meeting_types`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `code` | `text` | Unique short identifier, e.g. `"discovery"` |
| `label` | `text` | Human-readable name, e.g. `"Discovery Call"` |
| `is_active` | `boolean` | Default `true`; inactive types are excluded from extension config |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Auto-updated by trigger |

### `public.client_prompts`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `client_id` | `uuid` | FK → `public.clients(id)` ON DELETE CASCADE |
| `meeting_type_id` | `uuid` | FK → `public.meeting_types(id)` ON DELETE CASCADE |
| `prompt` | `text` | The LLM system prompt for this client+meeting type combination |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Auto-updated by trigger |

Unique constraint: `(client_id, meeting_type_id)` — one prompt per client per meeting type.

Indexes: `idx_client_prompts_client_id`, `idx_client_prompts_meeting_type_id`.

---

## RLS Policies

All four tables have RLS enabled. Access is gated by `public.is_admin_user()`.

| Table | Policy name | Operation | Rule |
|---|---|---|---|
| `admin_users` | `admin_users_select_policy` | SELECT | `is_admin_user()` |
| `clients` | `clients_admin_policy` | ALL | `is_admin_user()` |
| `meeting_types` | `meeting_types_admin_policy` | ALL | `is_admin_user()` |
| `client_prompts` | `client_prompts_admin_policy` | ALL | `is_admin_user()` |

### `public.is_admin_user()`

- Language: SQL, `STABLE`, `SECURITY DEFINER`, `search_path = public`
- Checks whether `auth.uid()` exists in `public.admin_users`
- Granted `EXECUTE` to `authenticated` role only

Edge Functions use the service role key and therefore bypass RLS entirely.

---

## Edge Function — `client-login`

**Path:** `supabase/functions/client-login/index.ts`

**JWT verification:** disabled (this function issues JWTs, it does not receive Supabase ones).

**Purpose:** Authenticates a Chrome extension client (username + password). Returns a signed HS256 JWT valid for 7 days.

**Request:**
```
POST /functions/v1/client-login
Content-Type: application/json

{ "username": "acme", "password": "secret" }
```

**Response (200):**
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "expires_at": "<iso8601>",
  "client_id": "<uuid>"
}
```

**Error responses:** `400` (missing fields), `401` (invalid credentials or inactive client), `500` (missing secrets or unexpected error).

**Source:**
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2.49.8'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { SignJWT } from 'npm:jose@5.9.6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { username, password } = await request.json()
    if (!username || !password) {
      return json({ error: 'username and password are required' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const jwtSecret = Deno.env.get('CLIENT_JWT_SECRET')

    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return json({ error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or CLIENT_JWT_SECRET' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: client, error } = await supabase
      .from('clients')
      .select('id, username, password_hash, is_active')
      .eq('username', username)
      .maybeSingle()

    if (error || !client || !client.is_active) {
      return json({ error: 'Invalid credentials' }, 401)
    }

    const isValidPassword = bcrypt.compareSync(password, client.password_hash)
    if (!isValidPassword) {
      return json({ error: 'Invalid credentials' }, 401)
    }

    const expiresInSeconds = 60 * 60 * 24 * 7
    const secret = new TextEncoder().encode(jwtSecret)
    const token = await new SignJWT({ sub: client.id, username: client.username })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(secret)

    return json({
      access_token: token,
      token_type: 'bearer',
      expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      client_id: client.id,
    })
  } catch (error) {
    return json({ error: error.message ?? 'Unexpected error' }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

---

## Edge Function — `client-config`

**Path:** `supabase/functions/client-config/index.ts`

**JWT verification:** disabled (uses custom HS256 JWT, not Supabase Auth JWT).

**Purpose:** Returns the full configuration for a client given a valid JWT issued by `client-login`. The extension calls this on startup to get its meeting types and prompts.

**Request:**
```
GET /functions/v1/client-config
Authorization: Bearer <jwt>
```

**Response (200):**
```json
{
  "username": "acme",
  "clientName": "Acme Corp",
  "description": "...",
  "meetingTypes": [
    {
      "id": "<uuid>",
      "code": "discovery",
      "label": "Discovery Call",
      "prompt": "You are a helpful assistant for Acme Corp discovery calls..."
    }
  ]
}
```

Only meeting types where `meeting_types.is_active = true` are included.

**Error responses:** `401` (missing or invalid token), `404` (client not found or inactive), `500` (missing secrets or unexpected error).

**Source:**
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2.49.8'
import { jwtVerify } from 'npm:jose@5.9.6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!token) {
      return json({ error: 'Missing bearer token' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const jwtSecret = Deno.env.get('CLIENT_JWT_SECRET')
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return json({ error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or CLIENT_JWT_SECRET' }, 500)
    }

    const secret = new TextEncoder().encode(jwtSecret)
    const verified = await jwtVerify(token, secret)
    const clientId = verified.payload.sub

    if (!clientId) {
      return json({ error: 'Invalid token' }, 401)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, username, is_active, metadata')
      .eq('id', clientId)
      .single()

    if (clientError || !client || !client.is_active) {
      return json({ error: 'Client not found or inactive' }, 404)
    }

    const { data: promptRows, error: promptError } = await supabase
      .from('client_prompts')
      .select('id, prompt, meeting_type_id, meeting_types(id, code, label, is_active)')
      .eq('client_id', client.id)

    if (promptError) {
      return json({ error: promptError.message }, 500)
    }

    const meetingTypes = (promptRows ?? [])
      .filter((row) => row.meeting_types && row.meeting_types.is_active)
      .map((row) => ({
        id: row.meeting_types.id,
        code: row.meeting_types.code,
        label: row.meeting_types.label,
        prompt: row.prompt,
      }))

    return json({
      username: client.username,
      clientName: client.metadata?.name ?? '',
      description: client.metadata?.description ?? '',
      meetingTypes,
    })
  } catch (error) {
    return json({ error: error.message ?? 'Unexpected error' }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

---

## Creating the First Admin

Admins are Supabase Auth users whose `id` exists in `public.admin_users`. There is no self-registration — admins must be created manually.

**Step 1.** Create the user in Supabase Auth (Dashboard → Authentication → Users → "Add user", or via the API).

**Step 2.** Insert their `user_id` into `admin_users`. Run this in the SQL editor, replacing the UUID with the actual user's `id`:

```sql
insert into public.admin_users (user_id)
values ('<auth-user-uuid>');
```

The user can now sign into the dashboard with email/password via Supabase Auth.

To grant admin access to additional users, repeat the same two steps.

---

## Seeding Data

### Add a meeting type

```sql
insert into public.meeting_types (code, label)
values ('discovery', 'Discovery Call');
```

`code` must be unique and is used as a stable identifier in the extension. `label` is the human-readable name shown in the UI.

### Add a client

`password_hash` must be a bcrypt hash. Generate one in Node.js:

```js
const bcrypt = require('bcryptjs')
console.log(bcrypt.hashSync('my-password', 10))
```

Then insert:

```sql
insert into public.clients (username, password_hash, metadata)
values (
  'acme',
  '$2a$10$...hash...',
  '{"company": "Acme Corp", "name": "Acme", "description": "Main account"}'
);
```

### Assign a prompt to a client

```sql
insert into public.client_prompts (client_id, meeting_type_id, prompt)
values (
  (select id from public.clients where username = 'acme'),
  (select id from public.meeting_types where code = 'discovery'),
  'You are an expert sales assistant for Acme Corp. Help the sales rep during discovery calls by...'
);
```

---

## Supabase CLI Reference

```bash
# Link to your project
supabase link --project-ref <project-ref>

# Apply all migrations
supabase db push

# Deploy both edge functions
supabase functions deploy client-login --no-verify-jwt
supabase functions deploy client-config --no-verify-jwt

# Set secrets
supabase secrets set CLIENT_JWT_SECRET=<value>

# List secrets
supabase secrets list
```

---

## Auth Settings (Supabase Dashboard)

- **Site URL:** set to your dashboard's deployed URL (e.g. `https://dashboard.example.com`)
- **Redirect URLs:** add the dashboard URL
- **Email provider:** enabled by default; no additional OAuth providers required
- **Email confirmations:** can be disabled for internal admin tools if preferred

---

## Notes for the LLM

- Both Edge Functions must be deployed with `--no-verify-jwt` because they implement their own auth (custom HS256 JWT), not Supabase Auth JWT.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into Edge Functions by the Supabase runtime; you only need to set them explicitly if you observe missing-secret errors.
- The `clients` table stores bcrypt-hashed passwords. Never store plain-text passwords.
- The `metadata` JSONB field on `clients` always has the shape `{"company": "", "name": "", "description": ""}`. All three keys are expected by the dashboard UI.
- `client_prompts` has a unique constraint on `(client_id, meeting_type_id)` — use `ON CONFLICT DO UPDATE` if upserting.
- The `is_admin_user()` function uses `SECURITY DEFINER` so it runs as the function owner (bypassing RLS on `admin_users`) while still reading `auth.uid()` from the caller's session.
