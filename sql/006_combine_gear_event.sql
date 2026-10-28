-- combine_gear is a new kind of economy event (issue #15).
-- The inline check on 005's column is auto-named economy_events_kind_check.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events
  add constraint economy_events_kind_check
  check (kind in ('buy_gear', 'buy_consumable', 'recycle_gear', 'combine_gear', 'open_chest', 'level_up'));
