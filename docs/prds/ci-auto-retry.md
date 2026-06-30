# PRD: CI Auto Retry

## Context

Night Watch executor PRs can be marked ready for review after implementation finishes. If CI later fails, the PR should not wait for reviewer or human intervention before implementation fixes resume.

## Goal

Automatically resume an existing executor PR when it is marked ready for review and CI has failed.

## Non-Goals

- Do not retry PRs with pending, passing, or unknown CI.
- Do not change reviewer, QA, resolver, or merger ownership.
- Do not start a new PRD before higher-priority resumable executor work.

## Contract

- The executor PR selector treats `nw:resumable` PRs as the highest-priority resume candidates.
- If no `nw:resumable` PR is eligible, it may select a non-draft executor PR labeled `nw:ready-review` when at least one CI check has a failed conclusion.
- Ready-review PRs with pending, passing, skipped, or absent check data are ignored.
- PRs labeled `ready-to-merge` remain excluded from executor resume selection.

## Phases

### Phase 1: Selection Contract

- Add tests for failed-CI ready-review selection.
- Add tests proving pending, passing, and unknown CI are ignored.
- Add tests preserving `nw:resumable` priority over failed-CI ready-review PRs.

### Phase 2: Executor Implementation

- Extend executor resume discovery to request CI rollup data from GitHub.
- Detect failed CI from structured status check conclusions.
- Return the selected PR through the existing resume path so the executor reuses the current branch and PR.

### Phase 3: Verification

- Run focused helper/script smoke tests.
- Manually verify a ready-review executor PR with failed CI is resumed before new PRD pickup.
