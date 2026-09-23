create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false,
  email_confirmed_at timestamptz,
  deleted_at timestamptz,
  banned_until timestamptz
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  thumbnail text,
  type text not null check (type in ('slot', 'fish', 'card', 'arcade', 'casual', 'adult')),
  supports_live boolean default false,
  published boolean default false,
  created_at timestamptz default now(),
  launch_url text,
  sort_order integer not null default 0
);

insert into public.games (name, slug, type, published, launch_url) values
  ('Test game', 'test-game', 'casual', true, 'https://game.example/'),
  ('Hidden game', 'hidden-game', 'casual', false, 'https://game.example/'),
  ('Missing URL', 'missing-url', 'casual', true, null);

create table auth.identities(user_id uuid,provider text);
create table public.admin_users(email text);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
