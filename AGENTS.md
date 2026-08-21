# Repository Guidelines

## Scope

This repository owns the DSH plugin compatibility orchestrator, reusable GitHub Action, schemas, reports, and tests. Referenced DSH source trees and plugin repositories are external fixtures or consumers, not part of this repository.

## Non-negotiable boundaries

- Keep the watched candidate DSH runtime separate from the pinned repair runner.
- Treat `0.1.1-rc.1`, `deepseek-v4-flash-vision-exp`, and the bundled DeepSeek tariff windows as overridable defaults, not engine constants. Resolve and pin the effective DSH version, provider, model, price revision, and package graph for each campaign.
- Do not describe DeepSeek web search as a capability built into the vision model. It is a separate DSH provider call and its model, usage, and result must be reported independently.
- V1 treats the repository where Guardian is installed as the only source of truth. Do not sync, modify, or open pull requests against an original upstream repository.
- Never grant the candidate runtime a repository write token or the repair runner's long-lived model credential.
- A repair agent may propose changes; only the independent verifier may produce PASS.
- Do not weaken gates, budgets, workflow permissions, or path allowlists to make a failing candidate pass.
- The repair agent must not edit the compatibility contract, workflow, or generated `verified` state. A separate publisher owns PR, auto-merge, and explicitly enabled direct-push delivery.
- A failed campaign must not advance `.dsh-compat.lock.json#verified`. A budget reset is an edge-triggered user control, not a standing permission to retry forever.
- Do not commit raw agent transcripts, copied Codex records, secrets, local paths, temporary DSH homes, runtime logs, or generated caches.
- Preserve the acceptance IDs in `ACCEPTANCE.md`; changing or deleting one requires an explicit user decision.

## Verification

Design-only changes require Markdown/path review, config-schema parsing where applicable, privacy scanning, `git diff --check`, and Git status review. Runtime changes must additionally exercise one real plugin repository against an exact candidate DSH version in a fresh `DSH_HOME` and the declared consumer surface.

## Git

Use a task branch or worktree. Keep commits atomic and include verification and risk trailers. Automated compatibility branches use deterministic names under `automation/dsh-compat/`. Direct push is supported only when explicitly configured and must still be performed by the publisher, never from the repair agent process.
