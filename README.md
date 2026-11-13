# WVNCP Biography Directory

Searchable, filterable directory of West Virginia National Cemeteries Project biographies for the
West Virginia Humanities Council's Squarespace site (https://veterans.wvhumanities.org/biography-directory).

## Files

| Path | What it is |
|---|---|
| `dist/directory.js`, `dist/directory.css` | The directory (vanilla JS, no dependencies). Served by jsDelivr from version tags. |
| `dist/directory-index.json` | One row per published bio: name, years, Branch, Conflict, Cemetery, sort key. |
| `dist/search-index.json` | Each bio's unique words, for full-text search (loaded on first search). |
| `scripts/build_index.py` | Builds both index files from the live site (standard library only). |
| `.github/workflows/build-index.yml` | Rebuilds the index nightly and on demand, then purges the jsDelivr cache. |

## Embed (Squarespace Code Block on the Biography Directory page)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/joshdodd/wvncp-directory@1/dist/directory.min.css">
<div id="wvncp-directory" data-collection="/biography-directory"></div>
<script src="https://cdn.jsdelivr.net/gh/joshdodd/wvncp-directory@1/dist/directory.min.js" defer></script>
```

`@1` follows the latest 1.x release tag. The index files are read from `@main`.

## How the data works

Facets come from each post's **Bio details** block (the first paragraph of `Label: value` lines:
`Years`, `Branch`, `Conflict`, `Cemetery`, ...), not from Squarespace categories. Only published posts
are indexed. Posts are discovered through `sitemap.xml` because the collection feed's pagination skips
posts that share a publish date.

After adding or editing a bio, either wait for the nightly run or start **Actions → Build directory
index → Run workflow** on GitHub.

## Squarespace hooks

Only hooks from the Squarespace Custom Code Specification are used: once the directory renders it adds
`wvncp-dir-on` to `<html>`, and the CSS hides `[data-sqsp-section="blog-list"]` (the default post list).
If the script or index fails to load, nothing is hidden and the default list remains as the fallback.
