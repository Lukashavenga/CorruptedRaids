import { useState } from "react";
import { text } from "../../../src/text/index.js";
import { signIn, type SessionState } from "./identity.js";

export interface SignInScreenProps {
  session: SessionState;
}

/**
 * The signed-out screen.
 *
 * The Twitch button starts a REDIRECT, not a fetch. OAuth requires the viewer
 * to land on Twitch's own domain and see Twitch's own consent screen — that is
 * the whole point of it. An XHR here would either fail on CORS or, worse,
 * appear to work by proxying credentials through us.
 */
export function SignInScreen({ session }: SignInScreenProps): JSX.Element {
  const t = text.loadout.signIn;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    const result = await signIn();
    // On success the browser navigates away, so this only runs on failure.
    if (!result.ok) {
      setError(result.message ?? t.unavailable);
      setBusy(false);
    }
  };

  return (
    <main className="loadout is-centered">
      <div className="signin">
        <img className="signin-logo" src="/art/logo.png" alt="" />
        <h1>{t.title}</h1>
        <p className="signin-lead">{t.lead}</p>

        {session.configured ? (
          <button type="button" className="signin-twitch" disabled={busy} onClick={() => void go()}>
            {t.twitch}
          </button>
        ) : (
          /* A build with no project is a real state — someone who checked out
             the repo and ran the dev server. Say so, rather than showing a
             button that cannot work. */
          <p className="signin-note">{t.unconfigured}</p>
        )}

        {error && <p className="signin-error">{error}</p>}
      </div>
    </main>
  );
}
