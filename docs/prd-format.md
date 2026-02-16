# PRD Format

Night Watch looks for PRD files in `docs/PRDs/night-watch/` (configurable via `prdDir`). PRDs are markdown files with optional dependency declarations.

---

## Basic PRD

```markdown
# Feature: User Authentication

## Overview
Implement user authentication using JWT tokens.

## Requirements
- [ ] Login endpoint
- [ ] Logout endpoint
- [ ] Token refresh
- [ ] Password hashing

## Acceptance Criteria
- Users can log in with email/password
- Tokens expire after 24 hours
- All endpoints have proper error handling
```

---

## PRD with Dependencies

```markdown
# Feature: User Profile

Depends on: Feature: User Authentication

## Overview
Add user profile management.

## Requirements
- [ ] Profile page
- [ ] Edit profile
- [ ] Avatar upload
```

When a PRD specifies `Depends on:`, Night Watch will only process it after the dependency's PRD file has been moved to `done/`.

---

## PRD Lifecycle

1. **Create** — Add a `.md` file to `docs/PRDs/night-watch/`
2. **Execute** — Night Watch picks it up, creates a branch, and launches the provider CLI
3. **PR opened** — The provider CLI implements the PRD and opens a pull request
4. **Done** — The PRD file is moved to `docs/PRDs/night-watch/done/`

PRDs are skipped if:
- They have unmet dependencies (the depended-on PRD is not yet in `done/`)
- An open PR already exists for the PRD
- A lock file indicates another execution is in progress
