import type { BalanceConfig } from "../../../src/engine/balance.js";
import { text, format } from "../../../src/text/index.js";

/** A fraction as a whole-number percentage: 0.15 -> "15". */
function pc(fraction: number): string {
  const n = fraction * 100;
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/**
 * The rules, for someone who has never seen the game.
 *
 * Same rule as the role tooltips: anything tunable is read from
 * `content/balance.json` at render time rather than typed into the copy. A
 * rules page is the worst place in a game to keep a stale number — it is
 * exactly where a player goes when they want to trust something.
 *
 * Deliberately short. The long version of this is the wiki nobody writes.
 */
export function HowToPlayScreen({ balance }: { balance: BalanceConfig }): JSX.Element {
  const t = text.loadout.howToPlay;
  const { steps, stats, roles, gear, raids, commands } = t;

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>{t.title}</h2>
        <p className="screen-lead">{t.lead}</p>
      </header>

      <h3 className="screen-h">{steps.title}</h3>
      <ol className="how-steps">
        <li>
          <strong>{steps.join.title}</strong>
          <span>{steps.join.body}</span>
        </li>
        <li>
          <strong>{steps.fight.title}</strong>
          <span>{steps.fight.body}</span>
        </li>
        <li>
          <strong>{steps.loot.title}</strong>
          <span>
            {format(steps.loot.body, { defeatShare: pc(balance.rewards.defeatXpMultiplier) })}
          </span>
        </li>
      </ol>

      <h3 className="screen-h">{raids.title}</h3>
      <p className="how-body">{raids.body}</p>

      <h3 className="screen-h">{stats.title}</h3>
      <dl className="how-stats">
        <div>
          <dt>{text.stat.hp}</dt>
          <dd>{stats.hp}</dd>
        </div>
        <div>
          <dt>{text.stat.atk}</dt>
          <dd>{stats.atk}</dd>
        </div>
        <div>
          <dt>{text.stat.skill}</dt>
          {/* At skill == skillCurveK the mitigation curve is exactly half,
              whatever K is tuned to - so this sentence survives a retune. */}
          <dd>{format(stats.skill, { k: String(balance.combat.skillCurveK) })}</dd>
        </div>
        <div>
          <dt>{text.stat.spd}</dt>
          <dd>{stats.spd}</dd>
        </div>
      </dl>

      <h3 className="screen-h">{roles.title}</h3>
      <p className="how-body">
        {format(roles.body, {
          scarceBonus: String(Math.round((balance.roleRarity.scarceMultiplier - 1) * 100)),
          scarceBelow: pc(balance.roleRarity.scarceBelowShare),
        })}
      </p>

      <h3 className="screen-h">{gear.title}</h3>
      <p className="how-body">{gear.body}</p>

      <h3 className="screen-h">{commands.title}</h3>
      <dl className="how-stats">
        <div>
          <dt>!join</dt>
          <dd>{commands.join}</dd>
        </div>
        <div>
          <dt>!left !up !right</dt>
          <dd>{commands.path}</dd>
        </div>
      </dl>
    </section>
  );
}
