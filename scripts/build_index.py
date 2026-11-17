#!/usr/bin/env python3
"""Build the Biography Directory indexes from the live Squarespace site.

Outputs (in dist/):
  directory-index.json  small: one row per published bio (name, years, facets, sort key)
  search-index.json     larger: per bio, the unique words of its full text (loaded on first search)

Facets come from each post's "Bio details" block (the first paragraph of "Label: value" lines),
not from Squarespace categories (the WordPress import keeps only one category per post).

The collection's ?format=json list paginates by publish date and skips posts that share a date, and
sitemap.xml can lag, so candidate posts come from the feed, the sitemap, the current index and
data/seed-slugs.txt; each is fetched on its own and kept only if it is published.

Usage:
  build_index.py --site https://veterans.wvhumanities.org --collection biography-directory
  build_index.py --from-wxr path/to/import.xml      (offline test: read posts from an import file)

Standard library only (runs in GitHub Actions without installs).
"""
import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

UA = "wvncp-directory-index/1.0 (+https://github.com/joshdodd/wvncp-directory)"
FACETS = ("Branch", "Conflict", "Cemetery")
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}
STOP = set("""a an and are as at be but by for from had has have he her his i in into is it its of on or
our she that the their them then there these they this to was were which who will with""".split())


# ---------- fetching ----------

def get(url, tries=3):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            if n == tries - 1:
                raise RuntimeError(f"GET {url} failed: {e}") from e
            time.sleep(2 * (n + 1))


def sitemap_slugs(site, collection):
    try:
        xml = get(f"{site}/sitemap.xml")
    except RuntimeError:
        return set()
    prefix = f"{site}/{collection}/"
    return {u[len(prefix):].strip("/") for u in re.findall(r"<loc>([^<]+)</loc>", xml)
            if u.startswith(prefix) and "/" not in u[len(prefix):].strip("/")}


def feed_slugs(site, collection, max_pages=30):
    """Newest posts from the collection feed. Its date-based pagination skips posts that share a
    publish date (the bulk import), so this mainly finds bios added later in the editor."""
    found, url = set(), f"{site}/{collection}?format=json"
    for _ in range(max_pages):
        j = json.loads(get(url))
        found |= {i["urlId"] for i in j.get("items", [])}
        nxt = (j.get("pagination") or {}).get("nextPageUrl")
        if not nxt:
            break
        url = site + nxt + ("&" if "?" in nxt else "?") + "format=json"
    return found


def known_slugs(out_dir):
    slugs = set()
    try:
        with open(os.path.join(out_dir, "directory-index.json"), encoding="utf-8") as f:
            slugs |= {b["s"] for b in json.load(f)["bios"]}
    except (OSError, ValueError, KeyError):
        pass
    seed = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "seed-slugs.txt")
    if os.path.exists(seed):
        slugs |= {l.strip() for l in open(seed, encoding="utf-8") if l.strip()}
    return slugs


def fetch_items(site, collection, out_dir):
    """Candidates = feed + sitemap + already-indexed + seed list. Drafts and deleted posts return 404
    to anonymous requests and are skipped, so publishing a draft adds it on the next run."""
    slugs = feed_slugs(site, collection) | sitemap_slugs(site, collection) | known_slugs(out_dir)

    def one(slug):
        try:
            item = json.loads(get(f"{site}/{collection}/{slug}?format=json", tries=2)).get("item")
        except RuntimeError:
            return None
        return item if item and item.get("urlId") == slug else None

    with ThreadPoolExecutor(max_workers=6) as ex:
        items = [i for i in ex.map(one, sorted(slugs)) if i]
    if not items:
        raise RuntimeError("No published posts found; is the collection page enabled and public?")
    return items


def items_from_wxr(path):
    x = open(path, encoding="utf-8").read()
    out = []
    for it in re.findall(r"<item>(.*?)</item>", x, re.S):
        def g(tag):
            m = re.search(r"<" + tag + r"><!\[CDATA\[(.*?)\]\]>", it, re.S)
            return m.group(1) if m else ""
        if g("wp:post_type") != "post" or g("wp:status") != "publish":
            continue  # drafts are not public, so the live index never sees them either
        out.append({"title": g("title"), "urlId": g("wp:post_name"), "body": g("content:encoded")})
    return out


# ---------- parsing ----------

class Text(HTMLParser):
    """HTML -> text, one line per <br>/<p>/<li>; skips the 'Photo' link labels."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self._a_text, self._in_a, self._skip = [], [], False, 0

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script", "noscript", "template"):
            self._skip += 1
            return
        if tag in ("br", "p", "li", "h1", "h2", "h3", "h4", "div"):
            self.parts.append("\n")
        if tag == "a":
            self._in_a, self._a_text = True, []

    def handle_endtag(self, tag):
        if tag in ("style", "script", "noscript", "template"):
            self._skip = max(0, self._skip - 1)
            return
        if tag == "a":
            t = "".join(self._a_text)
            if not re.fullmatch(r"\s*Photo( \(beside text\))?\s*", t):
                self.parts.append(t)
            self._in_a = False
        elif tag in ("p", "li", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self._skip:
            return
        (self._a_text if self._in_a else self.parts).append(data)

    def text(self):
        return re.sub(r"[ \t ]+", " ", "".join(self.parts))


def to_text(body):
    p = Text()
    p.feed(body or "")
    return p.text()


DETAIL_KEYS = ("Years", "Branch", "Conflict", "Cemetery", "Rank", "Written by", "School", "Instructed by",
               "Section", "Site", "Grave", "Interment date", "PDF")


def details(body):
    """Read 'Label: value' lines from the Bio details: the first paragraph that starts with a facet label,
    plus any following paragraphs that also start with a known label (editors may press Enter, not Shift+Enter)."""
    d, started = {}, False
    for para in re.findall(r"<p[^>]*>(.*?)</p>", body or "", re.S):
        lines = [l.strip() for l in to_text(para).split("\n") if l.strip()]
        if not started:
            if not (lines and re.match(r"(Years|Branch|Conflict|Cemetery):", lines[0])):
                continue
            started = True
        elif not (lines and lines[0].partition(":")[0].strip() in DETAIL_KEYS and ":" in lines[0]):
            break
        for l in lines:
            k, sep, v = l.partition(":")
            if sep and k.strip():
                d[k.strip()] = v.strip()
    return d


def split_vals(v):
    return [x.strip() for x in re.split(r"\s*[,;]\s*", v or "") if x.strip()]


def sort_key(name):
    first = re.split(r"\s+and\s+", name)[0]
    words = [w for w in re.sub(r"[“”\"',.()]", " ", first).split() if w.lower() not in SUFFIXES]
    last = words[-1] if words else name
    return fold(f"{last} {' '.join(words[:-1])}")


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower()


def words(text):
    seen = []
    have = set()
    for w in re.findall(r"[a-z0-9]+", fold(text)):
        if len(w) < 2 or w in STOP or w in have:
            continue
        have.add(w)
        seen.append(w)
    return " ".join(seen)


def build(items):
    meta, search = [], {}
    for it in items:
        body = it.get("body") or ""
        d = details(body)
        slug = it["urlId"]
        name = html.unescape(it["title"])
        row = {
            "s": slug,
            "n": name,
            "y": d.get("Years", ""),
            "b": split_vals(d.get("Branch")),
            "c": split_vals(d.get("Conflict")),
            "m": split_vals(d.get("Cemetery")),
            "k": sort_key(name),
        }
        meta.append(row)
        search[slug] = words(" ".join([name, " ".join(f"{k} {v}" for k, v in d.items()), to_text(body)]))
    meta.sort(key=lambda r: r["k"])
    return meta, search


def write_if_changed(path, key, data, stamp):
    """Rewrite only when the content changed, so the nightly job commits nothing on quiet days."""
    try:
        with open(path, encoding="utf-8") as f:
            if json.load(f).get(key) == data:
                return False
    except (OSError, ValueError):
        pass
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "built": stamp, key: data}, f, ensure_ascii=False, separators=(",", ":"))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://veterans.wvhumanities.org")
    ap.add_argument("--collection", default="biography-directory")
    ap.add_argument("--from-wxr")
    ap.add_argument("--out", default="dist")
    a = ap.parse_args()
    items = items_from_wxr(a.from_wxr) if a.from_wxr else fetch_items(a.site.rstrip("/"), a.collection, a.out)
    meta, search = build(items)
    if len(meta) < 10:
        sys.exit(f"Only {len(meta)} bios found; refusing to overwrite the index.")
    os.makedirs(a.out, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    changed = write_if_changed(os.path.join(a.out, "directory-index.json"), "bios", meta, stamp)
    changed |= write_if_changed(os.path.join(a.out, "search-index.json"), "words", search, stamp)
    print("index changed" if changed else "index unchanged")
    no_facets = [r["s"] for r in meta if not (r["b"] and r["c"])]
    print(f"{len(meta)} bios indexed; missing Branch/Conflict: {no_facets or 'none'}")


if __name__ == "__main__":
    main()
