#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI_PKG="$REPO_ROOT/packages/cli"
PROJECTS_FILE="$HOME/.night-watch/projects.json"

cd "$REPO_ROOT"

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

echo "==> Installing globally..."
npm i -g "@jonit-dev/night-watch-cli@$NEW_VERSION"
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
