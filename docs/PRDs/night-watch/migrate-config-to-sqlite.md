# PRD: Migrate Configuration Storage from JSON to SQLite (mysqli equivalent)

## Objective

Migrate the storage of application configuration (`INightWatchConfig` and other project/workspace settings) from raw JSON files (`night-watch.config.json`) into the SQLite database architecture newly introduced.

## Motivation

Currently, application configurations, credentials, and settings are stored locally in the workspace directly within `night-watch.config.json`.

- **Security**: Sensitive credentials like API keys (Anthropic, Slack Bot tokens) are being written directly into a raw text file in the workspace directory.
- **Robustness**: Updating a JSON file safely under concurrency might lead to corruption or require careful locking mechanisms. Database transactions safely handle this scenario natively.
- **Scaling**: As our configuration schema expands to include things like Slack channels, various app integrations, and multi-tenancy rules, structured querying is strictly better than nested JSON handling.

## Proposed Solution

1. Introduce a `key_value_store` or `configurations` table in our `sqlite` schema.
2. Build a repository to handle CRUD operations on configurations.
3. Decrypt/encrypt sensitive configuration values upon retrieval/storage.
4. Support project-level vs global-level configuration resolution based on current usage.

## Implementation Steps

1. Create a migration to initialize `app_configurations` table in SQLite schema.
2. Update the `useStore.ts` endpoints or Node.js server to use the database instead of `night-watch.config.json` when `GET /api/config` or `POST /api/config` is requested.
3. Move sensitive tokens out of plain text fields into encrypted text using an application secret.
4. Ensure backward compatibility by providing a one-time migrator from `night-watch.config.json` into SQLite if the JSON config exists but the database rows do not.
