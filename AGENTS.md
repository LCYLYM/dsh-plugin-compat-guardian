# Repository Guidelines

## Scope

This repository owns the DSH plugin compatibility orchestrator, reusable GitHub Action, schemas, reports, and tests. Referenced DSH source trees and plugin repositories are external fixtures or consumers, not part of this repository.

## Non-negotiable boundaries

- Keep the watched candidate DSH runtime separate from the pinned repair runner.
- Never grant the candidate runtime a repository write token or the repair runner's long-lived model credential.
- A repair agent may propose changes; only the independent verifier may produce PASS.
- Do not weaken gates, budgets, workflow permissions, or path allowlists to make a failing candidate pass.
- Do not commit raw agent transcripts, copied Codex records, secrets, local paths, temporary DSH homes, runtime logs, or generated caches.
- Preserve the acceptance IDs in `ACCEPTANCE.md`; changing or deleting one requires an explicit user decision.

## Verification

Design-only changes require Markdown/path review, config-schema parsing where applicable, privacy scanning, `git diff --check`, and Git status review. Runtime changes must additionally exercise one real plugin repository against an exact candidate DSH version in a fresh `DSH_HOME` and the declared consumer surface.

## Git

Use a task branch or worktree. Keep commits atomic and include verification and risk trailers. Automated compatibility branches use deterministic names under `automation/dsh-compat/` and must not push directly from the repair agent process.
