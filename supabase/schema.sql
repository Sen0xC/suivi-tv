create table if not exists public.suivi_users (
  id text primary key,
  email text unique,
  name text not null,
  password_hash text,
  settings jsonb not null default '{"locale":"fr-FR","region":"FR","adultContent":false,"notifications":false,"bio":"","avatar":"","showStats":true}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suivi_users
  add column if not exists email text,
  add column if not exists password_hash text,
  add column if not exists settings jsonb not null default '{"locale":"fr-FR","region":"FR","adultContent":false,"notifications":false,"bio":"","avatar":"","showStats":true}'::jsonb;

create unique index if not exists suivi_users_email_unique
  on public.suivi_users(email)
  where email is not null;

create table if not exists public.suivi_sessions (
  token text primary key,
  user_id text not null references public.suivi_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.suivi_media (
  media_type text not null check (media_type in ('tv', 'movie')),
  tmdb_id integer not null,
  title text not null,
  release_year integer,
  genres jsonb not null default '[]'::jsonb,
  rating numeric,
  poster text not null default '',
  backdrop text not null default '',
  synopsis text not null default '',
  seasons jsonb not null default '[1]'::jsonb,
  next_air text,
  primary key (media_type, tmdb_id)
);

create table if not exists public.suivi_library (
  user_id text not null references public.suivi_users(id) on delete cascade,
  media_type text not null check (media_type in ('tv', 'movie')),
  tmdb_id integer not null,
  status text not null check (status in ('watching', 'planned', 'finished', 'paused')),
  watched jsonb not null,
  favorite boolean not null default false,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, media_type, tmdb_id),
  foreign key (media_type, tmdb_id) references public.suivi_media(media_type, tmdb_id) on delete cascade
);

alter table public.suivi_library
  add column if not exists favorite boolean not null default false;

create table if not exists public.suivi_friendships (
  user_id text not null references public.suivi_users(id) on delete cascade,
  friend_id text not null references public.suivi_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.suivi_lists (
  id text primary key,
  user_id text not null references public.suivi_users(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suivi_list_items (
  list_id text not null references public.suivi_lists(id) on delete cascade,
  media_type text not null check (media_type in ('tv', 'movie')),
  tmdb_id integer not null,
  note text not null default '',
  added_at timestamptz not null default now(),
  primary key (list_id, media_type, tmdb_id),
  foreign key (media_type, tmdb_id) references public.suivi_media(media_type, tmdb_id) on delete cascade
);

alter table public.suivi_users enable row level security;
alter table public.suivi_sessions enable row level security;
alter table public.suivi_media enable row level security;
alter table public.suivi_library enable row level security;
alter table public.suivi_friendships enable row level security;
alter table public.suivi_lists enable row level security;
alter table public.suivi_list_items enable row level security;

drop policy if exists "server can manage suivi users" on public.suivi_users;
drop policy if exists "server can manage suivi sessions" on public.suivi_sessions;
drop policy if exists "server can manage suivi media" on public.suivi_media;
drop policy if exists "server can manage suivi library" on public.suivi_library;
drop policy if exists "server can manage suivi friendships" on public.suivi_friendships;
drop policy if exists "server can manage suivi lists" on public.suivi_lists;
drop policy if exists "server can manage suivi list items" on public.suivi_list_items;

create policy "server can manage suivi users"
  on public.suivi_users
  for all
  using (true)
  with check (true);

create policy "server can manage suivi sessions"
  on public.suivi_sessions
  for all
  using (true)
  with check (true);

create policy "server can manage suivi media"
  on public.suivi_media
  for all
  using (true)
  with check (true);

create policy "server can manage suivi library"
  on public.suivi_library
  for all
  using (true)
  with check (true);

create policy "server can manage suivi friendships"
  on public.suivi_friendships
  for all
  using (true)
  with check (true);

create policy "server can manage suivi lists"
  on public.suivi_lists
  for all
  using (true)
  with check (true);

create policy "server can manage suivi list items"
  on public.suivi_list_items
  for all
  using (true)
  with check (true);
