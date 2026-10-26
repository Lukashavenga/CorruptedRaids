/**
 * Exercises SupabaseRosterStore against a stub PostgREST.
 *
 *   npx tsx scripts/test-supabase-store.ts
 *
 * WHY A STUB AND NOT A REAL PROJECT. The behaviour worth testing here is the
 * store's side of the conversation: which verb, which path, which `Prefer`
 * header, and above all WHICH ROWS it sends. None of that needs Postgres to
 * answer — it needs something that records what arrived. A real project would
 * test Supabase, which is not the part that can be wrong.
 *
 * The property this exists for: after a viewer edits their character on their
 * phone, the game server's next save must not write that character back. The
 * store only sends rows whose serialisation has changed since it last wrote
 * them, and `save writes ONLY the character that changed` below is the
 * assertion that says so.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Character } from "../src/engine/types.js";
import { SupabaseRosterStore } from "../src/engine/persistence/supabaseRosterStore.js";

interface Received {
  method: string;
  path: string;
  prefer: string;
  body: unknown;
}

const received: Received[] = [];
/** id -> row, standing in for the `characters` table. */
const table = new Map<string, Record<string, unknown>>();
const snapshots = new Map<string, Record<string, unknown>>();

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url ?? "";
    received.push({ method: req.method ?? "", path, prefer: String(req.headers["prefer"] ?? ""), body });

    const json = (v: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };

    if (path.startsWith("/rest/v1/characters")) {
      if (req.method === "GET") {
        const one = /id=eq\.([^&]+)/.exec(path);
        const rows = one ? [table.get(decodeURIComponent(one[1]!))].filter(Boolean) : [...table.values()];
        return json(rows.map((r) => ({ id: r!.id, data: r!.data })));
      }
      if (req.method === "POST") {
        for (const row of body as Record<string, unknown>[]) table.set(String(row.id), row);
        res.writeHead(201); return res.end();
      }
      if (req.method === "PATCH") {
        for (const row of table.values()) Object.assign(row, body);
        res.writeHead(204); return res.end();
      }
      if (req.method === "DELETE") {
        const m = /id=eq\.([^&]+)/.exec(path);
        if (m) table.delete(decodeURIComponent(m[1]!));
        res.writeHead(204); return res.end();
      }
    }

    if (path.startsWith("/rest/v1/roster_snapshots")) {
      if (req.method === "POST") {
        for (const row of body as Record<string, unknown>[]) snapshots.set(String(row.id), row);
        res.writeHead(201); return res.end();
      }
      const m = /id=eq\.([^&]+)/.exec(path);
      if (m) {
        const row = snapshots.get(decodeURIComponent(m[1]!));
        return json(row ? [{ characters: row.characters }] : []);
      }
      return json([...snapshots.values()].map((r) => ({ id: r.id, label: r.label, taken_at: r.taken_at })));
    }

    res.writeHead(404); res.end();
  });
});

function character(id: string, gold: number): Character {
  return {
    id, name: id, level: 1, xp: 0, gold, role: "dps",
    allocated: { hp: 0, atk: 0, skill: 0, spd: 0 },
    unspentPoints: 0, consumables: {}, equipment: {}, inventory: [],
    appearance: { bodyType: "male", skinTone: "sand", hair: null },
  };
}

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const store = new SupabaseRosterStore(`http://127.0.0.1:${port}`, "service-key");

const line = () => console.log("-".repeat(64));

// --- empty to start ---------------------------------------------------------
assert.deepEqual(await store.load(), [], "a fresh table loads as no characters");

// --- first save writes everyone --------------------------------------------
const alice = character("twitch:111", 10);
const bob = character("twitch:222", 20);
const sim = character("sim:harness", 30);
await store.save([alice, bob, sim]);
assert.equal(table.size, 3, "three characters stored");
console.log(`first save wrote ${table.size} rows`);

// The Twitch id is split out for row level security, and a sim viewer gets
// none — inventing one could collide with a real account.
assert.equal(table.get("twitch:111")!.twitch_id, "111");
assert.equal(table.get("sim:harness")!.twitch_id, null, "a sim viewer has no twitch_id");
console.log("twitch_id split out for RLS; sim viewers left null");

// --- an unchanged save writes nothing ---------------------------------------
received.length = 0;
await store.save([alice, bob, sim]);
assert.equal(received.length, 0, "an unchanged roster must not touch the network at all");
console.log("unchanged save: 0 requests");

// --- THE ONE THAT MATTERS ---------------------------------------------------
// Bob edits his character on his phone. The server has all three in memory and
// changes only Alice. Bob's row must not be in the request.
line();
table.get("twitch:222")!.data = { ...bob, gold: 9999 };   // the phone edit
alice.gold = 11;                                           // the server's change
received.length = 0;
await store.save([alice, bob, sim]);

const writes = received.filter((r) => r.method === "POST");
assert.equal(writes.length, 1, "one upsert");
const rows = writes[0]!.body as { id: string }[];
assert.deepEqual(rows.map((r) => r.id), ["twitch:111"], "save writes ONLY the character that changed");
assert.equal(
  (table.get("twitch:222")!.data as Character).gold,
  9999,
  "the phone edit survived the server's save",
);
console.log("save wrote only [twitch:111]; the phone's edit to twitch:222 survived");
line();

// --- reload: the join takes the phone's copy ---------------------------------
// The server loaded Bob at boot and has not touched him since, so his copy in
// memory is clean and the stored one - the phone's - is the newer. A join
// takes it, or he fights in the gear he took off and the next save puts it
// back on him.
const reloaded = await store.reload("twitch:222", bob);
assert.equal(reloaded?.gold, 9999, "reload returns the phone's edit for a clean character");
received.length = 0;
await store.save([alice, reloaded!, sim]);
assert.equal(received.length, 0, "what reload read is not written straight back");
console.log("reload took the phone's copy of twitch:222, and the next save left it alone");

// Alice has a change the server has not saved yet. That is newer than the
// stored row, so reload must decline rather than throw the change away.
alice.gold = 12;
assert.equal(await store.reload("twitch:111", alice), null, "reload declines a character with unsaved changes");
alice.gold = 11;
console.log("reload declined twitch:111 while it held an unsaved change");

// A viewer who made their character on the loadout after the server booted:
// nothing in memory, a row in the table.
table.set("twitch:333", {
  id: "twitch:333",
  twitch_id: "333",
  data: {
    ...character("twitch:333", 60),
    appearanceChosen: true,
    appearance: { bodyType: "female", skinTone: "sand", hair: null, hiddenSlots: ["head", "nonsense", "head"] },
  },
});
const created = await store.reload("twitch:333", undefined);
assert.ok(created, "reload finds a character created elsewhere after boot");
assert.equal(created.appearanceChosen, true, "appearanceChosen survives a parse - it used to be dropped");
assert.deepEqual(created.appearance.hiddenSlots, ["head"], "hidden slots survive, cleaned to real slots once each");
assert.equal(await store.reload("twitch:404", undefined), null, "nobody stored is null, not an error");
table.delete("twitch:333");
console.log("reload found a character made on the loadout after boot, flags intact");
line();

// --- upsert semantics --------------------------------------------------------
assert.match(writes[0]!.prefer, /merge-duplicates/, "writes upsert rather than insert");
assert.match(writes[0]!.prefer, /return=minimal/, "does not ask for every row back");
console.log("upsert headers correct");

// --- in_run flag -------------------------------------------------------------
await store.setInRun(["twitch:111", "twitch:222"], true);
assert.equal(table.get("twitch:111")!.in_run, true, "in_run set for the party");
const patch = received.find((r) => r.method === "PATCH")!;
assert.match(patch.path, /id=in\./, "in_run uses a single ranged PATCH, not a write per character");
console.log("in_run flagged via one PATCH");

// --- never deletes implicitly ------------------------------------------------
received.length = 0;
await store.save([alice]);                    // bob and sim are gone from memory
assert.equal(table.size, 3, "a character missing from memory is NOT deleted");
assert.ok(!received.some((r) => r.method === "DELETE"), "no implicit DELETE");
console.log("a character absent from memory was left alone, not deleted");

await store.forget("sim:harness");            // explicit removal
assert.equal(table.size, 2, "forget() removes the row");
console.log("forget() removed it explicitly");

// --- snapshots ---------------------------------------------------------------
const id = await store.snapshot("before stream");
const list = await store.listSnapshots();
assert.equal(list.length, 1);
assert.equal(list[0]!.label, "before stream");
const restored = await store.readSnapshot(id);
assert.equal(restored.length, 2, "the snapshot holds what was stored at the time");
console.log(`snapshot ${id} -> ${restored.length} characters`);

// A snapshot id off an HTTP request is not allowed to be a path.
await assert.rejects(() => store.readSnapshot("../../etc/passwd"), /bad snapshot id/);
console.log("snapshot ids are validated, not interpolated");

server.close();
line();
console.log("All Supabase store assertions passed.");
