# Theme gallery

Builds every theme against the same sample site, screenshots it, and puts the pictures on one page
so a person can page through them and say which ones look bad.

Since #963 the page also opens with **the pairs a vision model thought looked most alike**, so the
person can start there instead of scanning all of them. That list is a hint, not a gate — nothing
here blocks a build or a ship, and taste stays a human call.

These scripts used to live outside the repository, in one ticket's temporary workspace with the
paths hardcoded. They are here now because a tool that isn't in git can't ship and doesn't survive
a directory cleanup — and this one is meant to run every time the theme registry changes.

Since #981 this is the **only** theme-screenshot pipeline. `tests/e2e/region-shots.mjs` used to do the
same three things (build every theme, screenshot, put the pictures on one page) and is deleted; what it
had that this did not is now here:

| What region-shots.mjs had | Where it is now |
|---|---|
| Header/footer structure under each picture | `shoot.mjs` reads `data-region-layout` off the `<header>`/`<footer>` of the **home** page; `gallery.mjs` prints it. Its version read `themes[id].supports.header` (called `layout` before #1010) — the registry, not the page — so it could not see `resolveRegionLayout` changing its mind (unknown variant → default; hero not provably dark → a scrim gets added). |
| Multi-locale header close-up, for the language switcher | `shoot-themes.sh --header-closeup`, against a multi-locale sample site. Any theme, not the two it hardcoded. |
| Made its own sample site with `create-site` | Still the caller's job (step 1 below) — that is what lets you shoot *your* sample. The multi-locale payload is written out in `shoot-themes.sh`'s header comment. |

## What has to be installed first

Two of these steps are not pure Node, and neither dependency can be expressed in `package.json`:

| Needed by | What | Install |
|---|---|---|
| `layout-readback.py` | `python3` | `apt-get install -y python3` |
| `review-pairs.mjs` | `python3` **with Pillow** — it resizes each screenshot before sending it, and thumbnail size is the cost lever | `apt-get install -y python3-pil` (or `python3 -m pip install Pillow`) |

`review-pairs.mjs` checks for Pillow before it does anything else, so a missing one is a one-line
message rather than a stack trace out of the middle of the run.

## Running it

```bash
cd templates/nextjs
export THEME_GALLERY_DIR=/root/theme-gallery/latest  # where the output goes

# 1. a sample site must be in place at templates/nextjs/site/ …
#    …and it must carry the "every block once" page, or the gallery is blind to most block types
#    (#1061). Widening it costs nothing and calls no AI:
node scripts/theme-css-invariants-sample-pages.js "$PWD/site"
# 2. build + screenshot every theme (no AI, no cost)
bash scripts/theme-gallery/shoot-themes.sh
#    …or, with a MULTI-LOCALE sample site, also crop the top of each home page so the language
#    switcher is big enough to judge (see that script's header for the create-site payload):
# bash scripts/theme-gallery/shoot-themes.sh --header-closeup

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
| `shoot-themes.sh` | For each theme: write `site/theme.json`, build, serve, screenshot. Refuses a screenshot whose page carries no theme colours or fonts. Refuses to start at all if the sample site has no all-blocks page (#1061). `--header-closeup` adds the header crop. |
| `shoot.mjs` | The browser half of the above, plus the per-theme `<id>.json` readings — colours, fonts, and (since #981) the header/footer Region read off the home page's DOM. Shoots three pages since #1061: home, about, and the all-blocks page — the first two together hold only a handful of the block types, so without the third a theme that breaks any of the others passes a human review of every picture. |
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
