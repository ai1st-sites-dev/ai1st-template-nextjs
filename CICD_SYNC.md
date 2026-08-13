# How this template reaches the site-build orgs (CI/CD)

This directory (`templates/nextjs/` in the `webisca/ai1st` monorepo) is the **source
of truth** for the Next.js site template. It is mirrored into three standalone repos
that the manager/worker clone when building sites — you do **not** push to those
repos by hand:

| Mirror repo | Environment | How it updates |
|---|---|---|
| `ai1st-sites-test/ai1st-template-nextjs` | test | **Auto** — every push to `main` that touches `templates/nextjs/**` triggers `.github/workflows/ci-cd.yml` → `sync-template` → `ENV=test deploy.sh --template` subtree-pushes here. |
| `ai1st-sites-dev/ai1st-template-nextjs` | dev (the cloud dev box) | **Auto** — same job, second push (`ENV=dev`). 🔴 Added by #979: before that, nothing pushed this repo at all (last commit 2026-06-13) while dev site builds kept reading it, so dev could silently drift away from what test and prod build. |
| `ai1st-sites/ai1st-template-nextjs` | prod | **Manual promote** — run the `Deploy to prod` workflow (`deploy-prod.yml`) with the `template` input ticked. It copies the **test** mirror's current bytes to prod, so prod always gets exactly what was validated on test. |

**Auth:** every flow mints short-lived (1h) GitHub App installation tokens from the
`ghapp-ai1st-sites` App (app-id `3844782`, `contents:write` on all three orgs). No PAT.

**Manual fallback** (if Actions is down): from the monorepo root,
`ENV=test ./deploy/deploy.sh --template` and `ENV=dev ./deploy/deploy.sh --template`
do the same two subtree pushes locally. Each needs a `template-test` / `template-dev`
remote carrying a token — see the job in `ci-cd.yml` for the URL shape.

**Gotcha (fixed):** the auto-sync job runs `actions/checkout` with
`persist-credentials: false`. Otherwise checkout's default `GITHUB_TOKEN`
extraheader (scoped to `webisca/ai1st` only) overrides the App token in the
template remote URL and 404s the cross-org push.

See `docs/DEPLOY.md` and TICKET-219 for the full design.
