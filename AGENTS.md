# Repository Guidelines

## Scope

This repository owns the DSH plugin compatibility orchestrator, reusable GitHub Action, schemas, reports, and tests. Referenced DSH source trees and plugin repositories are external fixtures or consumers, not part of this repository.

## Non-negotiable boundaries

- The project is currently in a user-declared grilling/design phase. Until the user explicitly ends grilling and authorizes implementation, limit work to read-only research and documentation; do not install workflows, create fault branches, configure secrets, call repair models, or mutate the public fixture.
- Keep the watched candidate DSH runtime separate from the pinned repair runner.
- Treat `0.1.1-rc.2`, `deepseek-v4-flash-vision-exp`, and the bundled DeepSeek tariff windows as overridable defaults, not engine constants. Resolve and pin the effective DSH version, provider, model, price revision, and package graph for each campaign.
- A changed dependency snapshot under the same root DSH version automatically reruns repository tests, pack/install, dump-config, real DSH startup, and plugin smoke assertions without invoking the repair model. This still consumes CI runtime, but not model tokens and not a new budget bucket. If that version already consumed its one automatic repair, require the existing reset control before another model repair. Do not add a user-facing knob for this behavior.
- Do not describe DeepSeek web search as a capability built into the vision model. It is a separate DSH provider call; report its selected model, result, and call count, plus usage only when DSH exposes it.
- V1 may configure any provider id, base URL, credential environment reference, and model id already supported by DSH. Do not build a parallel provider protocol or OpenAI billing parser; the default accounting contract is DSH-normalized DeepSeek usage plus a versioned official price map.
- V1 treats the repository where Guardian is installed as the only source of truth. Do not sync, modify, or open pull requests against an original upstream repository.
- Never grant the candidate runtime a repository write token. It has no model credential by default; only an onboarding-reviewed smoke contract with `requires_model_turn: true` may inject the repository's configured provider/model secret into one isolated fixed-turn smoke step. Count that usage in the same campaign, return `BLOCKED` when the secret is absent, and do not add an ephemeral proxy in V1.
- A repair agent may propose changes; only the independent verifier may produce PASS.
- The default edit boundary is ordinary plugin files in the current repository, not a repository-specific long allowlist. Mechanically reject changes to `.github/workflows/**`, Guardian config/lock, the onboarding smoke contract, the independent verifier, secrets/credentials, and paths resolving outside the repository.
- A repair may propose repository test changes. If its diff adds or modifies test files, test configuration, or test commands in a manifest, the publisher must override auto-merge/direct-push and deliver a human-reviewed pull request with the triggering paths reported.
- Dependency changes must be minimal and causally tied to the current candidate DSH failure. Reject blanket or unrelated upgrades and package-manager changes. New or removed dependencies, major-version jumps, and install lifecycle-script changes require a human-reviewed pull request; an existing DSH-related range plus matching lockfile update may use the configured delivery mode after full verification.
- Do not infer generated status from directory names alone. When a repository declares a build command and corresponding source inputs, edit the source and require a clean rebuild to reproduce tracked `lib/dist` output byte-for-byte. Treat maintained `lib` as source when no build command exists. Unreproducible artifacts cannot PASS.
- Keep file operations simple: ordinary repository files may be added, changed, renamed, or deleted. The existing protected-path denylist also forbids deletion; rely on the original build/test/pack/install/contract/verifier to reject other harmful deletions instead of maintaining a second critical-file list.
- Report changed-file and added/deleted-line counts, but do not add hard diff-size limits. Existing usage, time, attempt, one-repair, protected-path, and verifier gates own runaway prevention.
- Inject model secrets only for a campaign bound to a trusted default-branch SHA and triggered by schedule, workflow_dispatch, or default-branch push. The contract-required candidate smoke exception above may receive one fixed-turn secret before a compatibility verdict; the repair runner receives it only after a no-secret compatibility job proves repair is needed. Never expose either path to PR/fork code, pull_request_target with PR checkout, or an arbitrary ref. Keep publisher Git credentials in a separate job.
- Keep the product scoped to plugin incompatibility caused by a DSH release or changed DSH install graph. Do not turn unrelated dependency, CI, cleanup, or general maintenance failures into model repair campaigns.
- Poll NPM latest and the install graph every six hours by default (`17 */6 * * *`), plus manual dispatch and default-branch Guardian config/lock changes. Ordinary source pushes do not trigger Guardian. Treat cron as a wake-up and converge to the latest value observed then.
- With no prior verified lock entry, bootstrap from the campaign-pinned repair DSH (default `0.1.1-rc.2`). Record it as the first verified baseline only after the full contract passes; otherwise report `ONBOARDING_BLOCKED` without invoking repair. Do not add a separate baseline setting.
- Pin each attempt to its starting default-branch commit and re-read the branch before publishing. A changed SHA makes the old attempt `STALE_SOURCE` and blocks delivery. Re-test the new source without a model first; preserve an unused repair chance, but never reset a consumed repair chance or budget merely because source changed.
- Use one repair pull request per target DSH version. If latest moves before merge, mark and close the old PR as `SUPERSEDED` while preserving its history; start the new target from the current default branch and never rewrite or reuse the old PR.
- Pin the installed external Guardian reusable workflow to a full commit SHA with a release-version comment. Do not add Guardian self-update checks or update PRs in V1, and never change that pin merely because candidate DSH latest moved.
- Persist a no-repair PASS through the existing delivery mode as an exact verified lock plus concise report. Do not modify plugin code or invent an Issue-only state source; the next poll must deduplicate from committed state.
- Use overridable defaults of 1,000,000 total tokens, 10 estimated CNY, 60 active repair/verifier minutes, and two repair attempts. Stop on the first exhausted limit, send the optional 30%-remaining convergence message once, and exclude `WAITING_FOR_PRICE` from active wall time.
- Allow repair DSH to use the native DeepSeek search provider on demand, and prompt it to prefer official standards, documentation, source, and NPM metadata as supporting evidence. Do not add search-specific call/use caps; retain the overall active wall limit and provider limits. Search failure is reported without model fallback and cannot replace or independently fail the verifier.
- Do not weaken gates, budgets, workflow permissions, or the protected-path denylist to make a failing candidate pass.
- The repair agent must not edit the compatibility contract, workflow, or generated `verified` state. A separate publisher validates the diff boundary and owns PR, auto-merge, and explicitly enabled direct-push delivery.
- A failed campaign must not advance `.dsh-compat.lock.json#verified`. A budget reset is an edge-triggered user control, not a standing permission to retry forever.
- Do not commit raw agent transcripts, copied Codex records, secrets, local paths, temporary DSH homes, runtime logs, or generated caches.
- Preserve the acceptance IDs in `ACCEPTANCE.md`; changing or deleting one requires an explicit user decision.

## Verification

Design-only changes require Markdown/path review, config-schema parsing where applicable, privacy scanning, `git diff --check`, and Git status review. Runtime changes must additionally exercise one real plugin repository against an exact candidate DSH version in a fresh `DSH_HOME` and the declared consumer surface.

## Git

Use a task branch or worktree. Keep commits atomic and include verification and risk trailers. Automated compatibility branches use deterministic names under `automation/dsh-compat/`. Direct push is supported only when explicitly configured and must still be performed by the publisher, never from the repair agent process.
