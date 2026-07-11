# 🌿 Rhizome v2

A minimalist, decentralised webring — rebuilt for stability, scale, and extensibility.

---

## What's new in v2

| Area | Change |
|---|---|
| **Stability** | Shared `src/core.js` — single `loadNodes` with ETag validation, stale-while-error (72 h grace) |
| **Stability** | Two-phase HEAD→GET probe with exponential backoff in `scripts/prune.js` |
| **Stability** | Pruner runs **daily** instead of weekly; `--dry-run` mode for safe testing |
| **Usability** | Cancel-redirect button on `ring.html`; "Visit site →" link after cancelling |
| **Usability** | **`directory.html`** — searchable, filterable, sortable node directory |
| **Usability** | Tag filtering on wander button (`index.html`) and transit page |
| **Automation** | `join.yml` workflow — validates URL, verifies embed, commits, closes issue automatically |
| **Features** | `<rhizome-spore>` supports `lang`, `size`, `theme`, `filter-tag` attributes |
| **Features** | `scripts/feed.js` — aggregates member RSS/Atom feeds into `feed.xml` |
| **Features** | Federation via `peers` option in `loadNodes` (opt-in cross-ring discovery) |

---

## Project structure

```
Rhizome/
├── src/
│   ├── core.js          # Shared browser module: uid, loadNodes, liveNodes
│   ├── index.js         # Landing page: wander, tag bar, stats
│   └── ring.js          # Transit page: node selection, progress, cancel
├── scripts/
│   ├── lib/
│   │   ├── semaphore.js # Async bounded-concurrency primitive
│   │   ├── probe.js     # Two-phase HTTP health check
│   │   └── verify.js    # Spore embed verifier
│   ├── prune.js         # Node health check (daily CI)
│   ├── join.js          # Auto-join processor (triggered by join.yml)
│   └── feed.js          # RSS feed aggregator
├── assets/css/
│   ├── ring.css         # Transit page styles
│   └── directory.css    # Directory page styles
├── spore.js             # <rhizome-spore> web component (standalone IIFE)
├── index.html           # Landing page
├── ring.html            # Transit page
├── directory.html       # Node directory
├── nodes.json           # Node registry
├── feed.xml             # Generated RSS feed (auto-committed)
└── .github/workflows/
    ├── prune.yml        # Daily health check
    ├── join.yml         # Auto-process join requests
    └── feed.yml         # 6-hourly feed aggregation
```

---

## Quick start (fork & deploy)

1. **Fork** this repository
2. Enable **GitHub Pages** (Settings → Pages → Source: GitHub Actions or main branch `/`)
3. Update the `host` URL in `index.html` and `ring.html` to your Pages URL
4. Update `SELF` in `scripts/feed.js` to your feed URL
5. Edit `nodes.json` — replace the seed node with your own site

---

## Embedding the widget

Add to any page on your member site:

```html
<rhizome-spore
  host="https://YOUR-USERNAME.github.io/Rhizome"
  lang="en"
  size="default"
  theme="auto">
</rhizome-spore>
<script src="https://YOUR-USERNAME.github.io/Rhizome/spore.js" defer></script>
```

### Widget attributes

| Attribute | Values | Default | Description |
|---|---|---|---|
| `host` | URL | — | **Required.** Your Rhizome registry base URL |
| `lang` | `en` `zh` `ja` `fr` `de` `es` | `en` | Button label language |
| `size` | `default` `compact` `wide` | `default` | Widget size |
| `theme` | `auto` `light` `dark` | `auto` | Color scheme |
| `filter-tag` | any tag string | — | Only traverse nodes with this tag |

---

## nodes.json schema

```json
[
  {
    "name":   "My Site",
    "url":    "https://mysite.com",
    "bio":    "A short description (max 200 chars)",
    "tags":   ["blog", "dev"],
    "joined": "2026-01-15",
    "feed":   "https://mysite.com/feed.xml",
    "status": "dormant"
  }
]
```

Fields `tags`, `joined`, `feed`, and `status` are all optional.
`status: "dormant"` is set automatically by the pruner; never set it manually.

---

## Scripts

All scripts require **Node.js ≥ 20** (for native `fetch`). No npm install needed.

```bash
# Health check — mark unreachable nodes as dormant
npm run prune

# Health check + verify embed is still present
npm run prune:verify

# Report changes without writing nodes.json
npm run prune:dry

# Aggregate member feeds into feed.xml
npm run feed

# Preview feed without writing
npm run feed:dry
```

---

## Federation (opt-in)

To cross-discover nodes from another Rhizome fork, pass `peers` to `loadNodes`:

```js
import { loadNodes } from './src/core.js';

const nodes = await loadNodes({
  peers: ['https://other-ring.github.io/Rhizome/nodes.json'],
});
```

Peer nodes are deduplicated by URL and marked with `_peer: true` in the data.

---

## Joining (for site owners)

Open a **Join** issue using the issue template. The bot will:

1. Parse your submission fields
2. Probe your URL for reachability (HEAD → GET, with retry)
3. Verify `<rhizome-spore>` is present on your page
4. Append your node to `nodes.json` and commit
5. Close the issue with a welcome message

If validation fails, the bot comments with the reason. Fix and re-apply the `join` label.

---

## License

Zero-clause BSD. Fork freely, credit appreciated.
