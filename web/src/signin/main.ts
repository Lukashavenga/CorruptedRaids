import { LOGO_SRC } from "../build.js";
import { readSession, signIn, signOut } from "../loadout/identity.js";
import { supabase } from "../loadout/supabase.js";
import "../styles/theme.css";
import "../loadout/loadout.css";

/**
 * The only public door to the hosted admin and operator pages.
 *
 * WHY A PAGE OF ITS OWN, rather than the sign-in prompt already inside
 * AdminGate. That one lives in the admin bundle, and the whole point of
 * functions/_middleware.ts is that the admin bundle is not served to anyone
 * who has not signed in yet. A door cannot be behind the lock it opens.
 *
 * WHAT IT DOES. Signs in with Twitch through Supabase - the same flow, the
 * same library and the same session the loadout uses, so there is no second
 * auth path to keep correct - then hands the resulting access token to
 * `/__gate`, which verifies it with Supabase and sets the cookie the edge
 * checks. Then it leaves.
 *
 * It asserts nothing. A token posted here is checked at the edge and again by
 * the operator Edge Function behind it; this file only carries it across.
 */

/**
 * Where to go once the cookie is set - and a hard allowlist, not a filter.
 *
 * `to` arrives in a URL that anyone can write, so treating it as "any path
 * starting with a slash" turns this page into an open redirect wearing the
 * site's own domain: exactly the thing a phishing link wants. There are two
 * gated pages. Anything else is the default.
 */
function target(raw: string | null): string {
  return raw === "/operator" ? "/operator" : "/admin";
}

const to = target(new URLSearchParams(window.location.search).get("to"));

const logo = document.getElementById("logo") as HTMLImageElement;
const heading = document.getElementById("heading") as HTMLElement;
const lead = document.getElementById("lead") as HTMLElement;
const go = document.getElementById("go") as HTMLButtonElement;
const out = document.getElementById("out") as HTMLButtonElement;

logo.src = LOGO_SRC;
heading.textContent = to === "/operator" ? "Operator" : "Admin";

function say(message: string, options: { signIn?: boolean; signOut?: boolean } = {}): void {
  lead.textContent = message;
  go.hidden = !options.signIn;
  out.hidden = !options.signOut;
}

/**
 * A breadcrumb for the one failure this page cannot see from the inside.
 *
 * If `https://<domain>/signin` is not in Supabase's Redirect URLs, Supabase
 * does not error - it quietly sends the caller to the project's Site URL
 * instead. From here that is indistinguishable from "they changed their mind
 * on Twitch's consent screen": the page just loads again with no session, and
 * an operator sees a sign-in button that appears to do nothing. Marking the
 * departure means the return trip can name the likely cause instead.
 *
 * sessionStorage rather than a flag in the URL, because the URL is the thing
 * that does not come back.
 */
const DEPARTED = "cr-signin-departed";

go.addEventListener("click", () => {
  say("Redirecting to Twitch...");
  try {
    window.sessionStorage.setItem(DEPARTED, "1");
  } catch {
    // Private browsing, or storage blocked. Costs a diagnostic, nothing else.
  }
  // The full URL including `?to=`, so the round trip through Twitch comes back
  // knowing which page was asked for.
  void signIn(window.location.origin + window.location.pathname + window.location.search);
});

out.addEventListener("click", () => {
  void signOut().then(() => window.location.reload());
});

async function main(): Promise<void> {
  const session = await readSession();

  if (!session.configured) {
    say("This build has no Supabase project configured, so there is nothing to sign in to.");
    return;
  }

  if (!session.viewer) {
    let departed = false;
    try {
      departed = window.sessionStorage.getItem(DEPARTED) === "1";
      window.sessionStorage.removeItem(DEPARTED);
    } catch {
      // As above.
    }
    if (departed) {
      say(
        "Twitch sent you back without a session. If this keeps happening, add this page's URL to " +
          "Supabase under Authentication, URL Configuration, Redirect URLs.",
        { signIn: true },
      );
      return;
    }
    say("Sign in to continue.", { signIn: true });
    return;
  }

  const { data } = await supabase!.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    say("Sign in to continue.", { signIn: true });
    return;
  }

  say("Checking access...");
  let res: Response;
  try {
    res = await fetch("/__gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    say("Could not reach the gate. Check your connection and reload.");
    return;
  }

  if (res.ok) {
    // `replace`, not `assign`: going Back from the admin panel should leave,
    // not bounce through a page that immediately redirects forward again.
    window.location.replace(to);
    return;
  }

  if (res.status === 403) {
    say(`Signed in as ${session.viewer.displayName}, which does not have operator access.`, { signOut: true });
    return;
  }

  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  say(body?.message ?? `The gate refused this sign-in (${res.status}).`, { signOut: true });
}

void main();
