# Local CLI Testing

How to test the CLI locally without publishing to npm.

---

## Quick Start (Recommended)

Build and link the CLI globally in one command:

```bash
yarn local
```

This compiles TypeScript and creates a global `night-watch` symlink pointing to your local build. Now you can test in any project:

```bash
cd ~/some-other-project
night-watch init
night-watch run --dry-run
```

After making changes, run `yarn local` again to pick them up.

---

## Development Mode (No Build)

For rapid iteration, use `dev` to run directly from source via `tsx`:

```bash
yarn dev -- init
yarn dev -- run --dry-run
yarn dev -- status
```

This skips the build step entirely — great for quick feedback loops.

---

## Direct Bin Execution

After building, you can also invoke the bin entry point directly:

```bash
yarn build
node ./bin/night-watch.mjs run --dry-run
```

---

## Cleanup

To remove the global symlink when you're done:

```bash
yarn unlink
```
