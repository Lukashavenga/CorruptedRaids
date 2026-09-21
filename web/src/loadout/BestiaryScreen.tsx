import { useMemo, useState } from "react";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { enemySpriteUrl } from "../sprites.js";

/**
 * What lives out there.
 *
 * The nav had a dimmed Bestiary entry that did nothing, and AGENTS.md section
 * 10 put the choice plainly: build it or take it out, because leaving it
 * teaches players that dimmed things are decoration.
 *
 * READS A PREBUILT INDEX, not the dungeons in the catalogue. The obvious
 * version of this screen walks `catalog.dungeons` and `catalog.raids` and
 * dedupes their formations in the browser. It works perfectly against a local
 * game server and renders "0 known" for every real player, because those two
 * arrays come from `GET /content` and the hosted loadout is a static site with
 * no game server to ask. That is the third time today the same shape has
 * bitten - placements and the shop's prices were the first two - so the data
 * is shipped as a file and the dedupe happens at build time. See
 * scripts/bundle-edge-content.ts.
 *
 * NOT A SPOILER, and worth being explicit about since the overlay works hard
 * to avoid being one. RaidView withholds a door's `kind` until it is opened,
 * because a choice whose answer is visible in devtools is not a choice. That
 * is about WHICH ROOM IS BEHIND WHICH DOOR tonight. Which rooms exist at all
 * is the pool, and it is what a player wants to look up between runs. Loot
 * tables are a different question and are deliberately not in the index.
 */

export interface BestiaryScreenProps {
  catalog: ContentCatalog;
}

export function BestiaryScreen({ catalog }: BestiaryScreenProps): JSX.Element {
  const [query, setQuery] = useState("");

  const total = useMemo(
    () => catalog.bestiary.reduce((n, place) => n + place.bodies.length, 0),
    [catalog.bestiary],
  );

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!needle) return catalog.bestiary;
    return catalog.bestiary
      .map((place) => ({
        ...place,
        // Place names are searchable too, so "long road" finds everything in
        // the raid rather than only a body named after it.
        bodies: place.bodies.filter((b) =>
          `${b.name} ${b.sprite} ${place.name} ${place.room ?? ""}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((place) => place.bodies.length > 0);
  }, [catalog.bestiary, needle]);

  return (
    <section className="panel bestiary">
      <header className="panel-head">
        <h2>Bestiary</h2>
        <span className="bestiary-count">{total} known</span>
      </header>

      <p className="hint">
        Base stats, before the fight&apos;s own curve and before it scales to however
        many people turn up. Shapes, not numbers.
      </p>

      <input
        type="search"
        className="bestiary-search"
        placeholder="Search by name or place"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search the bestiary"
      />

      {total === 0 && <p className="hint">The bestiary has not loaded.</p>}
      {total > 0 && shown.length === 0 && <p className="hint">Nothing matches that.</p>}

      {shown.map((place) => (
        <div key={place.id} className="bestiary-place">
          <h3 className="sub-heading">
            {place.name}
            {place.room && <span className="bestiary-room"> / {place.room}</span>}
          </h3>

          <ul className="bestiary-grid">
            {place.bodies.map((body) => (
              <li key={`${place.id}:${body.sprite}:${body.name}`} className="bestiary-card">
                <span className="bestiary-art">
                  <img src={enemySpriteUrl(body.sprite)} alt="" loading="lazy" />
                </span>
                <span className="bestiary-body">
                  <span className="bestiary-name">{body.name}</span>
                  <span className="bestiary-stats">
                    {body.hp} HP &middot; {body.atk} ATK
                    {body.role ? ` · ${body.role}` : ""}
                  </span>
                  {/* The answer to "what is that thing I have never seen
                      before": a body no weak formation fields. */}
                  {body.rare && <span className="bestiary-rare">Larger parties only</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
