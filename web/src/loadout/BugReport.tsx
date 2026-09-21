import { useCallback, useEffect, useRef, useState } from "react";
import { BUILD_LABEL } from "../build.js";
import { supabase } from "./supabase.js";
import { haptic } from "./haptics.js";
import type { Viewer } from "./identity.js";

/**
 * "Something is wrong" — a report a player can file without leaving the game.
 *
 * WHAT IT ASKS FOR, AND WHAT IT TAKES WITHOUT ASKING
 * --------------------------------------------------
 * One field. The build, the screen and the browser are attached automatically,
 * because every one of them is something a viewer on a phone either cannot
 * find or will get wrong, and a form with four boxes on it is a form nobody
 * fills in during an alpha. The build in particular is what separates "this is
 * broken" from "this WAS broken" (web/src/build.ts).
 *
 * It writes straight to the table under row level security rather than going
 * through the character Edge Function. sql/002_bug_reports.sql has the full
 * reasoning; the short version is that a bug report has no legality for the
 * engine to check, so the one thing that must be enforced — that you can only
 * file as yourself — is exactly what RLS is for.
 */
export function BugReport({ viewer }: { viewer: Viewer }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Focus the box on open. The button is the whole interaction up to this
  // point; making someone tap twice to start typing loses reports.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setDone(false);
    setError(null);
  }, []);

  // Escape closes, like the chest modal. A modal that traps you on a phone
  // with the keyboard up is its own bug report.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submit = useCallback(async () => {
    const text = message.trim();
    if (!text || busy) return;
    if (!supabase) {
      setError("This build has no database configured.");
      return;
    }

    setBusy(true);
    setError(null);

    const { error: failed } = await supabase.from("bug_reports").insert({
      // The policy checks this against the caller's own token, so sending it
      // is not a trust decision — it is the column the check reads.
      twitch_id: viewer.id.replace(/^twitch:/, ""),
      handle: viewer.displayName,
      message: text,
      build: BUILD_LABEL,
      page: window.location.pathname,
      user_agent: navigator.userAgent,
    });

    setBusy(false);
    if (failed) {
      // The real message, not a shrug. During an alpha the person hitting this
      // is as likely to be the developer as a viewer.
      setError(failed.message);
      return;
    }
    haptic("chestOpen");
    setMessage("");
    setDone(true);
  }, [message, busy, viewer]);

  if (!open) {
    return (
      <button type="button" className="bug-open" onClick={() => setOpen(true)}>
        Log a bug
      </button>
    );
  }

  return (
    <div className="bug-backdrop" role="dialog" aria-modal="true" aria-label="Log a bug">
      <div className="bug-card">
        {done ? (
          <>
            <h2>Thanks</h2>
            <p className="bug-lead">Logged against {BUILD_LABEL}.</p>
            <div className="bug-actions">
              <button type="button" className="bug-send" onClick={close}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Log a bug</h2>
            <p className="bug-lead">
              What happened? The build you are on is attached automatically.
            </p>
            <textarea
              ref={field}
              className="bug-field"
              value={message}
              maxLength={4000}
              rows={5}
              placeholder="I opened a chest and…"
              onChange={(e) => setMessage(e.target.value)}
            />
            {error && <p className="bug-error">{error}</p>}
            <div className="bug-actions">
              <button type="button" className="bug-cancel" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="bug-send"
                onClick={() => void submit()}
                disabled={busy || message.trim() === ""}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
            <p className="bug-build">{BUILD_LABEL}</p>
          </>
        )}
      </div>
    </div>
  );
}
