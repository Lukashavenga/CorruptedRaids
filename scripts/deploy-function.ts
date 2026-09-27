/**
 * Deploy the Edge Functions, without needing `supabase link`.
 *
 * `supabase functions deploy character` alone fails with
 * "Cannot find project ref. Have you run supabase link?" on any checkout that
 * has not been linked - which is every fresh one, and was this one. Linking
 * writes machine-local state in supabase/.temp that is deliberately not in the
 * repo, so the failure is guaranteed to come back for the next person and be
 * mistaken for a broken script.
 *
 * The ref is already sitting in SUPABASE_URL, which DEPLOY.md §5 asks for
 * anyway and check:supabase validates the shape of. Deriving it from there
 * means one source for "which project", rather than one in .env and a second
 * hidden beside it.
 */
import { execFileSync } from "node:child_process";

const url = process.env.SUPABASE_URL;

if (!url) {
  console.error("SUPABASE_URL is not set. See DEPLOY.md section 5 - it is the same value the game server uses.");
  process.exit(1);
}

/**
 * `https://abcdefgh.supabase.co` -> `abcdefgh`.
 *
 * Rejects rather than guessing: a URL with a path on it (the `/rest/v1/` that
 * gets pasted in by mistake) would otherwise produce a ref that looks right
 * and deploys nowhere useful.
 */
const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|red)\/?$/.exec(url.trim());

if (!match) {
  console.error(`SUPABASE_URL should be exactly https://<project-ref>.supabase.co, got: ${url}`);
  console.error("Drop any path from it - check:supabase checks this too.");
  process.exit(1);
}

const ref = match[1]!;

/**
 * BOTH functions, because they share `_engine.js`.
 *
 * `npm run bundle:edge` rebuilds that bundle and copies it into both
 * directories, so deploying only `character` after a bundle change leaves
 * `operator` running against an older engine than the one just built - which
 * is how the difficulty simulator could be exported, bundled, and still absent
 * from the function that needs it. One command, both deployed, no ordering to
 * remember.
 */
const FUNCTIONS = ["character", "operator"];

for (const name of FUNCTIONS) {
  console.log(`Deploying ${name} function to ${ref}`);
  execFileSync("npx", ["--yes", "supabase", "functions", "deploy", name, "--project-ref", ref], {
    stdio: "inherit",
    shell: true,
  });
}
