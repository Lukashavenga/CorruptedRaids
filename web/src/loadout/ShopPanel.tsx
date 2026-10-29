import { ALLOCATABLE_STATS } from "../../../src/engine/types.js";
import type { GearDefinition } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { ItemIcon } from "./ItemIcon.js";
import { StatIcon } from "./StatIcon.js";
import { text, format } from "../../../src/text/index.js";

export interface ShopPanelProps {
  character: CharacterView;
  catalog: ContentCatalog;
  onBuyGear: (gearId: string) => void;
  onBuyConsumable: (consumableId: string) => void;
  busy: boolean;
}

/**
 * One chip per stat the item changes: the stat's own mark, the amount, the
 * word. Drawn rather than written as "+5 Damage, +2 Speed" because a row of
 * marks is read at a glance and a sentence has to be read.
 */
function StatChips({ def }: { def: GearDefinition }): JSX.Element {
  const mods = ALLOCATABLE_STATS.filter((key) => (def.statMods[key] ?? 0) !== 0);
  return (
    <span className="shop-stats">
      {mods.map((key) => {
        const value = def.statMods[key]!;
        return (
          <span key={key} className={`shop-stat ${value < 0 ? "is-down" : "is-up"}`}>
            <StatIcon stat={key} size={14} />
            <span className="shop-stat-value">
              {value > 0 ? "+" : ""}
              {value}
            </span>
            <span className="shop-stat-name">{text.stat[key]}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The price, as the buy button. Gold coins, the number, and - when the
 * shopkeeper has put it on sale - the old price struck through beside it.
 */
function PriceButton(props: { price: number; was?: number; affordable: boolean; busy: boolean; onBuy: () => void }): JSX.Element {
  const { price, was, affordable, busy, onBuy } = props;
  const sale = was !== undefined && was > price;
  return (
    <button
      type="button"
      className={`shop-buy${affordable ? "" : " is-short"}`}
      disabled={busy || !affordable}
      onClick={onBuy}
      title={affordable ? undefined : text.shop.cannotAfford}
    >
      <img className="shop-coin" src="/art/ui/prop-coins.png" alt="" aria-hidden="true" draggable={false} />
      {sale && <s className="shop-was">{format(text.shop.price, { gold: was })}</s>}
      <span className="shop-cost">{format(text.shop.price, { gold: price })}</span>
    </button>
  );
}

/**
 * The shop.
 *
 * Stock is content (`content/shop.json`), not "every item that exists" — the
 * streamer curates what's on offer, and the loader rejects a stocked id that
 * doesn't resolve, so a typo fails at startup rather than rendering a row
 * nobody can buy.
 *
 * Prices arrive already resolved from the server. Nothing here recomputes
 * them, so a buy button can't disagree with what the purchase charges.
 *
 * The stock list SCROLLS rather than expanding. It was collapsed behind a
 * "View More" and that is one tap between a player and the thing they came to
 * the shop for, every single time — a scrollbar says "there is more below"
 * just as clearly and costs nothing to use.
 */
export function ShopPanel({ character, catalog, onBuyGear, onBuyConsumable, busy }: ShopPanelProps): JSX.Element {
  // Icons draw the item's worn sprite, and worn gear is cut to fit a body.
  const bodyType = character.appearance.bodyType;
  const gearForSale = catalog.shop.gear
    .map((entry) => ({ entry, def: catalog.gearById.get(entry.id) }))
    .filter((row): row is { entry: (typeof catalog.shop.gear)[number]; def: GearDefinition } => row.def !== undefined);

  const consumablesForSale = catalog.shop.consumables
    .map((entry) => ({ entry, def: catalog.consumablesById.get(entry.id) }))
    .filter((row) => row.def !== undefined);

  const nothingStocked = gearForSale.length === 0 && consumablesForSale.length === 0;

  return (
    <section className="panel" data-section="shop">
      <header className="panel-head">
        <h2>{text.shop.heading}</h2>
        <span className="shop-purse">{format(text.character.goldLabel, { amount: character.gold })}</span>
      </header>

      {nothingStocked && <p className="hint">{text.shop.empty}</p>}

      {/* One scrolling body: gear and consumables move together, rather than
          the consumables sitting under a box nobody scrolls to the end of. */}
      <div className="shop-stock">
        {gearForSale.length > 0 && (
          <ul className="shop-grid">
            {gearForSale.map(({ entry, def }) => {
              const sale = entry.was !== undefined && entry.was > entry.price;
              return (
                <li key={def.id} className={`shop-card rarity-${def.rarity}`}>
                  {sale && (
                    <span className="shop-sale">
                      {format(text.shop.saleBadge, { pct: Math.round((1 - entry.price / entry.was!) * 100) })}
                    </span>
                  )}
                  <span className="shop-well">
                    <ItemIcon def={def} slot={def.slot} bodyType={bodyType} size={44} />
                  </span>
                  <span className="shop-card-body">
                    <span className="shop-card-name">{def.name}</span>
                    <span className="shop-card-kind">
                      <span className="shop-rarity">{text.gear.rarity[def.rarity]}</span> · {text.gear.slot[def.slot]}
                    </span>
                    <StatChips def={def} />
                  </span>
                  <PriceButton
                    price={entry.price}
                    was={entry.was}
                    affordable={character.gold >= entry.price}
                    busy={busy}
                    onBuy={() => onBuyGear(def.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {consumablesForSale.length > 0 && (
          <>
            <h3 className="sub-heading">{text.shop.consumablesHeading}</h3>
            <ul className="shop-grid">
              {consumablesForSale.map(({ entry, def }) => {
                if (!def) return null;
                const sale = entry.was !== undefined && entry.was > entry.price;
                return (
                  <li key={def.id} className={`shop-card is-consumable rarity-${def.rarity}`}>
                    {sale && (
                      <span className="shop-sale">
                        {format(text.shop.saleBadge, { pct: Math.round((1 - entry.price / entry.was!) * 100) })}
                      </span>
                    )}
                    <span className="shop-card-body">
                      <span className="shop-card-name">{def.name}</span>
                      <span className="shop-card-kind">
                        <span className="shop-rarity">{text.gear.rarity[def.rarity]}</span>
                      </span>
                      <span className="shop-card-desc">{def.description}</span>
                    </span>
                    <PriceButton
                      price={entry.price}
                      was={entry.was}
                      affordable={character.gold >= entry.price}
                      busy={busy}
                      onBuy={() => onBuyConsumable(def.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
