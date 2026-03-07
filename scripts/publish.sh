#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI_PKG="$REPO_ROOT/packages/cli"
PROJECTS_FILE="$HOME/.night-watch/projects.json"

cd "$REPO_ROOT"

# Yarn workspace sets npm_config_registry=https://registry.yarnpkg.com which breaks auth.
# Force all npm calls to use the official registry where the auth token is stored.
export npm_config_registry=https://registry.npmjs.org

echo "==> Running verify + tests..."
yarn verify && yarn test

echo "==> Bumping patch version..."
CURRENT_VERSION=$(node -p "require('$CLI_PKG/package.json').version")
IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
NEW_VERSION="$major.$minor.$((patch + 1))"
echo "    $CURRENT_VERSION -> $NEW_VERSION"

# Update package.json
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

echo "==> Publishing to npm..."
cd "$CLI_PKG"
npm publish --access public

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

echo ""
echo "Done! Published $NEW_VERSION"
