-- Rally (balance.rally): whether a member fought Rallied. Run this BEFORE
-- deploying a game server that has Rally, or its fight_members insert is
-- refused for the unknown column (a failed write is dropped, not retried).
-- `corruption` stays the real number, so section 5 of `report:balance` can
-- compare rows where this is false (before) and true (after).
alter table public.fight_members add column if not exists rallied boolean not null default false;
