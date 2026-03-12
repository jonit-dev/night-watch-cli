## Night Watch Skills

The following Night Watch CLI commands are available. Use them when the user asks to manage PRDs, board issues, or trigger Night Watch operations.

### Create a PRD (`/nw-create-prd`)

Create a new PRD at `docs/prds/<name>.md`. Ask for feature title, assess complexity (1=Simple, 2=Medium, 3=Complex), split into phases with checkbox tasks, then write the file. Tell the user to run `night-watch run` to execute immediately.

### Add Issue to Board (`/nw-add-issue`)

Add a GitHub issue to the Night Watch board:
```
night-watch board add-issue <issue-number>
night-watch board add-issue <issue-number> --column "In Progress"
```
Available columns: Draft, Ready, In Progress, Review, Done.

### Run Next PRD (`/nw-run`)

Manually trigger Night Watch to execute the next PRD:
```
night-watch prd list         # see what's queued
night-watch run              # execute next PRD
night-watch run --prd <file> # run specific PRD
night-watch logs --follow    # monitor progress
```

### Slice Roadmap (`/nw-slice`)

Break a high-level feature into multiple PRD files:
```
night-watch slice
```
Reads `docs/roadmap.md` and generates PRDs. Review and adjust output in `docs/prds/`.

### Sync Board (`/nw-board-sync`)

Sync the GitHub board with PRD/PR state:
```
night-watch board status
night-watch board sync
```

### Review PRs (`/nw-review`)

Run automated PR review:
```
night-watch review
night-watch review --pr <number>
night-watch logs --type review
```
