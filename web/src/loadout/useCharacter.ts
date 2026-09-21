import { useCallback, useEffect, useState } from "react";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { GameCommand } from "../../../src/engine/commands/types.js";
import { readSession, type SessionState } from "./identity.js";
import { callCharacterFn } from "./supabase.js";

export interface CharacterState {
  character: CharacterView | null;
  loading: boolean;
  /** Last message the backend returned for a dispatched command, for inline feedback. */
  message: string | null;
  error: string | null;
  /**
   * True while this character is in a live fight.
   *
   * The game server flags it when a party locks and the Edge Function refuses
   * edits until it clears. Surfaced here so the screen can say why, rather
   * than letting every button fail with a 409.
   */
  inRun: boolean;
  /**
   * Who Supabase says we are.
   *
   * Null while the first session read is in flight — the screen shows neither
   * the character nor the sign-in prompt until the answer arrives, because
   * flashing "sign in" at somebody who is already signed in is worse than a
   * moment of nothing.
   */
  session: SessionState | null;
}

/**
 * Loads one viewer's character and dispatches commands against it.
 *
 * TALKS TO SUPABASE, NOT TO THE GAME SERVER. The server runs on the streamer's
 * PC and is not reachable from a phone, and this screen has to work when the
 * stream is offline — so Supabase holds the characters and an Edge Function
 * applies commands with the real engine.
 *
 * A mutation returns the updated character in its reply, so there is no second
 * round trip to read back what was just written, and the engine stays the
 * single source of truth. This hook never models what a command *should* have
 * done, which is the usual way an optimistic UI and a server drift apart.
 */
export function useCharacter() {
  const [state, setState] = useState<CharacterState>({
    character: null,
    loading: true,
    message: null,
    error: null,
    inRun: false,
    session: null,
  });

  const refresh = useCallback(async () => {
    const { status, body } = await callCharacterFn({ method: "GET" });
    if (status === 401) {
      setState((s) => ({ ...s, character: null, loading: false, error: null }));
      return;
    }
    if (status !== 200) {
      setState((s) => ({ ...s, loading: false, error: String(body.message ?? `HTTP ${status}`) }));
      return;
    }
    setState((s) => ({
      ...s,
      character: (body.character as CharacterView | null) ?? null,
      inRun: Boolean(body.inRun),
      loading: false,
      error: null,
    }));
  }, []);

  /**
   * Sends a command and returns the server's reply body.
   *
   * It used to return void and most callers still ignore the result — the
   * character in the reply is applied to state here, which is all a click on
   * "equip" needs. `open_chest` is the exception: its reply carries what was
   * inside, and that is the ONLY moment either side knows, so the value has to
   * reach the caller rather than being swallowed here.
   */
  const dispatch = useCallback(async (command: GameCommand): Promise<Record<string, unknown>> => {
    // `requestedBy` in the body is vestigial: the function reads the Twitch id
    // out of the verified token and overwrites it. It stays because the
    // command type requires it.
    const { status, body } = await callCharacterFn({
      method: "POST",
      body: JSON.stringify(command),
    });

    if (status === 409) {
      // Mid-fight. Nothing the viewer did wrong and it clears itself when the
      // run ends, so it is a message rather than an error.
      setState((s) => ({ ...s, inRun: true, message: String(body.message ?? ""), error: null }));
      return body as Record<string, unknown>;
    }
    if (status === 401) {
      setState((s) => ({ ...s, error: "Signed out - sign in again to make changes." }));
      return body as Record<string, unknown>;
    }

    setState((s) => ({
      ...s,
      message: String(body.message ?? ""),
      error: null,
      character: (body.character as CharacterView | null) ?? s.character,
    }));
    return body as Record<string, unknown>;
  }, []);

  /** Re-reads the session, then the character. On mount, and after signing in or out. */
  const reload = useCallback(async () => {
    const session = await readSession();
    setState((s) => ({ ...s, session }));
    if (!session.viewer) {
      setState((s) => ({ ...s, character: null, loading: false }));
      return;
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, viewer: state.session?.viewer ?? null, refresh, dispatch, reload };
}
