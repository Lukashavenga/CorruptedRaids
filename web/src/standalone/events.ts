/**
 * `node:events`, for the standalone build only (see web/vite.config.ts).
 *
 * GameEngine, StateMachine and DungeonController all extend Node's
 * EventEmitter, and a browser has no such module. The engine is not rewritten
 * around that: the Node server is the real game and should go on using the
 * real emitter, so the standalone build aliases the import to this instead.
 *
 * Only what those three classes call - `on` and `emit` - plus `off`, because
 * something that can subscribe and never unsubscribe is a leak waiting for its
 * first caller. If the engine starts using more of the API, the standalone
 * build fails to typecheck against nothing (the types still come from
 * @types/node) and fails at runtime here, which is the reason this is kept
 * small enough to read in one go.
 */
type Listener = (...args: any[]) => void;

export class EventEmitter {
  private listeners = new Map<string | symbol, Listener[]>();

  on(event: string | symbol, listener: Listener): this {
    const list = this.listeners.get(event);
    if (list) list.push(listener);
    else this.listeners.set(event, [listener]);
    return this;
  }

  off(event: string | symbol, listener: Listener): this {
    const list = this.listeners.get(event);
    if (!list) return this;
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return false;
    // A copy, as Node does: a listener that unsubscribes while being called
    // must not make the loop skip its neighbour.
    for (const listener of [...list]) listener(...args);
    return true;
  }
}
