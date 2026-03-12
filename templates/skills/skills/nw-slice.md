# Skill: nw-slice

Slice a high-level roadmap item or epic into multiple focused PRD files for Night Watch execution.

## When to use

When the user has a large feature or roadmap item that should be broken into smaller,
independently-executable pieces.

## Steps

1. **Ask for the epic description** if not provided.

2. **Run the slicer** to auto-generate PRDs from a roadmap file:

   ```
   night-watch slice
   ```

   This reads `docs/roadmap.md` (or configured roadmap path) and generates PRD files.

3. **To slice a specific feature**, first add it to `docs/roadmap.md`, then run slice.

4. **Review generated PRDs** in `docs/prds/` — adjust scope, complexity, or phases if needed.

5. PRDs run in creation order (or by `prdPriority` config) on the next Night Watch execution.

## Tips

- Each PRD should be deployable independently without breaking anything
- Keep PRDs focused on 1-2 user stories for faster execution
- Complex PRDs (score 3) often benefit from splitting into 2 medium PRDs
- Use `Depends-On: <other-prd.md>` in a PRD's front matter to enforce ordering
