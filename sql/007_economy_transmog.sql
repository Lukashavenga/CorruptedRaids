-- Transmog spends gold, so it is an economy event like a purchase (#23).
--
-- 005 wrote the allowed kinds as an inline CHECK, which Postgres names
-- economy_events_kind_check. Until this runs, a `transmog_gear` row is refused
-- by the old constraint; the writers already treat a failed balance-log insert
-- as a warning and drop it (AGENTS.md §3, "It never blocks a fight"), so the
-- transmog itself still happens - only its row is missing from the report.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events
  add constraint economy_events_kind_check
  check (kind in ('buy_gear', 'buy_consumable', 'recycle_gear', 'open_chest', 'level_up', 'transmog_gear'));
