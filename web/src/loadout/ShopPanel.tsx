import { STAT_KEYS } from "../../../src/engine/types.js";
import type { GearDefinition } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { ItemIcon } from "./ItemIcon.js";
import { text, format } from "../../../src/text/index.js";

export interface ShopPanelProps {
  character: CharacterView;
  catalog: ContentCatalog;
  onBuyGear: (gearId: string) => void;
  onBuyConsumable: (consumableId: string) => void;
  busy: boolean;
}

function statLine(def: GearDefinition): string {
  return STAT_KEYS.filter((key) => (def.statMods[key] ?? 0) !== 0)
    .map((key) => {
      const value = def.statMods[key]!;
      const shown = key === "crit" ? `${Math.round(value * 100)}%` : `${value}`;
      return `${value > 0 ? "+" : ""}${shown} ${text.stat[key]}`;
    })
    .join(", ");
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
          <ul className="bag">
            {gearForSale.map(({ entry, def }) => {
              const affordable = character.gold >= entry.price;
              return (
                <li key={def.id} className={`bag-item rarity-${def.rarity}`}>
                  <ItemIcon def={def} slot={def.slot} bodyType={bodyType} size={34} />
                  <span className="bag-info">
                    <span className="slot-name">{def.name}</span>
                    <span className="bag-sub">
                      {text.gear.slot[def.slot]} · {text.gear.rarity[def.rarity]} ·{" "}
                      {/* text.stat, not the raw key: the engine's shorthand is
                          hp/atk/armour and a player has never seen those
                          words (AGENTS.md §8). */}
                      {Object.entries(def.requires ?? {})
                        .map(([stat, need]) => `${need} ${text.stat[stat as keyof typeof text.stat] ?? stat}`)
                        .join(", ") || text.gear.noRequirement}
                    </span>
                    <span className="slot-mods">{statLine(def)}</span>
                  </span>
                  <button
                    type="button"
                    className="small"
                    disabled={busy || !affordable}
                    onClick={() => onBuyGear(def.id)}
                    title={affordable ? undefined : text.shop.cannotAfford}
                  >
                    {format(text.shop.price, { gold: entry.price })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {consumablesForSale.length > 0 && (
          <>
            <h3 className="sub-heading">{text.shop.consumablesHeading}</h3>
            <ul className="bag">
              {consumablesForSale.map(({ entry, def }) => {
                if (!def) return null;
                const affordable = character.gold >= entry.price;
                return (
                  <li key={def.id} className={`bag-item rarity-${def.rarity}`}>
                    <span className="bag-info">
                      <span className="slot-name">{def.name}</span>
                      <span className="bag-sub">{def.description}</span>
                    </span>
                    <button
                      type="button"
                      className="small"
                      disabled={busy || !affordable}
                      onClick={() => onBuyConsumable(def.id)}
                      title={affordable ? undefined : text.shop.cannotAfford}
                    >
                      {format(text.shop.price, { gold: entry.price })}
                    </button>
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
