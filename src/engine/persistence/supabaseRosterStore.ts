import type { Character } from "../types.js";
import { parseRoster, type PullResult, type RosterStore, type SnapshotInfo } from "./rosterStore.js";

/**
 * Characters in Supabase Postgres, shared with the hosted loadout.
 *
 * NO SDK. This talks to PostgREST — the REST API every Supabase project
 * already exposes — with Node's global `fetch`. `@supabase/supabase-js` is a
 * large dependency whose realtime, auth and storage clients this needs none
 * of, and the server is otherwise dependency-free.
 *
 * WHY IT ONLY WRITES WHAT CHANGED
 * -------------------------------
 * The game server is no longer the only writer. A viewer can equip something
 * on their phone while a stream is running, and the server has the whole
 * roster in memory. If a save wrote every character back, it would reliably
 * undo them — the classic lost update, except the loser is always the person
 * who is not the streamer.
 *
 * So this keeps the serialisation of every character as it was last written,
 * and each save upserts only the rows that differ. A phone edit to a character
 * the server has not touched is never overwritten, because that row is never
 * in the request.
 *
 * That only protects a character the server has NOT touched. One that edits
 * their gear and then fights was a different story: the server's copy was the
 * one read at boot, so the fight used the old gear and its save wrote the old
 * gear back. `pull` is the other half - the server re-reads a character when
 * they join and while the join window is open, so the copy it fights with and
 * saves from is the one the viewer last edited.
 *
 * It also never DELETES. A character missing from the in-memory roster is far
 * more likely to be a local reset than a real deletion, and the cost of being
 * wrong is asymmetric: a stale row is untidy, a deleted one is somebody's
 * account. Removal is explicit — see `forget`.
 *
 * WHICH KEY: the SERVICE ROLE key, which bypasses row level security by
 * design. It must never reach a browser, and it does not — nothing in web/
 * knows this file exists. The loadout reaches the same tables with the
 * viewer's own token and the policies in sql/001_roster.sql.
 */
export class SupabaseRosterStore implements RosterStore {
  private readonly base: string;
  /** id -> the JSON last written for it, so a save can tell what actually moved. */
  private readonly written = new Map<string, string>();
  /**
   * id -> the row's `updated_at` (epoch ms) as this store last saw it, so a
   * pull fetches whole rows only for characters somebody else has written.
   */
  private readonly stamps = new Map<string, number>();

  constructor(
    url: string,
    private readonly serviceKey: string,
  ) {
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
  }

  /** Configured from the environment, or null when Supabase is not set up. */
  static fromEnv(): SupabaseRosterStore | null {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return null;
    return new SupabaseRosterStore(url, key);
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
    if (!res.ok) {
      // PostgREST's body names the missing table or the failed constraint,
      // which is far more use than the status on its own.
      throw new Error(
        `Supabase ${init.method ?? "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    return res;
  }

  async load(): Promise<Character[]> {
    // Paged, because PostgREST caps a response and a channel that has been
    // running a while will pass it. Silently loading the first thousand
    // characters and dropping the rest would look exactly like working.
    const page = 1000;
    const rows: { id: string; data: unknown; updated_at?: string }[] = [];
    for (let from = 0; ; from += page) {
      const res = await this.call(`/characters?select=id,data,updated_at&order=id.asc`, {
        headers: { Range: `${from}-${from + page - 1}`, "Range-Unit": "items" },
      });
      const batch = (await res.json()) as { id: string; data: unknown; updated_at?: string }[];
      rows.push(...batch);
      if (batch.length < page) break;
    }
    this.stamps.clear();
    for (const r of rows) if (r.updated_at) this.stamps.set(r.id, Date.parse(r.updated_at));

    const characters = parseRoster(
      { version: 1, characters: rows.map((r) => r.data) },
      (m) => console.warn(`[roster:supabase] ${m}`),
    );
    // Remember what came back, so the first save writes only genuine changes
    // rather than every row we just read.
    this.written.clear();
    for (const c of characters) this.written.set(c.id, JSON.stringify(c));
    return characters;
  }

  async save(characters: Character[]): Promise<void> {
    const changed: { id: string; twitch_id: string | null; data: Character; updated_at: string }[] = [];
    const now = new Date().toISOString();

    for (const c of characters) {
      const json = JSON.stringify(c);
      if (this.written.get(c.id) === json) continue;
      changed.push({ id: c.id, twitch_id: twitchIdOf(c.id), data: c, updated_at: now });
    }
    if (changed.length === 0) return;

    await this.call("/characters", {
      method: "POST",
      // merge-duplicates makes this an upsert on the primary key; return=minimal
      // stops Postgres sending every row back for a value nobody reads.
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(changed),
    });

    // Only after the write succeeds. Recording it first would mean a failed
    // save quietly marked those characters clean and the next one skipped them.
    for (const row of changed) {
      this.written.set(row.id, JSON.stringify(row.data));
      this.stamps.set(row.id, Date.parse(row.updated_at));
    }
  }

  async pull(
    ids: readonly string[],
    live: (id: string) => Character | undefined,
    install: (fresh: Character) => boolean,
  ): Promise<PullResult> {
    const result: PullResult = { installed: [], conflicts: [] };
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return result;

    // Two steps, so the join window can poll a whole party every few seconds:
    // `updated_at` alone first, and the full row only for characters written
    // since this store last saw them - by the loadout, normally.
    const stamped = (await (
      await this.call(`/characters?select=id,updated_at&id=in.(${inList(wanted)})`)
    ).json()) as { id: string; updated_at: string }[];
    const moved = stamped.filter((r) => Date.parse(r.updated_at) !== this.stamps.get(r.id)).map((r) => r.id);
    if (moved.length === 0) return result;

    const rows = (await (
      await this.call(`/characters?select=id,data,updated_at&id=in.(${inList(moved)})`)
    ).json()) as { id: string; data: unknown; updated_at: string }[];

    // Synchronous from here on, so nothing can change a live copy between
    // checking that it is untouched and replacing it.
    for (const row of rows) {
      const [fresh] = parseRoster({ version: 1, characters: [row.data] }, (m) =>
        console.warn(`[roster:supabase] ${m}`),
      );
      if (!fresh) continue;
      const at = Date.parse(row.updated_at);
      const baseline = this.written.get(fresh.id);

      // This store's own save, read back: nothing new.
      if (baseline !== undefined && canonical(fresh) === canonical(JSON.parse(baseline))) {
        this.stamps.set(fresh.id, at);
        continue;
      }

      // Both sides moved since the last save. The server's change is a fight's
      // rewards, and its save is at most a debounce away, so it wins - as it
      // always did. Not stamped, so the next pull looks again.
      const mine = live(fresh.id);
      const untouched =
        mine === undefined || (baseline !== undefined && canonical(mine) === canonical(JSON.parse(baseline)));
      if (!untouched) {
        result.conflicts.push(fresh.id);
        continue;
      }

      if (!install(fresh)) continue;
      this.written.set(fresh.id, JSON.stringify(fresh));
      this.stamps.set(fresh.id, at);
      result.installed.push(fresh.id);
    }
    return result;
  }

  /**
   * Marks who is mid-fight, so the loadout can refuse edits.
   *
   * Separate from `save` because it is not part of a character — it is a fact
   * about the live run, it changes twice per fight rather than continuously,
   * and folding it into the character JSON would make every run start look
   * like every character had changed.
   */
  async setInRun(ids: string[], inRun: boolean): Promise<void> {
    if (ids.length === 0) return;
    await this.call(`/characters?id=in.(${inList(ids)})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ in_run: inRun }),
    });
  }

  /** Explicit removal. Nothing calls this implicitly — see the class note. */
  async forget(id: string): Promise<void> {
    await this.call(`/characters?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    this.written.delete(id);
  }

  async snapshot(label: string): Promise<string> {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(label)}`;
    // Snapshots the STORED roster, matching the file store: a snapshot is of
    // what is durable, and the caller flushes before asking for one.
    const characters = await this.load();
    await this.call("/roster_snapshots", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ id, label, characters, taken_at: new Date().toISOString() }]),
    });
    return id;
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const res = await this.call(
      "/roster_snapshots?select=id,label,taken_at&order=taken_at.desc&limit=100",
    );
    const rows = (await res.json()) as { id: string; label: string | null; taken_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      label: r.label ?? "",
      takenAt: Date.parse(r.taken_at) || 0,
      // Not selected above: counting would mean pulling every snapshot's full
      // character array just to render a list.
      characters: 0,
    }));
  }

  async readSnapshot(id: string): Promise<Character[]> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`bad snapshot id "${id}"`);
    const res = await this.call(
      `/roster_snapshots?id=eq.${encodeURIComponent(id)}&select=characters`,
    );
    const rows = (await res.json()) as { characters?: unknown }[];
    if (rows.length === 0) throw new Error(`no snapshot "${id}"`);
    const characters = parseRoster(
      { version: 1, characters: rows[0]?.characters },
      (m) => console.warn(`[roster:supabase:${id}] ${m}`),
    );
    // A restore is about to install these, and every one of them differs from
    // what is stored — so forget what was written and let the next save push
    // the lot.
    this.written.clear();
    return characters;
  }
}

/**
 * The bare Twitch id, which is what row level security matches on.
 *
 * Null for anything else — `sim:` viewers from the testing harness have no
 * Twitch account, and giving them a twitch_id would be inventing one that
 * could collide with a real person's.
 */
function twitchIdOf(viewerId: string): string | null {
  return viewerId.startsWith("twitch:") ? viewerId.slice("twitch:".length) : null;
}

/** Ids for a PostgREST `in.(...)` filter, quoted and URL-encoded. */
function inList(ids: readonly string[]): string {
  return encodeURIComponent(ids.map((id) => `"${id.replace(/"/g, '""')}"`).join(","));
}

/**
 * JSON with every object's keys sorted, for comparing two characters by
 * content. Plain JSON.stringify follows insertion order, and the engine
 * equipping into a slot that was emptied earlier reorders `equipment` without
 * changing it - which would read as an edit on one side or the other.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "snapshot";
}
