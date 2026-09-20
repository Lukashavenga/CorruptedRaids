import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Character } from "../types.js";
import {
  ROSTER_FILE_VERSION,
  parseRoster,
  type RosterFile,
  type RosterStore,
  type SnapshotInfo,
} from "./rosterStore.js";

/**
 * The roster, in a JSON file.
 *
 * Zero dependencies, no account, no network — which is why it is the first
 * backing rather than Supabase. It is genuinely enough to ship on: a single
 * container with a mounted volume, one file, atomic writes. Supabase becomes a
 * second `RosterStore` when the game is hosted and nothing else changes.
 *
 * ATOMIC, because the failure it is guarding against is real. A crash or a
 * container restart part-way through writing this file would otherwise leave a
 * truncated JSON document where the roster used to be, and the next boot would
 * find no characters at all. So every write goes to a temp file and is renamed
 * over the target — rename is atomic on both platforms this runs on, so a
 * reader sees either the whole old file or the whole new one.
 */
export class FileRosterStore implements RosterStore {
  private readonly file: string;
  private readonly snapshotDir: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "roster.json");
    this.snapshotDir = join(dir, "snapshots");
  }

  async load(): Promise<Character[]> {
    if (!existsSync(this.file)) return [];
    return parseRoster(JSON.parse(readFileSync(this.file, "utf-8")), (m) =>
      console.warn(`[roster] ${m}`),
    );
  }

  async save(characters: Character[]): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    this.writeAtomic(this.file, characters);
  }

  async snapshot(label: string): Promise<string> {
    mkdirSync(this.snapshotDir, { recursive: true });
    const characters = await this.load();
    // Sortable, unique, and readable in a directory listing — the id IS the
    // timestamp, so snapshots list newest-first by filename alone.
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(label)}`;
    this.writeAtomic(join(this.snapshotDir, `${id}.json`), characters, label);
    return id;
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    if (!existsSync(this.snapshotDir)) return [];
    const out: SnapshotInfo[] = [];
    for (const file of readdirSync(this.snapshotDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(join(this.snapshotDir, file), "utf-8")) as RosterFile & {
          label?: string;
        };
        out.push({
          id: file.replace(/\.json$/, ""),
          label: raw.label ?? "",
          takenAt: raw.savedAt ?? 0,
          characters: Array.isArray(raw.characters) ? raw.characters.length : 0,
        });
      } catch {
        // A snapshot that will not parse is still worth listing as broken
        // rather than hiding — otherwise it silently disappears and whoever
        // was relying on it finds out at the worst moment.
        out.push({ id: file.replace(/\.json$/, ""), label: "unreadable", takenAt: 0, characters: 0 });
      }
    }
    return out.sort((a, b) => b.takenAt - a.takenAt);
  }

  async readSnapshot(id: string): Promise<Character[]> {
    // The id comes off an HTTP request, so it is not allowed to be a path.
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`bad snapshot id "${id}"`);
    const path = join(this.snapshotDir, `${id}.json`);
    if (!existsSync(path)) throw new Error(`no snapshot "${id}"`);
    return parseRoster(JSON.parse(readFileSync(path, "utf-8")), (m) =>
      console.warn(`[roster:${id}] ${m}`),
    );
  }

  private writeAtomic(path: string, characters: Character[], label?: string): void {
    const body: RosterFile & { label?: string } = {
      version: ROSTER_FILE_VERSION,
      savedAt: Date.now(),
      ...(label === undefined ? {} : { label }),
      characters,
    };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
    renameSync(tmp, path);
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "snapshot";
}
