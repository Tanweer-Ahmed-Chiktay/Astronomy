-- World Astronomy — initial schema
-- Run against a fresh Supabase project: supabase db push

-- ── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists postgis;  -- for geographic observation sites

-- ── Profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  username      text unique not null,
  display_name  text,
  avatar_url    text,
  bio           text,
  bortle_class  smallint check (bortle_class between 1 and 9),
  latitude      double precision,
  longitude     double precision,
  timezone      text default 'UTC',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- ── Equipment ────────────────────────────────────────────────────────────────
create table public.equipment (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles on delete cascade,
  name          text not null,
  type          text not null check (type in ('telescope','mount','eyepiece','camera','filter','binoculars','other')),
  aperture_mm   real,
  focal_length_mm real,
  focal_ratio   real,
  manufacturer  text,
  model         text,
  notes         text,
  created_at    timestamptz default now()
);

alter table public.equipment enable row level security;

create policy "Equipment visible to owner"
  on public.equipment for select using (auth.uid() = user_id);

create policy "Equipment insert by owner"
  on public.equipment for insert with check (auth.uid() = user_id);

create policy "Equipment update by owner"
  on public.equipment for update using (auth.uid() = user_id);

create policy "Equipment delete by owner"
  on public.equipment for delete using (auth.uid() = user_id);

-- ── Observation Sessions ─────────────────────────────────────────────────────
create table public.sessions (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles on delete cascade,
  started_at     timestamptz not null,
  ended_at       timestamptz,
  latitude       double precision not null,
  longitude      double precision not null,
  elevation_m    real,
  bortle_class   smallint check (bortle_class between 1 and 9),
  temperature_c  real,
  humidity_pct   real,
  seeing_arcsec  real,
  transparency   smallint check (transparency between 1 and 5),
  notes          text,
  is_public      boolean default false,
  created_at     timestamptz default now()
);

alter table public.sessions enable row level security;

create policy "Public sessions viewable by all"
  on public.sessions for select using (is_public = true or auth.uid() = user_id);

create policy "Sessions insert by owner"
  on public.sessions for insert with check (auth.uid() = user_id);

create policy "Sessions update by owner"
  on public.sessions for update using (auth.uid() = user_id);

create policy "Sessions delete by owner"
  on public.sessions for delete using (auth.uid() = user_id);

-- ── Observation Log Entries ──────────────────────────────────────────────────
create table public.observations (
  id              uuid primary key default uuid_generate_v4(),
  session_id      uuid not null references public.sessions on delete cascade,
  user_id         uuid not null references public.profiles on delete cascade,
  target_type     text not null check (target_type in ('planet','moon','star','dso','comet','asteroid','satellite','other')),
  target_name     text not null,
  target_catalog  text,   -- e.g. "M31", "NGC 224"
  observed_at     timestamptz not null,
  ra_deg          double precision,  -- J2000 right ascension degrees
  dec_deg         double precision,  -- J2000 declination degrees
  altitude_deg    real,
  azimuth_deg     real,
  magnitude       real,
  equipment_id    uuid references public.equipment,
  eyepiece_mm     real,
  magnification   real,
  fov_deg         real,
  rating          smallint check (rating between 1 and 5),
  notes           text,
  sketch_url      text,
  is_public       boolean default false,
  created_at      timestamptz default now()
);

alter table public.observations enable row level security;

create policy "Public observations viewable by all"
  on public.observations for select using (is_public = true or auth.uid() = user_id);

create policy "Observations insert by owner"
  on public.observations for insert with check (auth.uid() = user_id);

create policy "Observations update by owner"
  on public.observations for update using (auth.uid() = user_id);

create policy "Observations delete by owner"
  on public.observations for delete using (auth.uid() = user_id);

-- ── Astrophotos ──────────────────────────────────────────────────────────────
create table public.astrophotos (
  id              uuid primary key default uuid_generate_v4(),
  observation_id  uuid references public.observations on delete set null,
  user_id         uuid not null references public.profiles on delete cascade,
  storage_path    text not null,  -- Supabase Storage path
  thumbnail_path  text,
  width_px        integer,
  height_px       integer,
  exposure_sec    real,
  iso             integer,
  gain            real,
  frames_stacked  integer,
  capture_software text,
  processing_notes text,
  is_public       boolean default false,
  created_at      timestamptz default now()
);

alter table public.astrophotos enable row level security;

create policy "Public photos viewable by all"
  on public.astrophotos for select using (is_public = true or auth.uid() = user_id);

create policy "Photos insert by owner"
  on public.astrophotos for insert with check (auth.uid() = user_id);

create policy "Photos update by owner"
  on public.astrophotos for update using (auth.uid() = user_id);

create policy "Photos delete by owner"
  on public.astrophotos for delete using (auth.uid() = user_id);

-- ── Realtime Activity Feed ────────────────────────────────────────────────────
create table public.feed_events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles on delete cascade,
  event_type  text not null check (event_type in ('observation','photo','session_start','session_end','planet_view')),
  payload     jsonb not null default '{}',
  created_at  timestamptz default now()
);

alter table public.feed_events enable row level security;

create policy "Feed events viewable by all"
  on public.feed_events for select using (true);

create policy "Feed events insert by owner"
  on public.feed_events for insert with check (auth.uid() = user_id);

-- Enable Realtime for feed
alter publication supabase_realtime add table public.feed_events;

-- ── Helper: auto-create profile on signup ────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Updated-at trigger ────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index idx_observations_user_id      on public.observations(user_id);
create index idx_observations_observed_at  on public.observations(observed_at desc);
create index idx_sessions_user_id          on public.sessions(user_id);
create index idx_feed_events_created_at    on public.feed_events(created_at desc);
create index idx_astrophotos_user_id       on public.astrophotos(user_id);
