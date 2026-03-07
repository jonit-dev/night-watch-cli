# PRD Execution Findings

Date: 2026-03-07
Project: `night-watch-cli`
Scope: Investigate:
- why `53-prd-backlink-exchange-system` failed with `provider_exit`
- why `code-cleanup-q1-2026.md` was selected even though it was not an open issue

## Summary

There are two separate problems.

1. The `53-prd-backlink-exchange-system` failure is not currently diagnosable from the surfaced notification. The executor records any non-timeout provider failure as a generic `provider_exit`, and the detail extraction tends to report the wrapper script's own `FAIL:` log line instead of the provider's real stderr.
2. The unexpected `code-cleanup-q1-2026.md` execution is caused by legacy filesystem PRD discovery still being active. When board mode is unavailable, empty, or falls back, the executor scans `docs/PRDs/night-watch` for any top-level `.md` file and treats it as an eligible PRD.

## Findings

### 1. `provider_exit` is a generic bucket, not a root cause

Evidence:
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L701) logs `FAIL: Night watch exited with code ${EXIT_CODE} while processing ${ELIGIBLE_PRD}` for all non-timeout provider failures.
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L708) emits `reason=provider_exit` for that entire class of failures.
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L78) uses `latest_failure_detail()` to summarize the log.
- `latest_failure_detail()` prefers the last `fatal:|error:|ERROR:|FAIL:|WARN:` line, which means the script's own wrapper line often wins over the actual provider error.
- [`packages/core/src/utils/notify.ts`](/home/joao/projects/night-watch-cli/packages/core/src/utils/notify.ts#L122) then forwards that summarized detail into the notification payload.

Impact:
- The notification you saw:
  `Details: [..] FAIL: Night watch exited with code 1 while processing 53-prd-backlink-exchange-system`
  is not the underlying reason. It is the executor's wrapper log.
- Based on the available evidence, there is no proof that PRD size was the direct cause.
- The runtime was about 80 minutes, which means this was not classified as the explicit timeout path (`124`). It was a non-zero provider exit after a long run.

Conclusion:
- "PRD too big" is plausible, but not proven by the current telemetry.
- The actual bug here is observability: Night Watch hides the provider's real failure behind a generic wrapper message.

### 2. Legacy filesystem PRD pickup is still enabled

Evidence:
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L17) still defaults `NW_PRD_DIR` to `docs/PRDs/night-watch`.
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L153) enters board mode only when `NW_BOARD_ENABLED=true`.
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L181) and [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L183) explicitly fall back to filesystem PRDs when board issues are unavailable.
- [`scripts/night-watch-cron.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-cron.sh#L205) calls `find_eligible_prd()` in filesystem mode.
- [`scripts/night-watch-helpers.sh`](/home/joao/projects/night-watch-cli/scripts/night-watch-helpers.sh#L321) implements `find_eligible_prd()` by scanning the PRD directory for any top-level `*.md` file.
- That scanner does not require a matching board issue or any explicit allowlist. If the file is present, unclaimed, not in cooldown, not blocked by dependency, and has no open PR for its derived branch name, it is eligible.

Repository state observed during investigation:
- `git status --short` shows `D docs/PRDs/night-watch/code-cleanup-q1-2026.md`

Interpretation:
- Your understanding is consistent with the code: Night Watch is still using the legacy "pick PRDs from `docs/PRDs/night-watch`" path.
- That is why `code-cleanup-q1-2026.md` could be selected without being an open issue.
- The deleted file in the working tree reinforces that this repo is already moving away from that legacy mechanism.

## Likely Sequence For The Second Bug

1. Executor started for `night-watch-cli`.
2. Board mode was either disabled, not configured, returned no eligible Ready issues, or hit a fallback branch.
3. The executor fell back to filesystem mode.
4. Filesystem mode scanned `docs/PRDs/night-watch`.
5. `code-cleanup-q1-2026.md` matched the legacy eligibility rules and was selected.

## Recommended Solutions

### A. Remove legacy filesystem PRD execution from the executor path

Recommended direction:
- Make board issues the only source of executable PRD work.
- Remove or hard-disable the fallback from board mode to filesystem mode.
- Treat "no eligible Ready issues" as `skip_no_eligible_prd`, not "scan `docs/PRDs/night-watch` instead".

Why:
- It aligns the runtime with the current product expectation.
- It prevents stray markdown files from being treated as executable work.
- It removes a class of confusing ghost runs like `code-cleanup-q1-2026.md`.

### B. Improve provider failure reporting

Recommended direction:
- Preserve the real provider stderr or last provider-emitted error line in the result payload.
- Avoid letting the wrapper's own `FAIL:` line overwrite the root-cause detail.
- Consider separating:
  - `reason=provider_exit`
  - `provider_exit_code=<n>`
  - `provider_error=<sanitized actual stderr summary>`

Why:
- It would let you distinguish "prompt too large", "tool failure", "auth/session problem", "model crashed", and similar cases.
- It would make large-PRD diagnosis possible instead of speculative.

### C. Add a guardrail while legacy support still exists

If filesystem discovery cannot be removed immediately:
- Require an explicit flag to enable filesystem PRD execution.
- Or require a stricter filename/prefix convention instead of any top-level `.md`.
- Or reject execution of filesystem PRDs when board mode is enabled.

## Bottom Line

- First issue: the backlink exchange PRD did not fail with a confirmed "PRD too big" reason. It failed with a generic provider exit, and Night Watch currently hides the real cause.
- Second issue: confirmed. Night Watch is still carrying the legacy filesystem PRD pickup path from `docs/PRDs/night-watch`, and that is why `code-cleanup-q1-2026.md` was executed even though it was not an open issue.
