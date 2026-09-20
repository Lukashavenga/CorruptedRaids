import { useState } from "react";
import type { GearSlot } from "../../../src/engine/types.js";
import { GEAR_SLOTS } from "../../../src/engine/types.js";
import { text, format } from "../../../src/text/index.js";
import { SlotIcon } from "./SlotIcon.js";
import { haptic, hapticsEnabled, hapticsSupported, setHapticsEnabled } from "./haptics.js";

export interface SettingsScreenProps {
  viewerId: string;
  hiddenSlots: GearSlot[];
  toggleHidden: (slot: GearSlot) => void;
  onRespec: () => void;
  busy: boolean;
}

/**
 * Per-viewer preferences.
 *
 * Everything here except the respec is stored in THIS BROWSER, because none of
 * it is game state — the server has no opinion about whether you want your own
 * helmet drawn. Routing a display preference through a GameCommand would mean
 * the combat resolver's inputs could differ based on taste, which is the exact
 * coupling the command seam exists to prevent (see useHiddenSlots).
 *
 * Deliberately small. There are three things a player can actually decide
 * right now, and inventing a screen of plausible-looking toggles that do
 * nothing would be worse than a short honest one.
 */
export function SettingsScreen({
  viewerId,
  hiddenSlots,
  toggleHidden,
  onRespec,
  busy,
}: SettingsScreenProps): JSX.Element {
  const t = text.loadout.settings;
  const [copied, setCopied] = useState(false);
  const canBuzz = hapticsSupported();
  const [buzz, setBuzz] = useState(hapticsEnabled);

  const link = `${window.location.origin}${window.location.pathname}?viewer=${encodeURIComponent(viewerId)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is refused in some contexts. The field is selectable, so
      // there is still a way to get the link out.
    }
  };

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>{t.title}</h2>
        <p className="screen-lead">{t.lead}</p>
      </header>

      <h3 className="screen-h">{t.display.title}</h3>
      <p className="settings-label">{t.display.hiddenSlots}</p>
      <p className="settings-hint">{t.display.hiddenSlotsHint}</p>
      <div className="settings-slots">
        {GEAR_SLOTS.map((slot) => {
          const hidden = hiddenSlots.includes(slot);
          return (
            <button
              key={slot}
              type="button"
              className={`settings-slot ${hidden ? "is-hidden" : ""}`}
              aria-pressed={hidden}
              onClick={() => toggleHidden(slot)}
            >
              <SlotIcon slot={slot} size={22} />
              <span>{text.gear.slot[slot]}</span>
            </button>
          );
        })}
      </div>
      <p className="settings-hint">
        {hiddenSlots.length === 0
          ? t.display.noneHidden
          : format(t.display.hiddenCount, { count: hiddenSlots.length })}
      </p>

      <h3 className="screen-h">{t.feel.title}</h3>
      <p className="settings-label">{t.feel.haptics}</p>
      <p className="settings-hint">{canBuzz ? t.feel.hapticsHint : t.feel.unsupported}</p>
      <button
        type="button"
        className={`screen-action${buzz && canBuzz ? " is-on" : ""}`}
        disabled={!canBuzz}
        aria-pressed={buzz && canBuzz}
        onClick={() => {
          const next = !buzz;
          setBuzz(next);
          setHapticsEnabled(next);
          // Buzz on the way ON, so the control demonstrates the thing it
          // controls. Turning it off silently is the correct opposite.
          if (next) haptic("commit");
        }}
      >
        {buzz && canBuzz ? t.feel.on : t.feel.off}
      </button>

      <h3 className="screen-h">{t.identity.title}</h3>
      <p className="settings-label">{t.identity.viewerId}</p>
      <p className="settings-hint">{t.identity.viewerIdHint}</p>
      <div className="settings-row">
        <input className="settings-input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button type="button" className="screen-action" onClick={() => void copy()}>
          {copied ? t.identity.copied : t.identity.copy}
        </button>
      </div>

      <h3 className="screen-h">{t.danger.title}</h3>
      <p className="settings-hint">{t.danger.respec}</p>
      <button type="button" className="screen-action is-danger" disabled={busy} onClick={onRespec}>
        {t.danger.respecButton}
      </button>
    </section>
  );
}
