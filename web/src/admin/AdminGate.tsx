import { useEffect, useState } from "react";
import { LOGO_SRC } from "../build.js";
import { readSession, signIn, signOut, type SessionState } from "../loadout/identity.js";
import * as operator from "../operator/api.js";
import { backendMode } from "./backend.js";

/**
 * Who may open the admin panel, and only when it is hosted.
 *
 * LOCAL IS NOT GATED HERE, deliberately. The panel served by the game server
 * is reached over loopback on the streamer's own machine, and every write it
 * makes already carries ADMIN_SECRET - adding a Twitch sign-in in front of
 * that would mean the offline, stream-day tool needs the internet and an
 * identity provider to open. The gate exists because the page is now also
 * served from the open web, and that is the case it guards.
 *
 * AND IT IS STILL NOT THE REAL PROTECTION. A static page's checks belong to
 * whoever is reading it. Hosted writes go through the operator Edge Function,
 * which re-derives the caller from a verified token and refuses on its own;
 * this only decides whether to draw the tool or a refusal. Someone who strips
 * this component out gets a panel whose every button 403s.
 */
export function AdminGate({ children }: { children: JSX.Element }): JSX.Element {
  const [mode, setMode] = useState<"local" | "hosted" | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [operatorOk, setOperatorOk] = useState<boolean | null>(null);

  useEffect(() => {
    void backendMode().then(setMode);
  }, []);

  useEffect(() => {
    if (mode !== "hosted") return;
    void readSession().then(setSession);
  }, [mode]);

  useEffect(() => {
    if (mode !== "hosted" || !session?.viewer) return;
    void operator
      .whoami()
      .then((r) => setOperatorOk(r.operator))
      .catch(() => setOperatorOk(false));
  }, [mode, session]);

  if (mode === null) return <main className="loadout is-centered">Loading...</main>;
  if (mode === "local") return children;

  if (!session) return <main className="loadout is-centered">Loading...</main>;

  if (!session.viewer) {
    return (
      <main className="loadout is-centered">
        <div className="signin">
          <img className="signin-logo" src={LOGO_SRC} alt="" />
          <h1>Admin</h1>
          <p className="signin-lead">Sign in to continue.</p>
          <button type="button" className="signin-button" onClick={() => void signIn()}>
            Sign in with Twitch
          </button>
        </div>
      </main>
    );
  }

  if (operatorOk === null) return <main className="loadout is-centered">Checking...</main>;

  if (!operatorOk) {
    return (
      <main className="loadout is-centered">
        <div className="signin">
          <img className="signin-logo" src={LOGO_SRC} alt="" />
          <h1>Not an operator</h1>
          <p className="signin-lead">
            This account does not have operator access. Signed in as {session.viewer.displayName}.
          </p>
          <button type="button" className="signin-button" onClick={() => void signOut().then(() => location.reload())}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return children;
}
