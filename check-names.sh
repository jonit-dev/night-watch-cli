#!/usr/bin/env bash
# Check domain and npm availability for candidate project names

NAMES=(
  # Metaphor / evocative
  "sentinelcli"
  "reposentinel"
  "nightcrew"
  "shipcrew"
  "watchtower"
  "duskwork"
  "nightforge"
  "crewshift"
  "autohelm"
  "prdrunner"
  # Descriptive / technical
  "specpilot"
  "cronpilot"
  "repopilot"
  "shipcron"
  "asyncship"
  "specqueue"
  "prdfactory"
  "worktreeops"
  "repocrew"
  "codecrew"
  # Short / punchy
  "shipyard"
  "forgeai"
  "draftpr"
  "autoprd"
  "mergebot"
  "prqueue"
  "specdrive"
  "crewrun"
  "deckhand"
  "helmsman"
)

DOMAINS=("com" "dev" "io")

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

printf "\n${BOLD}%-18s | %-12s %-12s %-12s | %-10s${RESET}\n" "NAME" ".com" ".dev" ".io" "npm"
printf -- "-------------------+-----------------------------------------+-----------\n"

for name in "${NAMES[@]}"; do
  # Check domains
  domain_results=""
  for tld in "${DOMAINS[@]}"; do
    domain="${name}.${tld}"
    # Use dig to check if domain resolves (NXDOMAIN = likely available)
    result=$(dig +short "$domain" A 2>/dev/null)
    ns_result=$(dig +short "$domain" NS 2>/dev/null)

    if [ -z "$result" ] && [ -z "$ns_result" ]; then
      # Double-check with SOA record (some parked domains only have SOA)
      soa_result=$(dig +short "$domain" SOA 2>/dev/null)
      if [ -z "$soa_result" ]; then
        domain_results+=$(printf " ${GREEN}%-12s${RESET}" "AVAILABLE")
      else
        domain_results+=$(printf " ${YELLOW}%-12s${RESET}" "MAYBE")
      fi
    else
      domain_results+=$(printf " ${RED}%-12s${RESET}" "TAKEN")
    fi
  done

  # Check npm registry
  npm_status=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/${name}" 2>/dev/null)
  if [ "$npm_status" = "404" ]; then
    npm_result=$(printf "${GREEN}%-10s${RESET}" "AVAILABLE")
  else
    npm_result=$(printf "${RED}%-10s${RESET}" "TAKEN")
  fi

  printf "${CYAN}%-18s${RESET} |%s | %s\n" "$name" "$domain_results" "$npm_result"
done

printf "\n${BOLD}Legend:${RESET} ${GREEN}AVAILABLE${RESET} = likely free  ${RED}TAKEN${RESET} = registered  ${YELLOW}MAYBE${RESET} = unclear (check registrar)\n"
printf "${BOLD}Note:${RESET} DNS checks are approximate. Verify at a registrar before purchasing.\n\n"
