# Theme gallery

Builds every theme against the same sample site, screenshots it, and puts the pictures on one page
so a person can page through them and say which ones look bad.

Since #963 the page also opens with **the pairs a vision model thought looked most alike**, so the
person can start there instead of scanning all of them. That list is a hint, not a gate — nothing
here blocks a build or a ship, and taste stays a human call.

These scripts used to live outside the repository, in one ticket's temporary workspace with the
paths hardcoded. They are here now because a tool that isn't in git can't ship and doesn't survive
a directory cleanup — and this one is meant to run every time the theme registry changes.

## Running it

```bash
cd templates/nextjs
export THEME_GALLERY_DIR=/root/theme-gallery/latest  # where the output goes

# 1. a sample site must be in place at templates/nextjs/site/
# 2. build + screenshot every theme (no AI, no cost)
bash scripts/theme-gallery/shoot-themes.sh

# 3. read the layout back out of the screenshots (this is what the captions are based on)
python3 scripts/theme-gallery/layout-readback.py

# 4. the AI similarity review  (~$2 for 30 themes, a few minutes)
ANTHROPIC_API_KEY=... node scripts/theme-gallery/review-pairs.mjs

# 5. build the page
node scripts/theme-gallery/gallery.mjs
```

Only `$THEME_GALLERY_DIR/public/` is meant to be served — it holds `index.html` and `shots/`.
Everything else (build logs, the copied sites, the registry backup) stays outside it. An earlier
version of this pipeline served the whole directory and published a config backup holding a live
R2 key for four hours.

## The files

| File | What it does |
|---|---|
| `paths.mjs` | Where things are. The template directory comes from this file's own location; the output directory is `THEME_GALLERY_DIR`. |
| `shoot-themes.sh` | For each theme: write `site/theme.json`, build, serve, screenshot. Refuses a screenshot whose page carries no theme colours or fonts. |
| `shoot.mjs` | The browser half of the above, plus the per-theme `<id>.json` readings. |
| `layout-readback.py` | Works out which section on the page is which block type, by comparing two independent groupings. Writes `layout-readback.json`; the gallery captions read it. Refuses to write if the groupings disagree. |
| `review-pairs.mjs` | Asks a vision model, for every pair, whether an ordinary visitor would call them the same design recoloured. Writes `review.json`. |
| `gallery.mjs` | Builds `public/index.html`. |
| `verify-applied.mjs` | Per-theme check that the page matches the registry (colours, fonts, every section's variant). |
| `check-controls.sh` | Checks that the review can tell a recolour from a genuinely different look. Run it when the prompt, model, or thumbnail size changes. |

## What the review costs, and how to change it

Every pair is scored — 30 themes is 435 pairs — so the list has no blind spot. The lever on cost is
thumbnail size, not sampling:

| Variable | Default | Effect |
|---|---|---|
| `THEME_REVIEW_THUMB_WIDTH` | 200 | Wider images cost proportionally more |
| `THEME_REVIEW_THUMB_HEIGHT` | 1000 | How far down the page the model sees |
| `THEME_REVIEW_MODEL` | `claude-opus-5` | |
| `THEME_REVIEW_PRICE_IN` / `_OUT` | 5 / 25 | List price per million tokens, used only to print the spend |

The measured spend goes into `review.json` and onto the page, so a change that makes this more
expensive is visible rather than silent.

`--limit N` scores only the first N pairs. It is for a cheap smoke test: the report then says so in
its `coverage` field and on the page, because a truncated run must not read like a complete one.

Without `ANTHROPIC_API_KEY` the review **fails** instead of writing an empty list — on the page,
"we didn't run it" and "nothing looked alike" would otherwise be indistinguishable.
