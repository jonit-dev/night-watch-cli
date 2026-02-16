# Contributing

## Development Setup

```bash
git clone https://github.com/jonit-dev/night-watch-cli.git
cd night-watch-cli
npm install
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Run in Development

```bash
npm run dev -- init
```

---

## Publishing (For Maintainers)

To publish a new version to npm:

```bash
# 1. Update version in package.json
# 2. Build and test
npm run build
npm test

# 3. Publish to npm (public access)
npm run publish:npm
```

The `publish:npm` script runs `npm publish --access public`.
