import { useEffect, useMemo, useState } from "react";
import type { ConsumableDefinition, GearDefinition, GearSlot, Rarity, ShopPricingInputs, ShopStock } from "../../../src/engine/types.js";
import { GEAR_SLOTS, RARITIES, STAT_KEYS } from "../../../src/engine/types.js";
import { DEFAULT_BALANCE } from "../../../src/engine/balance.js";
import {
  DEFAULT_SHOP_PRICING,
  gearValueOf,
  medianPowerByRarity,
  shopConsumableBasePriceOf,
  shopConsumablePriceOf,
  shopGearBasePriceOf,
  shopGearPriceOf,
  shopLoops,
  suggestedGearPriceOf,
} from "../../../src/engine/shopPricing.js";
import { SHOP_ADJUST_MAX, SHOP_ADJUST_MIN } from "../../../src/engine/content/schemas.js";
import { SLOT_FOLDER, spriteForGear, spriteUrl } from "../sprites.js";
import { text, format } from "../../../src/text/index.js";
import { backendMode, writeContent } from "./backend.js";
import "./shop.css";

export interface ShopTunerProps {
  gear: GearDefinition[];
  consumables: ConsumableDefinition[];
  /** The raw stock as saved, or null if the store holds none yet. */
  shop: ShopStock | null;
  onSaved: () => void;
  setStatus: (message: string) => void;
}

// The admin has no balance feed of its own (the hosted Edge Function does not
// send one), so defaults are priced against the shipped economy. They are only
// a hint beside the field; the server prices the real purchase.
const ECONOMY = DEFAULT_BALANCE.economy;

/** A consumable's editable words, held apart from the shop draft because they save to their own file. */
type ConsumableWords = Record<string, { name: string; description: string }>;

const EMPTY: ShopStock = { gear: [], consumables: [] };

/**
 * The note at the top of shop.json. The save writes the whole file and the
 * server's copy of it has no comment (validation drops unknown keys), so
 * without this the first save would erase the one line telling a reader who
 * owns the file. Keep it in step with content/shop.json by hand.
 */
const FILE_COMMENT =
  "What the shop stocks, in the order viewers see it. OWNED BY THE ADMIN PANEL (Shop tab): it writes this file, so a hand edit is overwritten by the next save. It began as the four cheapest items per slot from scripts/generate-gear-content.py, a testing default; the streamer curates it now. gearPrices / consumablePrices override the SHELF price only - an item otherwise sells at its value (consumables: their own price) - and recycling still pays from the item's value. NOTE: never stock a grantGold consumable whose payout exceeds its price; that is an infinite-gold loop.";

function statLine(def: GearDefinition): string {
  const parts = STAT_KEYS.filter((key) => (def.statMods[key] ?? 0) !== 0).map((key) => {
    const value = def.statMods[key]!;
    const shown = key === "crit" ? `${Math.round(value * 100)}%` : `${value}`;
    return `${value > 0 ? "+" : ""}${shown} ${text.stat[key]}`;
  });
  return parts.length ? parts.join(", ") : text.adminShop.noMods;
}

/** Move one entry by `by` places, staying inside the list. */
function moved<T>(list: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Prices live in two maps beside the id lists; when an id leaves the shelf its
 * price has to leave with it, or the saved file names a price for something
 * the shop does not stock - which the schema refuses.
 */
function pruned(stock: ShopStock): ShopStock {
  const keep = (prices: Record<string, number> | undefined, ids: string[]) => {
    const entries = Object.entries(prices ?? {}).filter(([id]) => ids.includes(id));
    return entries.length ? Object.fromEntries(entries) : undefined;
  };
  const out: ShopStock = { gear: stock.gear, consumables: stock.consumables };
  const gearPrices = keep(stock.gearPrices, stock.gear);
  const consumablePrices = keep(stock.consumablePrices, stock.consumables);
  // A 0% adjustment is no adjustment; keeping it would make an untouched shelf
  // read as edited.
  const gearAdjust = keep(stock.gearAdjust, stock.gear.filter((id) => stock.gearAdjust?.[id]));
  const consumableAdjust = keep(stock.consumableAdjust, stock.consumables.filter((id) => stock.consumableAdjust?.[id]));
  if (gearPrices) out.gearPrices = gearPrices;
  if (consumablePrices) out.consumablePrices = consumablePrices;
  if (gearAdjust) out.gearAdjust = gearAdjust;
  if (consumableAdjust) out.consumableAdjust = consumableAdjust;
  if (stock.pricing) out.pricing = stock.pricing;
  return out;
}

/**
 * What the shop sells, and for how much.
 *
 * Edits a draft and writes the WHOLE file on Save, like the placement editor:
 * one file, so there is no partial state to reconcile, and a rejected save
 * leaves the shelf the viewers see exactly as it was.
 *
 * A price here is the SHELF price (`gearPrices` / `consumablePrices` in
 * shop.json), not the item's `value` - see ShopStock for why.
 */
export function ShopTuner({ gear, consumables, shop, onSaved, setStatus }: ShopTunerProps): JSX.Element {
  const saved = useMemo(() => pruned(shop ?? EMPTY), [shop]);
  const [draft, setDraft] = useState<ShopStock>(saved);
  const [saving, setSaving] = useState(false);
  const [slot, setSlot] = useState<GearSlot | "">("");
  const [rarity, setRarity] = useState<Rarity | "">("");
  const [needle, setNeedle] = useState("");
  const [words, setWords] = useState<ConsumableWords>({});

  // A reload after a save, or the first read landing, replaces the draft. An
  // unsaved edit is never lost to a refresh because `saved` only changes when
  // the content does.
  useEffect(() => setDraft(saved), [saved]);
  useEffect(() => setWords({}), [consumables]);

  const gearById = useMemo(() => new Map(gear.map((g) => [g.id, g])), [gear]);
  const consumableById = useMemo(() => new Map(consumables.map((c) => [c.id, c])), [consumables]);

  const pricing: ShopPricingInputs = draft.pricing ?? DEFAULT_SHOP_PRICING;
  // Medians from the whole catalogue, not the shelf: a suggestion should not
  // move because an item was stocked or taken off.
  const medians = useMemo(() => medianPowerByRarity(gear, DEFAULT_BALANCE), [gear]);
  const suggest = (def: GearDefinition) => suggestedGearPriceOf(def, pricing, medians, DEFAULT_BALANCE);
  const runsFor = (gold: number) => Math.max(0.1, Math.round((gold / pricing.goldPerRun) * 10) / 10);

  const editedWords = Object.entries(words).filter(([id, w]) => {
    const def = consumableById.get(id);
    return def && (w.name !== def.name || w.description !== def.description);
  });
  const wordsInvalid = editedWords.some(([, w]) => w.name.trim() === "");
  const dirty = JSON.stringify(pruned(draft)) !== JSON.stringify(saved) || editedWords.length > 0;
  const loops = useMemo(
    () => shopLoops(pruned(draft), (id) => gearById.get(id), (id) => consumableById.get(id), ECONOMY),
    [draft, gearById, consumableById],
  );
  const loopFor = (kind: "gear" | "consumable", id: string) => loops.find((l) => l.kind === kind && l.id === id);

  const catalogue = useMemo(() => {
    const q = needle.trim().toLowerCase();
    return gear
      .filter((g) => !draft.gear.includes(g.id))
      .filter((g) => !slot || g.slot === slot)
      .filter((g) => !rarity || g.rarity === rarity)
      .filter((g) => !q || g.name.toLowerCase().includes(q) || g.id.includes(q))
      .sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.name.localeCompare(b.name));
  }, [gear, draft.gear, slot, rarity, needle]);

  const consumablesToAdd = consumables.filter((c) => !draft.consumables.includes(c.id));

  const setAdjust = (key: "gearAdjust" | "consumableAdjust", id: string, raw: string) => {
    const next = { ...(draft[key] ?? {}) };
    const pct = Math.round(Number(raw));
    if (raw.trim() === "" || !Number.isFinite(pct) || pct === 0) delete next[id];
    else next[id] = Math.min(SHOP_ADJUST_MAX, Math.max(SHOP_ADJUST_MIN, pct));
    setDraft({ ...draft, [key]: next });
  };

  const setPricing = (next: ShopPricingInputs) => setDraft({ ...draft, pricing: next });

  const applySuggestedToAll = () => {
    const gearPrices = { ...(draft.gearPrices ?? {}) };
    for (const id of draft.gear) {
      const def = gearById.get(id);
      if (def) gearPrices[id] = suggest(def);
    }
    setDraft({ ...draft, gearPrices, pricing });
    setStatus(text.adminShop.applyAllDone);
  };

  const setWord = (def: ConsumableDefinition, field: "name" | "description", value: string) => {
    const current = words[def.id] ?? { name: def.name, description: def.description };
    setWords({ ...words, [def.id]: { ...current, [field]: value } });
  };

  const setPrice = (
    key: "gearPrices" | "consumablePrices",
    id: string,
    raw: string,
  ) => {
    const next = { ...(draft[key] ?? {}) };
    // Empty means "use the default", so the override is removed rather than
    // stored as 0 - a free item is a decision, not an unfilled box.
    if (raw.trim() === "") delete next[id];
    else next[id] = Math.max(0, Math.floor(Number(raw) || 0));
    setDraft({ ...draft, [key]: next });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Consumables first: they are separate files, and the shop file is the
      // one viewers see change, so it should land last and only if they did.
      for (const [id, w] of editedWords) {
        const def = consumableById.get(id)!;
        await writeContent("consumable", id, { ...def, name: w.name.trim(), description: w.description.trim() });
      }
      await writeContent("shop", "shop", { _comment: FILE_COMMENT, ...pruned({ ...draft, pricing }) });
      const hosted = (await backendMode()) === "hosted";
      setStatus(
        editedWords.length
          ? `${format(text.adminShop.consumableSaved, { n: editedWords.length })}${hosted ? ` ${text.adminShop.consumableHostedNote}` : ""}`
          : hosted
            ? text.adminShop.savedHosted
            : text.adminShop.saved,
      );
      setWords({});
      onSaved();
    } catch (err) {
      setStatus(format(text.adminShop.rejected, { reason: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const gearRows = draft.gear.map((id) => ({ id, def: gearById.get(id) }));

  return (
    <div className="shop-tuner">
      <div className="shop-bar">
        <button type="button" disabled={!dirty || saving || loops.length > 0 || wordsInvalid} onClick={() => void save()}>
          {text.adminShop.save}
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(saved);
            setWords({});
          }}
        >
          {text.adminShop.revert}
        </button>
        {dirty && <span className="shop-dirty">{text.adminShop.unsaved}</span>}
        {loops.length > 0 && <span className="shop-loop">{text.adminShop.saveBlocked}</span>}
        {wordsInvalid && <span className="shop-loop">{text.adminShop.consumableNeedsName}</span>}
      </div>
      {/* Standing, not a tooltip: it is the one mistake here that costs a
          stream its economy. */}
      <p className="admin-hint shop-warning">{text.adminShop.goldLoopWarning}</p>

      <section className="shop-section shop-pricing">
        <h2>{text.adminShop.pricingHeading}</h2>
        <p className="admin-hint">{text.adminShop.pricingIntro}</p>
        <div className="pricing-inputs">
          <label>
            <span>{text.adminShop.goldPerRun}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={pricing.goldPerRun}
              onChange={(e) => setPricing({ ...pricing, goldPerRun: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            />
            <span className="shop-sub">{text.adminShop.goldPerRunHint}</span>
          </label>
          {RARITIES.map((r) => (
            <label key={r} className={`rarity-${r}`}>
              <span>{format(text.adminShop.runsFor, { rarity: text.gear.rarity[r] })}</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={pricing.runsByRarity[r]}
                onChange={(e) =>
                  setPricing({
                    ...pricing,
                    runsByRarity: { ...pricing.runsByRarity, [r]: Math.max(0.5, Number(e.target.value) || 0.5) },
                  })
                }
              />
            </label>
          ))}
        </div>
        <button type="button" className="pricing-apply" onClick={applySuggestedToAll} disabled={draft.gear.length === 0}>
          {text.adminShop.applyAll}
        </button>
      </section>

      <section className="shop-section">
        <h2>{text.adminShop.gearHeading}</h2>
        <p className="admin-hint">{text.adminShop.orderHint}</p>
        {gearRows.length === 0 && <p className="admin-hint">{text.adminShop.empty}</p>}
        <ul className="shop-list">
          {gearRows.map(({ id, def }, index) => {
            if (!def) {
              return (
                <li key={id} className="shop-row is-missing">
                  <span className="shop-name">{id}</span>
                  <button type="button" onClick={() => setDraft({ ...draft, gear: draft.gear.filter((g) => g !== id) })}>
                    {text.adminShop.remove}
                  </button>
                </li>
              );
            }
            const folder = SLOT_FOLDER[def.slot];
            const sprite = spriteForGear(def, def.bodyTypes?.[0] ?? "male");
            const loop = loopFor("gear", id);
            const price = shopGearPriceOf(draft, def, ECONOMY);
            const base = shopGearBasePriceOf(draft, def, ECONOMY);
            const suggested = suggest(def);
            return (
              <li key={id} className={`shop-row rarity-${def.rarity}`}>
                {folder && sprite ? <img className="shop-icon" src={spriteUrl(folder, sprite)} alt="" /> : <span className="shop-icon" />}
                <span className="shop-info">
                  <span className="shop-name">{def.name}</span>
                  <span className="shop-sub">
                    {text.gear.slot[def.slot]} · {text.gear.rarity[def.rarity]} · {statLine(def)}
                  </span>
                  {def.enabled === false && <span className="shop-sub is-warn">{text.adminShop.disabled}</span>}
                  {loop && (
                    <span className="shop-sub is-loop">
                      {format(text.adminShop.loopRecycle, { price: loop.price, refund: loop.payout })}
                    </span>
                  )}
                </span>
                <span className="shop-pricing-cell">
                  <label className="shop-price" title={text.adminShop.priceHint}>
                    <span>{text.adminShop.price}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.gearPrices?.[id] ?? ""}
                      placeholder={String(gearValueOf(def, ECONOMY))}
                      onChange={(e) => setPrice("gearPrices", id, e.target.value)}
                    />
                  </label>
                  <label className="shop-price" title={text.adminShop.adjustHint}>
                    <span>{text.adminShop.adjust}</span>
                    <input
                      type="number"
                      min={SHOP_ADJUST_MIN}
                      max={SHOP_ADJUST_MAX}
                      step={5}
                      value={draft.gearAdjust?.[id] ?? ""}
                      placeholder="0"
                      onChange={(e) => setAdjust("gearAdjust", id, e.target.value)}
                    />
                  </label>
                  <span className="shop-sub">
                    {format(text.adminShop.suggested, { gold: suggested })}{" "}
                    {base !== suggested && (
                      <button type="button" className="link-button" onClick={() => setPrice("gearPrices", id, String(suggested))}>
                        {text.adminShop.useSuggested}
                      </button>
                    )}
                  </span>
                  <span className={`shop-final${price !== base ? " is-adjusted" : ""}`}>
                    {price !== base && <s>{format(text.shop.price, { gold: base })}</s>} {format(text.adminShop.finalPrice, { gold: price })}
                  </span>
                  <span className="shop-sub">{format(text.adminShop.runsToAfford, { runs: runsFor(price) })}</span>
                </span>
                <span className="shop-actions">
                  <button type="button" disabled={index === 0} onClick={() => setDraft({ ...draft, gear: moved(draft.gear, index, -1) })}>
                    {text.adminShop.moveUp}
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.gear.length - 1}
                    onClick={() => setDraft({ ...draft, gear: moved(draft.gear, index, 1) })}
                  >
                    {text.adminShop.moveDown}
                  </button>
                  <button type="button" onClick={() => setDraft({ ...draft, gear: draft.gear.filter((g) => g !== id) })}>
                    {text.adminShop.remove}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="shop-section">
        <h2>{text.adminShop.consumablesHeading}</h2>
        <ul className="shop-list">
          {draft.consumables.map((id, index) => {
            const def = consumableById.get(id);
            const loop = loopFor("consumable", id);
            return (
              <li key={id} className={`shop-row ${def ? `rarity-${def.rarity}` : "is-missing"}`}>
                <span className="shop-info">
                  {!def && <span className="shop-name">{id}</span>}
                  {def && (
                    <>
                      <label className="consumable-field">
                        <span>{text.adminShop.consumableName}</span>
                        <input
                          type="text"
                          id={`consumable-name-${id}`}
                          value={words[id]?.name ?? def.name}
                          onChange={(e) => setWord(def, "name", e.target.value)}
                        />
                      </label>
                      <label className="consumable-field">
                        <span>{text.adminShop.consumableDescription}</span>
                        <textarea
                          id={`consumable-description-${id}`}
                          rows={2}
                          value={words[id]?.description ?? def.description}
                          onChange={(e) => setWord(def, "description", e.target.value)}
                        />
                      </label>
                      <span className="shop-sub">
                        {text.gear.rarity[def.rarity]} ·{" "}
                        {format(def.effect.type === "grantXp" ? text.adminShop.effectXp : text.adminShop.effectGold, {
                          amount: def.effect.amount,
                        })}
                        {editedWords.some(([e]) => e === id) && <> · {text.adminShop.consumableEdited}</>}
                      </span>
                    </>
                  )}
                  {loop && (
                    <span className="shop-sub is-loop">
                      {format(text.adminShop.loopGold, { price: loop.price, payout: loop.payout })}
                    </span>
                  )}
                </span>
                {def && (
                  <span className="shop-pricing-cell">
                    <label className="shop-price">
                      <span>{text.adminShop.price}</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft.consumablePrices?.[id] ?? ""}
                        placeholder={String(def.price)}
                        onChange={(e) => setPrice("consumablePrices", id, e.target.value)}
                      />
                    </label>
                    <label className="shop-price" title={text.adminShop.adjustHint}>
                      <span>{text.adminShop.adjust}</span>
                      <input
                        type="number"
                        min={SHOP_ADJUST_MIN}
                        max={SHOP_ADJUST_MAX}
                        step={5}
                        value={draft.consumableAdjust?.[id] ?? ""}
                        placeholder="0"
                        onChange={(e) => setAdjust("consumableAdjust", id, e.target.value)}
                      />
                    </label>
                    {(() => {
                      const price = shopConsumablePriceOf(draft, def);
                      const base = shopConsumableBasePriceOf(draft, def);
                      return (
                        <span className={`shop-final${price !== base ? " is-adjusted" : ""}`}>
                          {price !== base && <s>{format(text.shop.price, { gold: base })}</s>} {format(text.adminShop.finalPrice, { gold: price })}
                        </span>
                      );
                    })()}
                  </span>
                )}
                <span className="shop-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => setDraft({ ...draft, consumables: moved(draft.consumables, index, -1) })}
                  >
                    {text.adminShop.moveUp}
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.consumables.length - 1}
                    onClick={() => setDraft({ ...draft, consumables: moved(draft.consumables, index, 1) })}
                  >
                    {text.adminShop.moveDown}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, consumables: draft.consumables.filter((c) => c !== id) })}
                  >
                    {text.adminShop.remove}
                  </button>
                </span>
              </li>
            );
          })}
          {consumablesToAdd.map((def) => (
            <li key={def.id} className="shop-row is-candidate">
              <span className="shop-info">
                <span className="shop-name">{def.name}</span>
                <span className="shop-sub">{format(text.shop.price, { gold: def.price })}</span>
              </span>
              <button type="button" onClick={() => setDraft({ ...draft, consumables: [...draft.consumables, def.id] })}>
                {text.adminShop.add}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="shop-section">
        <h2>{text.adminShop.addHeading}</h2>
        <div className="shop-filters">
          <select value={slot} onChange={(e) => setSlot(e.target.value as GearSlot | "")}>
            <option value="">{text.adminShop.allSlots}</option>
            {GEAR_SLOTS.map((s) => (
              <option key={s} value={s}>
                {text.gear.slot[s]}
              </option>
            ))}
          </select>
          <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity | "")}>
            <option value="">{text.adminShop.allRarities}</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {text.gear.rarity[r]}
              </option>
            ))}
          </select>
          <input type="search" value={needle} placeholder={text.adminShop.search} onChange={(e) => setNeedle(e.target.value)} />
        </div>
        {catalogue.length === 0 && <p className="admin-hint">{text.adminShop.nothingToAdd}</p>}
        <ul className="shop-list">
          {catalogue.map((def) => {
            const folder = SLOT_FOLDER[def.slot];
            const sprite = spriteForGear(def, def.bodyTypes?.[0] ?? "male");
            return (
              <li key={def.id} className={`shop-row is-candidate rarity-${def.rarity}`}>
                {folder && sprite ? <img className="shop-icon" src={spriteUrl(folder, sprite)} alt="" /> : <span className="shop-icon" />}
                <span className="shop-info">
                  <span className="shop-name">{def.name}</span>
                  <span className="shop-sub">
                    {text.gear.slot[def.slot]} · {text.gear.rarity[def.rarity]} · {statLine(def)} ·{" "}
                    {format(text.adminShop.suggested, { gold: suggest(def) })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    // Stocked at the suggested price, so a new item never lands
                    // on the shelf at its bare value (a legendary for 600g).
                    setDraft({
                      ...draft,
                      gear: [...draft.gear, def.id],
                      gearPrices: { ...(draft.gearPrices ?? {}), [def.id]: suggest(def) },
                      pricing,
                    })
                  }
                >
                  {text.adminShop.add}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
