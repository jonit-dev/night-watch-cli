# Skill: nw-run

Manually trigger Night Watch to execute the next available PRD immediately.

## When to use

When the user wants to run Night Watch now instead of waiting for the cron schedule.

## Steps

1. **Check what's queued**:
   ```
   night-watch prd list
   ```

2. **Run the executor**:
   ```
   night-watch run
   ```

3. **To run a specific PRD** by filename:
   ```
   night-watch run --prd <filename.md>
   ```

4. **Monitor logs** in real time:
   ```
   night-watch logs --follow
   ```

## Notes

- Night Watch executes ONE PRD per run to prevent timeouts and reduce risk
- The automated cron schedule runs on a configurable interval (check with `night-watch status`)
- Use `night-watch queue` to see all queued PRDs in priority order
- If a run fails, the PRD is NOT marked as done — fix the issue and re-run
