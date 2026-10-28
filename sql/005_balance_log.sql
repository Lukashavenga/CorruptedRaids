-- The balance log: what actually happened on stream.
--
-- Run this in the Supabase SQL editor the same way as 001_roster.sql. It is
-- additive and safe to re-run.
--
-- WHAT IT HOLDS
-- -------------
-- One row per fight (`fights`), one per party member in it (`fight_members`),
-- and one per thing that moved gold or gear outside a fight (`economy_events`).
-- The game server writes fights and level-ups; the `character` Edge Function
-- writes purchases, recycles and chest openings. See AGENTS.md "Balance log".
--
-- NO VIEWER ACCESS, ON PURPOSE
-- ----------------------------
-- fight_members holds every viewer's build - points, gear, damage - and that
-- is not something to publish by default. Row level security is switched on
-- and NO policy is created, so the anon and authenticated roles see nothing;
-- the service role bypasses RLS and is the only writer and reader. Letting a
-- viewer read their own rows ("your best run") is a deliberate later decision:
-- add a select policy keyed on character_id then, rather than loosening this.
--
-- RETENTION
-- ---------
-- Not pruned. `created_at` is indexed on all three tables, so a later
-- `delete ... where created_at < now() - interval '90 days'` is a range scan.

create table if not exists public.fights (
  -- Minted by the game server, so a repeated insert is a no-op.
  id text primary key,
  created_at timestamptz not null default now(),

  -- live | sim | sandbox. Reports exclude everything but live by default.
  source text not null check (source in ('live', 'sim', 'sandbox')),

  run_id text not null,
  kind text not null check (kind in ('dungeon', 'raid_room', 'raid_boss')),
  dungeon_id text,
  raid_id text,
  room_id text,

  -- The party's level, 1..6 (weak..apocalyptic), and the rating that picked it.
  level smallint not null,
  band text not null,
  party_rating integer not null,
  headcount integer not null,
  tanks integer not null,
  healers integer not null,
  dps integer not null,

  enemy_count integer not null,
  -- The hp/atk multiplier the level put on every body, then party scaling, then
  -- (raid boss only) the room's own multipliers.
  stat_scale double precision not null,
  party_scale_hp double precision not null,
  party_scale_atk double precision not null,
  boss_hp_mult double precision,
  boss_atk_mult double precision,

  outcome text not null check (outcome in ('victory', 'defeat')),
  ticks integer not null,
  tick_ceiling integer not null,
  -- wiped | cleared | timer. A defeat is a wipe OR the timer, and they are
  -- opposite balance problems.
  end_reason text not null check (end_reason in ('wiped', 'cleared', 'timer')),

  -- '<fight hash>.<balance hash>': what was played. A reading is only
  -- meaningful next to the numbers it was taken under.
  fingerprint text not null,

  -- The full event log, for one fight in balanceLog.rawEventsOneIn. Usually null.
  events jsonb
);

create index if not exists fights_created_at_idx on public.fights (created_at);
create index if not exists fights_place_idx on public.fights (source, dungeon_id, raid_id, level);

create table if not exists public.fight_members (
  fight_id text not null references public.fights (id) on delete cascade,
  character_id text not null,
  primary key (fight_id, character_id),

  role text not null,
  level integer not null,
  -- ratePoints of the derived stats, as the matchmaker read it.
  corruption integer not null,
  allocated jsonb not null,
  stats jsonb not null,
  -- slot -> gear id
  gear jsonb not null,

  damage_dealt double precision not null default 0,
  damage_taken double precision not null default 0,
  hits_taken integer not null default 0,
  heals_given double precision not null default 0,
  heals_received double precision not null default 0,
  taunts integer not null default 0,

  survived boolean not null,
  death_tick integer,

  xp integer not null default 0,
  gold integer not null default 0,
  level_ups jsonb not null default '[]',
  -- [{ gearId, rarity }]
  loot jsonb not null default '[]'
);

create index if not exists fight_members_character_idx on public.fight_members (character_id);

create table if not exists public.economy_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('live', 'sim', 'sandbox')),
  character_id text not null,
  kind text not null check (kind in ('buy_gear', 'buy_consumable', 'recycle_gear', 'open_chest', 'level_up')),
  -- Signed: a purchase is negative, a recycle positive.
  gold_delta integer not null default 0,
  gear_id text,
  rarity text,
  -- shop | loot: what a recycle's payout depended on.
  gear_source text,
  -- New level, for a level_up.
  level integer,
  -- The fight a level_up came out of.
  fight_id text
);

create index if not exists economy_events_created_at_idx on public.economy_events (created_at);
create index if not exists economy_events_character_idx on public.economy_events (character_id, created_at);

-- Service role only: RLS on, no policies.
alter table public.fights enable row level security;
alter table public.fight_members enable row level security;
alter table public.economy_events enable row level security;
