#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI_PKG="$REPO_ROOT/packages/cli"
PROJECTS_FILE="$HOME/.night-watch/projects.json"
BETA=false

# Parse flags
for arg in "$@"; do
  case $arg in
    --beta) BETA=true ;;
  esac
done

cd "$REPO_ROOT"

# Yarn workspace sets npm_config_registry=https://registry.yarnpkg.com which breaks auth.
# Force all npm calls to use the official registry where the auth token is stored.
export npm_config_registry=https://registry.npmjs.org

CURRENT_VERSION=$(node -p "require('$CLI_PKG/package.json').version")

# Confirmation prompt
echo ""
if [[ "$BETA" == true ]]; then
  echo "  ┌─────────────────────────────────────────────────────────┐"
  echo "  │                  BETA RELEASE                           │"
  echo "  │                                                         │"
  echo "  │  Published to: npm tag @beta                           │"
  echo "  │  Install with: npm i -g @jonit-dev/night-watch-cli@beta │"
  echo "  │  Current version: $CURRENT_VERSION"
  echo "  └─────────────────────────────────────────────────────────┘"
  echo ""
  read -r -p "  Publish beta release? [y/N] " confirm
else
  echo "  ┌─────────────────────────────────────────────────────────┐"
  echo "  │              STABLE (LATEST) RELEASE                    │"
  echo "  │                                                         │"
  echo "  │  WARNING: This publishes to the @latest npm tag.       │"
  echo "  │  All users running 'npm update' will receive this.     │"
  echo "  │                                                         │"
  echo "  │  Only proceed if this version is production-ready.     │"
  echo "  │  Current version: $CURRENT_VERSION"
  echo "  └─────────────────────────────────────────────────────────┘"
  echo ""
  read -r -p "  Publish stable release to ALL users? [y/N] " confirm
fi

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "==> Running verify + tests..."
yarn verify && yarn test

# Version bumping
IFS='.' read -r major minor patch_full <<< "$CURRENT_VERSION"

if [[ "$BETA" == true ]]; then
  # Strip any existing pre-release suffix from patch
  patch="${patch_full%%-*}"

  # Check if current version is already a beta of the next patch
  if [[ "$CURRENT_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$ ]]; then
    # Bump beta number: 1.8.4-beta.0 -> 1.8.4-beta.1
    base="${BASH_REMATCH[1]}"
    beta_num="${BASH_REMATCH[2]}"
    NEW_VERSION="$base-beta.$((beta_num + 1))"
  else
    # Start new beta: 1.8.3 -> 1.8.4-beta.0
    NEW_VERSION="$major.$minor.$((patch + 1))-beta.0"
  fi
  NPM_TAG="beta"
else
  # Stable: strip any pre-release suffix and bump patch
  patch="${patch_full%%-*}"
  NEW_VERSION="$major.$minor.$((patch + 1))"
  NPM_TAG="latest"
fi

echo "==> Bumping version: $CURRENT_VERSION -> $NEW_VERSION"

node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$CLI_PKG/package.json', 'utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('$CLI_PKG/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "==> Committing version bump..."
git add "$CLI_PKG/package.json"
git commit -m "chore: bump version to $NEW_VERSION"
git push origin master

echo "==> Publishing to npm (tag: $NPM_TAG)..."
cd "$CLI_PKG"
npm publish --access public --tag "$NPM_TAG"

echo "==> Installing globally (waiting for registry propagation)..."
echo "    Waiting 60s for npm registry to propagate..."
sleep 60
for attempt in 1 2 3 4 5; do
  if npm i -g "@jonit-dev/night-watch-cli@$NEW_VERSION"; then
    break
  fi
  if [[ $attempt -lt 5 ]]; then
    echo "    Attempt $attempt failed, retrying in 60s..."
    sleep 60
  else
    echo "    All attempts failed. Install manually: npm i -g @jonit-dev/night-watch-cli@$NEW_VERSION"
    exit 1
  fi
done
night-watch --version

# Only update registered projects for stable releases
if [[ "$BETA" == true ]]; then
  echo ""
  echo "==> Skipping project updates (beta release)."
else
  echo "==> Updating registered projects (skipping /tmp/*)..."
  if [[ -f "$PROJECTS_FILE" ]]; then
    node -e "
      const projects = JSON.parse(require('fs').readFileSync('$PROJECTS_FILE', 'utf8'));
      projects
        .filter(p => p.path && !p.path.startsWith('/tmp/'))
        .forEach(p => {
          console.log('  Project: ' + p.name + ' (' + p.path + ')');
          const { execSync } = require('child_process');
          try {
            execSync('night-watch update --projects ' + p.path, { stdio: 'inherit' });
          } catch (e) {
            console.error('  WARN: update failed for ' + p.name);
          }
        });
    "
  else
    echo "    No projects file found at $PROJECTS_FILE, skipping."
  fi
fi

echo ""
echo "Done! Published $NEW_VERSION (@$NPM_TAG)"
