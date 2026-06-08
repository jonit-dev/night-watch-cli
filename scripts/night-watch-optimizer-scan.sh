#!/usr/bin/env bash
set -euo pipefail

# Lightweight first-pass bottleneck scanner used by the Optimizer job.
# It emits leads only; the provider must inspect and prove any selected target.

PROJECT_DIR="${1:?Usage: $0 /path/to/project [target-scope]}"
TARGET_SCOPE="${2:-}"

cd "${PROJECT_DIR}"

if [ -n "${TARGET_SCOPE}" ] && [ -e "${TARGET_SCOPE}" ]; then
  SCAN_ROOT="${TARGET_SCOPE}"
else
  SCAN_ROOT="."
fi

echo "# Night Watch Optimizer Scan"
echo
echo "Scope: ${TARGET_SCOPE:-repo}"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo

echo "## Large Source Files"
if command -v rg >/dev/null 2>&1; then
  rg --files "${SCAN_ROOT}" \
    -g '!node_modules' \
    -g '!dist' \
    -g '!build' \
    -g '!coverage' \
    -g '!*.min.*' \
    -g '*.{ts,tsx,js,jsx,py,go,rs,java,kt,rb,php,cs,cpp,c,h}' \
    | while IFS= read -r file; do
        [ -f "${file}" ] || continue
        wc -l "${file}"
      done \
    | sort -nr \
    | head -n 25 \
    || true
else
  find "${SCAN_ROOT}" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -path '*/build/*' \
    -exec wc -l {} + \
    | sort -nr \
    | head -n 25 \
    || true
fi
echo

echo "## Complexity Lead Patterns"
if command -v rg >/dev/null 2>&1; then
  rg -n --no-heading \
    -g '!node_modules' \
    -g '!dist' \
    -g '!build' \
    -g '!coverage' \
    -e 'for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(|\.filter\s*\(|\.reduce\s*\(|JSON\.parse|JSON\.stringify|sort\s*\(|find\s*\(|includes\s*\(' \
    "${SCAN_ROOT}" \
    | head -n 200 \
    || true
else
  echo "ripgrep unavailable; skipped pattern scan"
fi
echo

echo "## Existing Benchmark Or Profiling Hooks"
if command -v rg >/dev/null 2>&1; then
  rg -n --no-heading \
    -g '!node_modules' \
    -e 'benchmark|bench|profil|performance|perf_hooks|console\.time|timeit|criterion|pytest-benchmark|vitest bench' \
    "${SCAN_ROOT}" \
    | head -n 100 \
    || true
else
  echo "ripgrep unavailable; skipped benchmark hook scan"
fi
