#!/usr/bin/env bats

# Tests for night-watch-helpers.sh claim functions

setup() {
  # Source the helpers
  SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"

  # Set required globals
  export LOG_FILE="/tmp/night-watch-test-$$.log"

  source "${SCRIPT_DIR}/night-watch-helpers.sh"

  # Create temp PRD directory
  TEST_PRD_DIR=$(mktemp -d)
  echo "# Test PRD" > "${TEST_PRD_DIR}/01-test-prd.md"
  echo "# Test PRD 2" > "${TEST_PRD_DIR}/02-test-prd.md"
}

teardown() {
  rm -rf "${TEST_PRD_DIR}"
  rm -f "${LOG_FILE}"
}

@test "claim_prd creates .claim file with JSON" {
  claim_prd "${TEST_PRD_DIR}" "01-test-prd.md"

  [ -f "${TEST_PRD_DIR}/01-test-prd.md.claim" ]

  local content
  content=$(cat "${TEST_PRD_DIR}/01-test-prd.md.claim")

  # Check JSON contains expected fields
  echo "${content}" | grep -q '"timestamp":'
  echo "${content}" | grep -q '"hostname":'
  echo "${content}" | grep -q '"pid":'
}

@test "is_claimed returns 0 for active claim" {
  claim_prd "${TEST_PRD_DIR}" "01-test-prd.md"

  run is_claimed "${TEST_PRD_DIR}" "01-test-prd.md" 7200
  [ "$status" -eq 0 ]
}

@test "is_claimed returns 1 for stale claim" {
  # Write a claim with an old timestamp (1 second)
  printf '{"timestamp":1000000000,"hostname":"test","pid":1}\n' \
    > "${TEST_PRD_DIR}/01-test-prd.md.claim"

  run is_claimed "${TEST_PRD_DIR}" "01-test-prd.md" 7200
  [ "$status" -eq 1 ]
}

@test "is_claimed returns 1 for no claim" {
  run is_claimed "${TEST_PRD_DIR}" "01-test-prd.md" 7200
  [ "$status" -eq 1 ]
}

@test "release_claim removes .claim file" {
  claim_prd "${TEST_PRD_DIR}" "01-test-prd.md"
  [ -f "${TEST_PRD_DIR}/01-test-prd.md.claim" ]

  release_claim "${TEST_PRD_DIR}" "01-test-prd.md"
  [ ! -f "${TEST_PRD_DIR}/01-test-prd.md.claim" ]
}

@test "find_eligible_prd skips claimed PRD" {
  # Claim the first PRD
  claim_prd "${TEST_PRD_DIR}" "01-test-prd.md"

  # find_eligible_prd should skip 01 and return 02
  local result
  result=$(find_eligible_prd "${TEST_PRD_DIR}" 7200)

  [ "${result}" = "02-test-prd.md" ]
}
