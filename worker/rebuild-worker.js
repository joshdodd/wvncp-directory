/**
 * WVNCP directory: "Update the directory now" endpoint (Cloudflare Worker).
 *
 * The client's button on a password-protected Squarespace page calls this Worker,
 * which starts the GitHub Action that rebuilds the directory index (build-index.yml).
 * The GitHub token lives only here, as a Worker secret, never in the web page.
 *
 *   POST /rebuild   body {"key": "<UPDATE_KEY>"}  -> starts a rebuild (or reports one already running)
 *   GET  /status                                   -> state of the latest rebuild
 *
 * Worker secrets (Settings -> Variables and Secrets):
 *   GITHUB_TOKEN  fine-grained token, repository joshdodd/wvncp-directory only, permission Actions: Read and write
 *   UPDATE_KEY    shared key that the Squarespace button sends
 * Optional plain variable:
 *   ALLOWED_ORIGINS  comma-separated sites allowed to call this Worker (default below)
 */

const REPO = "joshdodd/wvncp-directory";
const WORKFLOW = "build-index.yml";
const BRANCH = "main";
const DEFAULT_ORIGINS = "https://veterans.wvhumanities.org,https://purple-lemon-6ryt.squarespace.com";

export default {
  async fetch(request, env) {
    const origins = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((s) => s.trim());
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !origins.includes(origin)) return reply(403, { state: "error", message: "This site is not allowed." });
    if (!env.GITHUB_TOKEN || !env.UPDATE_KEY) return reply(500, { state: "error", message: "The Worker is missing its secrets." });

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    try {
      if (request.method === "GET" && path === "/status") return reply(200, await latest(env));

      if (request.method === "POST" && path === "/rebuild") {
        let key = "";
        try { key = String((await request.json()).key || ""); } catch (e) { /* empty or invalid body */ }
        if (!safeEqual(key, env.UPDATE_KEY)) return reply(401, { state: "error", message: "The update key is not right." });

        const now = await latest(env);
        if (now.state === "running") return reply(200, { ...now, started: false, message: "An update is already running." });

        const res = await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
          method: "POST",
          body: JSON.stringify({ ref: BRANCH }),
        });
        if (res.status !== 204) return reply(502, { state: "error", message: `GitHub refused the request (${res.status}).` });
        return reply(202, { state: "running", started: true, startedAt: new Date().toISOString(), message: "Update started." });
      }
      return reply(404, { state: "error", message: "Not found." });
    } catch (e) {
      return reply(502, { state: "error", message: "Could not reach GitHub." });
    }
  },
};

// Latest run of the rebuild workflow, reduced to what the button needs.
async function latest(env) {
  const res = await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  if (!res.ok) throw new Error("runs " + res.status);
  const run = ((await res.json()).workflow_runs || [])[0];
  if (!run) return { state: "idle" };
  // queued, waiting or in progress. A run just started can take a few seconds to be listed;
  // the button handles that by ignoring runs that started before it was clicked.
  const running = run.status !== "completed";
  return {
    state: running ? "running" : run.conclusion === "success" ? "done" : "failed",
    startedAt: run.created_at,
    finishedAt: run.status === "completed" ? run.updated_at : null,
  };
}

function gh(env, path, init = {}) {
  return fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wvncp-rebuild-worker",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

// Compare keys without stopping at the first different character.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
