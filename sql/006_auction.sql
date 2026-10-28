-- The auction house: buyout listings for found gear.
--
-- Run once in the Supabase SQL editor, after 001 and 005. (The ticket called
-- this 005_auction.sql; 005 was already the balance log.)
--
-- A SALE CHANGES TWO CHARACTERS, AND ONLY ONE OF THEM IS WRITTEN
-- ---------------------------------------------------------------
-- Every write to a character is that character's own action: the loadout writes
-- the signed-in viewer's row through the `character` Edge Function, and the
-- game server holds the live roster and saves it write-behind, winning any
-- conflict (supabaseRosterStore `conflicts`). A buyer's request that credited
-- gold to the SELLER's row would be silently lost whenever the seller was
-- mid-run - real gold vanishing.
--
-- So a sale touches the buyer's row and nothing else. The seller is owed gold
-- in `proceeds`, and their own next write (collect) moves it into their
-- character. A cancelled or expired listing returns the same way.
--
-- THE RULES ARE NOT HERE
-- ----------------------
-- Fees, minimum prices, listing caps, what may be listed: all in
-- src/engine/auction.ts, applied by the Edge Function. These functions only
-- make the outcome ATOMIC. They take the character the engine computed and
-- refuse unless the row is still the one the engine read (`p_expected` is its
-- updated_at), so two requests racing on one viewer cannot both spend the same
-- gold. They are callable by the service role only.

create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  -- Never exposed to viewers: sellers are anonymous (column grants below).
  seller_id   text not null,
  -- The item is stored as its definition, not its instance. It is minted
  -- afresh, source "loot", for whoever ends up holding it.
  gear_id     text not null,
  price       integer not null check (price > 0),
  -- open -> sold | cancelled; cancelled, or open past expires_at -> returned
  -- (the seller collected the item back).
  status      text not null default 'open' check (status in ('open', 'sold', 'cancelled', 'returned')),
  listed_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz
);

create index if not exists listings_open_idx on public.listings (expires_at) where status = 'open';
create index if not exists listings_seller_idx on public.listings (seller_id, status);

create table if not exists public.proceeds (
  id            uuid primary key default gen_random_uuid(),
  seller_id     text not null,
  listing_id    uuid not null references public.listings (id),
  -- Already net of the fee.
  gold          integer not null check (gold > 0),
  created_at    timestamptz not null default now(),
  -- Null until the seller collects it.
  collected_at  timestamptz
);

create index if not exists proceeds_seller_idx on public.proceeds (seller_id) where collected_at is null;

-- The balance log learns the two new kinds. The constraint was created inline
-- in 005, so it carries the default name.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events add constraint economy_events_kind_check
  check (kind in ('buy_gear', 'buy_consumable', 'recycle_gear', 'open_chest', 'level_up', 'auction_buy', 'auction_collect'));

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.listings enable row level security;
alter table public.proceeds enable row level security;

-- Anyone signed in may read OPEN listings, and may not read who is selling:
-- table access is revoked and re-granted by column, without seller_id.
revoke all on public.listings from anon, authenticated;
revoke all on public.proceeds from anon, authenticated;
grant select (id, gear_id, price, status, listed_at, expires_at) on public.listings to authenticated;

drop policy if exists "read open listings" on public.listings;
create policy "read open listings" on public.listings
  for select to authenticated
  using ( status = 'open' and expires_at > now() );

-- No write policy on either table, and proceeds has no policy at all: a
-- viewer reads their own through the Edge Function.

-- ---------------------------------------------------------------------------
-- The atomic steps. Each locks the character row it writes.
-- ---------------------------------------------------------------------------

-- Locks a character row and refuses unless it is writable and unchanged.
create or replace function public.auction_lock_character(p_id text, p_expected timestamptz)
returns void language plpgsql as $$
declare
  r record;
begin
  select in_run, updated_at into r from public.characters where id = p_id for update;
  if not found then raise exception 'auction:no_character'; end if;
  if r.in_run then raise exception 'auction:in_run'; end if;
  if r.updated_at is distinct from p_expected then raise exception 'auction:stale'; end if;
end $$;

-- Escrow: the item leaves the bag (p_character is the bag without it) and a
-- listing appears, or neither happens.
create or replace function public.auction_list(
  p_seller text, p_character jsonb, p_expected timestamptz,
  p_gear text, p_price integer, p_expires timestamptz
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform public.auction_lock_character(p_seller, p_expected);
  update public.characters set data = p_character, updated_at = now() where id = p_seller;
  insert into public.listings (seller_id, gear_id, price, expires_at)
    values (p_seller, p_gear, p_price, p_expires) returning id into v_id;
  return v_id;
end $$;

-- The sale. The listing is claimed by one UPDATE ... WHERE status = 'open', so
-- of two simultaneous buyers the second finds it already sold and the whole
-- call rolls back, leaving that buyer's gold alone. The seller's character row
-- is not touched; they are owed `price - fee` in proceeds.
create or replace function public.auction_buy(
  p_buyer text, p_character jsonb, p_expected timestamptz,
  p_listing uuid, p_fee integer
) returns void language plpgsql as $$
declare
  v_seller text;
  v_price integer;
begin
  perform public.auction_lock_character(p_buyer, p_expected);
  update public.listings
     set status = 'sold', ended_at = now()
   where id = p_listing and status = 'open' and expires_at > now() and seller_id <> p_buyer
   returning seller_id, price into v_seller, v_price;
  if not found then raise exception 'auction:gone'; end if;
  if p_fee < 0 or p_fee >= v_price then raise exception 'auction:bad_fee'; end if;
  update public.characters set data = p_character, updated_at = now() where id = p_buyer;
  insert into public.proceeds (seller_id, listing_id, gold) values (v_seller, p_listing, v_price - p_fee);
end $$;

-- Withdraw. The item is NOT returned here: it comes back through collect, the
-- same as an expiry, so this writes no character.
create or replace function public.auction_cancel(p_seller text, p_listing uuid)
returns void language plpgsql as $$
begin
  update public.listings set status = 'cancelled', ended_at = now()
   where id = p_listing and seller_id = p_seller and status = 'open' and expires_at > now();
  if not found then raise exception 'auction:gone'; end if;
end $$;

-- The seller's own write: proceeds become gold and ended listings become items
-- in p_character. Every id must still be collectable, or nothing is.
create or replace function public.auction_collect(
  p_seller text, p_character jsonb, p_expected timestamptz,
  p_proceeds uuid[], p_returned uuid[]
) returns void language plpgsql as $$
declare
  n integer;
begin
  perform public.auction_lock_character(p_seller, p_expected);

  update public.proceeds set collected_at = now()
   where id = any (p_proceeds) and seller_id = p_seller and collected_at is null;
  get diagnostics n = row_count;
  if n <> coalesce(array_length(p_proceeds, 1), 0) then raise exception 'auction:stale'; end if;

  update public.listings set status = 'returned', ended_at = coalesce(ended_at, now())
   where id = any (p_returned) and seller_id = p_seller
     and (status = 'cancelled' or (status = 'open' and expires_at <= now()));
  get diagnostics n = row_count;
  if n <> coalesce(array_length(p_returned, 1), 0) then raise exception 'auction:stale'; end if;

  update public.characters set data = p_character, updated_at = now() where id = p_seller;
end $$;

-- Service role only. Postgres grants execute to PUBLIC by default.
revoke all on function public.auction_lock_character(text, timestamptz) from public, anon, authenticated;
revoke all on function public.auction_list(text, jsonb, timestamptz, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.auction_buy(text, jsonb, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.auction_cancel(text, uuid) from public, anon, authenticated;
revoke all on function public.auction_collect(text, jsonb, timestamptz, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.auction_lock_character(text, timestamptz) to service_role;
grant execute on function public.auction_list(text, jsonb, timestamptz, text, integer, timestamptz) to service_role;
grant execute on function public.auction_buy(text, jsonb, timestamptz, uuid, integer) to service_role;
grant execute on function public.auction_cancel(text, uuid) to service_role;
grant execute on function public.auction_collect(text, jsonb, timestamptz, uuid[], uuid[]) to service_role;
