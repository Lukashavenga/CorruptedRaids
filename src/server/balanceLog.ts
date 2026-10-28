import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BalanceConfig } from "../engine/balance.js";
import { economyRow, type EconomyDraft, type EconomyRecord, type FightRecord, type LogSource } from "../engine/balanceLog.js";
import type { GameEngine } from "../engine/state/gameEngine.js";

/**
 * Writes the balance log (AGENTS.md "Balance log").
 *
 * NEVER IN THE FIGHT'S PATH. The engine hands a record to `enqueue`, which
 * pushes onto an array and returns; a timer drains that array later. Nothing
 * here is awaited by a command, nothing here can throw into one, and a write
 * that fails is warned about and DROPPED - not retried, because a retry
 * queue is how a down database turns into a memory leak on a machine that is
 * also running the stream. The queue is bounded for the same reason.
 *
 * Two backends with one record shape:
 *   file      JSON lines in DATA_DIR/logs, one fight per line with its members
 *             nested - what `ROSTER_STORE=file`, and no Supabase, get.
 *   Supabase  sql/005_balance_log.sql, fights + fight_members + economy_events.
 * scripts/report-balance.ts reads either and sees the same FightRecords.
 */

export type LogItem = { kind: "fight"; record: FightRecord } | { kind: "economy"; record: EconomyRecord };

interface Backend {
  readonly name: string;
  write(items: LogItem[]): Promise<void>;
}

/** Appends to `<dir>/fights-YYYY-MM-DD.jsonl` and `economy-YYYY-MM-DD.jsonl`. */
export class FileLogBackend implements Backend {
  readonly name: string;
  constructor(private readonly dir: string) {
    this.name = `file (${dir})`;
  }

  async write(items: LogItem[]): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    // Grouped so a drain is one append per file rather than one per record.
    const lines = new Map<string, string[]>();
    for (const item of items) {
      const day = item.record.at.slice(0, 10);
      const file = join(this.dir, `${item.kind === "fight" ? "fights" : "economy"}-${day}.jsonl`);
      const bucket = lines.get(file) ?? [];
      bucket.push(JSON.stringify(item.record));
      lines.set(file, bucket);
    }
    for (const [file, bucket] of lines) appendFileSync(file, `${bucket.join("\n")}\n`);
  }
}

/** PostgREST with the service key, like SupabaseRosterStore, and no SDK for the same reason. */
export class SupabaseLogBackend implements Backend {
  readonly name = "Supabase";
  private readonly base: string;
  constructor(
    url: string,
    private readonly serviceKey: string,
  ) {
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
  }

  private async insert(table: string, rows: unknown[]): Promise<void> {
    if (rows.length === 0) return;
    const res = await fetch(`${this.base}/${table}`, {
      method: "POST",
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        // The ids are minted here, so a repeated insert is a no-op rather than a duplicate.
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify(rows),
      // A hung connection must not pin the drain loop: the next tick would find it busy forever.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async write(items: LogItem[]): Promise<void> {
    const fights = items.filter((i): i is Extract<LogItem, { kind: "fight" }> => i.kind === "fight");
    const economy = items.filter((i): i is Extract<LogItem, { kind: "economy" }> => i.kind === "economy");
    // Fights before members: the foreign key needs the parent first.
    await this.insert("fights", fights.map((f) => fightRow(f.record)));
    await this.insert(
      "fight_members",
      fights.flatMap((f) => f.record.members.map((m) => memberRow(f.record, m))),
    );
    await this.insert("economy_events", economy.map((e) => economyRow(e.record)));
  }
}

export function fightRow(f: FightRecord): Record<string, unknown> {
  return {
    id: f.id,
    created_at: f.at,
    source: f.source,
    run_id: f.runId,
    kind: f.kind,
    dungeon_id: f.dungeonId,
    raid_id: f.raidId,
    room_id: f.roomId,
    level: f.level,
    band: f.band,
    party_rating: f.partyRating,
    headcount: f.headcount,
    tanks: f.roleCounts.tank,
    healers: f.roleCounts.healer,
    dps: f.roleCounts.dps,
    enemy_count: f.enemyCount,
    stat_scale: f.statScale,
    party_scale_hp: f.partyScaleHp,
    party_scale_atk: f.partyScaleAtk,
    boss_hp_mult: f.bossHpMult,
    boss_atk_mult: f.bossAtkMult,
    outcome: f.outcome,
    ticks: f.ticks,
    tick_ceiling: f.tickCeiling,
    end_reason: f.endReason,
    fingerprint: f.fingerprint,
    events: f.events,
  };
}

export function memberRow(f: FightRecord, m: FightRecord["members"][number]): Record<string, unknown> {
  return {
    fight_id: f.id,
    character_id: m.characterId,
    role: m.role,
    level: m.level,
    corruption: m.corruption,
    allocated: m.allocated,
    stats: m.stats,
    gear: m.gear,
    damage_dealt: m.damageDealt,
    damage_taken: m.damageTaken,
    hits_taken: m.hitsTaken,
    heals_given: m.healsGiven,
    heals_received: m.healsReceived,
    taunts: m.taunts,
    survived: m.survived,
    death_tick: m.deathTick,
    xp: m.xp,
    gold: m.gold,
    level_ups: m.levelUps,
    loot: m.loot,
  };
}

export class BalanceLog {
  private queue: LogItem[] = [];
  private draining = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private dropped = 0;

  constructor(
    private readonly backend: Backend,
    /** What the PROCESS is: a sandbox server tags everything it logs. */
    private readonly processSource: Exclude<LogSource, "sim">,
    private readonly config: () => BalanceConfig["balanceLog"],
  ) {}

  /** Starts listening to an engine and draining in the background. */
  attach(engine: GameEngine): void {
    engine.on("fight", (raw: FightRecord) => {
      const record = this.tag(raw);
      this.enqueue({ kind: "fight", record });
      // Level-ups are economy events too, and fall out of the fight for free.
      for (const m of record.members) {
        for (const level of m.levelUps) {
          this.enqueue({
            kind: "economy",
            record: {
              at: record.at,
              source: record.source,
              characterId: m.characterId,
              kind: "level_up",
              goldDelta: 0,
              gearId: null,
              rarity: null,
              gearSource: null,
              level,
              fightId: record.id,
            },
          });
        }
      }
    });
    engine.on("economy", (draft: EconomyDraft) =>
      this.enqueue({
        kind: "economy",
        record: { ...draft, at: new Date().toISOString(), source: this.sourceFor(draft.characterId) },
      }),
    );
    this.timer = setInterval(() => void this.drain(), Math.max(250, this.config().flushIntervalMs));
    // The log must never be the reason the process stays up.
    this.timer.unref?.();
  }

  /** `sim` wins over the process's own tag: a sim viewer is never a live number. */
  private tag(record: FightRecord): FightRecord {
    return record.source === "sim" ? record : { ...record, source: this.processSource };
  }

  private sourceFor(characterId: string): LogSource {
    return characterId.startsWith("sim:") ? "sim" : this.processSource;
  }

  private enqueue(item: LogItem): void {
    try {
      if (!this.config().enabled) return;
      this.queue.push(item);
      const max = this.config().maxQueued;
      if (this.queue.length > max) {
        const over = this.queue.length - max;
        this.queue.splice(0, over);
        this.dropped += over;
        console.warn(`[balance-log] queue over ${max}; dropped the ${over} oldest (${this.dropped} so far)`);
      }
    } catch (err) {
      console.warn(`[balance-log] could not queue a record: ${(err as Error).message}`);
    }
  }

  /**
   * Writes what is queued. Resolves either way: a failure is a warning and the
   * batch is gone, which is the contract (see the file note).
   */
  async drain(): Promise<void> {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.backend.write(batch);
    } catch (err) {
      console.warn(`[balance-log] write to ${this.backend.name} failed, dropped ${batch.length} record(s): ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  /** For shutdown: one last drain, but never longer than `ms`. */
  async flush(ms = 3000): Promise<void> {
    await Promise.race([this.drain(), new Promise<void>((r) => setTimeout(r, ms).unref?.())]);
  }

  get pending(): number {
    return this.queue.length;
  }
}
