# Skill: nw-add-issue

Add an existing GitHub issue to the Night Watch project board for tracking and execution.

## When to use

When the user wants to add a GitHub issue to the Night Watch Kanban board.

## Steps

1. **Check for issue number** — if not provided, list open issues:

   ```
   gh issue list --state open --limit 20
   ```

   Ask the user which issue(s) to add.

2. **Add the issue to the board**:

   ```
   night-watch board add-issue <issue-number>
   ```

3. **Optionally specify a column** (default: "Ready"):

   ```
   night-watch board add-issue <issue-number> --column "In Progress"
   ```

   Available columns: `Draft`, `Ready`, `In Progress`, `Review`, `Done`

4. **Confirm** the issue was added and show its board position.

## Notes

- Issues in "Ready" are picked up automatically by Night Watch on the next run
- Move issues to "Draft" if they're not yet ready for autonomous execution
- Use `night-watch board sync` if the board gets out of sync with PRDs
