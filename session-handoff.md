# Session handoff

Compact note for the next session. Keep it to one screen.

- Date: 2026-10-05
- Session goal: Bring the state files in line with the shipped project.
- Verified state (last `npm run verify` result): 11 checks, all green (build, data contract, geo, dimensions, 1:1 fit, traffic, models, smoke life, trams, rail, console). One transient smoke console failure appeared while dist was rebuilt; a rerun passed.
- Active feature (id): `porto-012` (deploy). The site is live at https://porto-3d.vercel.app. The domain `porto-3d.com` does not answer.
- What changed: category chip labels (structure/coast/culture); `aWall` buffer overrun fixed in `src/buildings.js`; `smoke console` gate added; road glow fades with fog (`FOG_ADDITIVE`); all state files rewritten.
- What is half-done or risky:
  - 10 landmarks have no `public/og/<id>.jpg`, but their `/p/<id>/` pages reference it.
  - `scripts/sync-engine.sh` never ran; `scripts/engine-base.txt` is still the fork commit `1784ff3`.
  - Quay walls (`porto-013`) and building geometry LOD (`porto-014`) are not started.
  - smoke console needs playwright-core and Chromium, or it skips.
- Exact next step: run `node scripts/make-og.mjs --og`, check that `public/og` has 71 images, then add the `porto-3d.com` domain in Vercel.
- Files to look at first: `feature_list.json`, `claude-progress.md`, `scripts/verify.mjs`, `scripts/smoke-console.mjs`, `src/fit.js`.
