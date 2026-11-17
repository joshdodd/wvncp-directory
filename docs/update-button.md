# "Update the directory now" button

The directory index rebuilds every night. This button lets the client rebuild it right away
after publishing or editing a bio.

How it works: the button (on a password-protected Squarespace page) calls a small
Cloudflare Worker. The Worker holds a GitHub token that can only run this repo's Actions,
and starts `build-index.yml`. The button shows progress and says when it's done (about 2 minutes).
If an update is already running, a second click just follows that one.

Files: `worker/rebuild-worker.js` (the Worker), `embeds/update-button.html` (the Code Block).

## Setup (Josh, once)

### 1. GitHub token

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Name: `wvncp-rebuild-worker`. Expiration: the longest allowed (note the date; the button stops working when it expires).
3. Repository access: **Only select repositories** → `joshdodd/wvncp-directory`.
4. Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
5. Generate, and copy the token.

### 2. Cloudflare Worker

1. Sign in at dash.cloudflare.com (a free account is enough).
2. **Workers & Pages** → Create → Create Worker → name it `wvncp-rebuild` → Deploy.
3. **Edit code**: replace everything with the contents of `worker/rebuild-worker.js` → Deploy.
4. Worker → **Settings** → Variables and Secrets → Add:
   - `GITHUB_TOKEN` (type **Secret**): the token from step 1.
   - `UPDATE_KEY` (type **Secret**): the update key (Claude supplies one; any long random string works).
5. Copy the Worker's URL, e.g. `https://wvncp-rebuild.<your-subdomain>.workers.dev`.

### 3. Squarespace page

1. Pages → Not Linked → **+** → Blank page. Title `Update Directory`, slug `/update-directory`.
2. Page settings → **Password**: set one for the client. Page settings → SEO: hide from search results.
3. Add a **Code Block** and paste `embeds/update-button.html`.
   Replace `WORKER_URL` with the Worker URL and `UPDATE_KEY` with the key from step 2.4 (in the `data-` attributes).
4. Save.

### 4. Check

Open the page, press the button, and wait for "Done at …".
The run also appears under the repo's Actions tab.

## Maintenance

- **Token expiry**: generate a new token before the expiry date and replace `GITHUB_TOKEN` in the Worker.
- **Changing the key**: update `UPDATE_KEY` in the Worker and the `data-key` in the Code Block together.
- **Site domain changes**: the Worker only accepts calls from `veterans.wvhumanities.org` and the
  `purple-lemon-6ryt.squarespace.com` editor. For a new domain, add a plain variable `ALLOWED_ORIGINS`
  (comma-separated, including `https://`).
