# Skill: nw-board-sync

Sync the GitHub Project board with the current state of Night Watch PRDs and pull requests.

## When to use

When the board is out of sync with PRD/PR status, or after manual changes to issues or PRDs.

## Steps

1. **View current board state**:

   ```
   night-watch board status
   ```

2. **Sync board with PRD filesystem**:

   ```
   night-watch board sync
   ```

3. **List open issues that may need board assignment**:

   ```
   gh issue list --state open --label "night-watch"
   ```

4. **Add any missing issues to the board**:
   ```
   night-watch board add-issue <number>
   ```

## Board Columns

| Column      | Meaning                                          |
| ----------- | ------------------------------------------------ |
| Draft       | Not ready for execution                          |
| Ready       | Queued for Night Watch — picked up automatically |
| In Progress | Currently being implemented                      |
| Review      | PR opened, awaiting review                       |
| Done        | Merged and complete                              |

## Notes

- Night Watch auto-moves issues from Ready → In Progress when starting, and In Progress → Review when opening a PR
- Use `night-watch board setup` to create the board if it doesn't exist yet
