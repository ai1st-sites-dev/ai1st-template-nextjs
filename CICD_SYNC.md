# How this template reaches the site-build orgs (CI/CD)

This directory (`templates/nextjs/` in the `webisca/ai1st` monorepo) is the **source
of truth** for the Next.js site template. It is mirrored into two standalone repos
that the manager/worker clone when building sites — you do **not** push to those
repos by hand:

| Mirror repo | Org | How it updates |
|---|---|---|
| `ai1st-sites-dev/ai1st-template-nextjs` | dev | **Auto** — every push to `main` that touches `templates/nextjs/**` triggers `.github/workflows/ci-cd.yml` → `deploy.sh --template` subtree-pushes here. |
| `ai1st-sites/ai1st-template-nextjs` | prod | **Manual promote** — run the `Promote template to prod` workflow (`promote-template-prod.yml`). It copies the dev mirror's current bytes to prod, so prod always gets exactly what was validated on dev. |

**Auth:** both flows mint short-lived (1h) GitHub App installation tokens from the
`ghapp-ai1st-sites` App (app-id `3844782`, `contents:write` on both orgs). No PAT.

**Manual fallback** (if Actions is down): `ENV=dev ./deploy/deploy.sh --template`
from the monorepo root does the same dev subtree push locally.

See `docs/DEPLOY.md` and TICKET-219 for the full design.
