# Privacy

Night Watch collects anonymous product telemetry to understand CLI and web UI usage, improve reliability, and prioritize fixes. Telemetry is enabled by default and is announced with a one-time first-run notice.

You can disable telemetry anytime:

```bash
night-watch telemetry disable
NW_TELEMETRY_DISABLED=1 night-watch run
DO_NOT_TRACK=1 night-watch run
```

Re-enable local telemetry with:

```bash
night-watch telemetry enable
```

Environment opt-outs always override local enabled state.

## Local State

Telemetry state is stored at `~/.night-watch/telemetry.json`, or at `$NIGHT_WATCH_HOME/telemetry.json` when `NIGHT_WATCH_HOME` is set. The file contains an anonymous install ID, enabled/disabled state, timestamps, and whether the notice has been shown.

## Events

Allowed event names:

- `cli_first_run`
- `cli_init_completed`
- `command_started`
- `command_completed`
- `job_started`
- `job_completed`
- `job_failed`
- `pr_opened`
- `review_completed`
- `auto_merge_completed`
- `doctor_failed`
- `telemetry_enabled`
- `telemetry_disabled`
- `web_app_opened`
- `web_route_viewed`
- `web_ui_action`
- `web_api_action`

Allowed properties:

- `cliVersion`
- `command`
- `jobType`
- `provider`
- `success`
- `failure`
- `durationMs`
- `exitCode`
- `platform`
- `nodeMajorVersion`
- `boardMode`
- `registeredProjectCount`
- `errorCategory`
- `routeName`
- `uiArea`
- `action`
- `resource`
- `result`
- `statusCategory`
- `enabled`
- `globalMode`
- `projectCount`
- `selectedProjectIndex`
- `itemCount`
- `columnCount`
- `pendingCount`
- `runningCount`

Web UI telemetry uses safe route names such as `dashboard`, `settings`, `board`, `logs`, and `scheduling`. It records meaningful product actions such as app open, safe page view, dashboard/feedback/log refresh, project selection by index/count, job trigger/cancel, schedule pause/resume, settings save, queue clear/view, and board create/move/close outcomes. Browser events are sent to the local Night Watch server at `/api/telemetry/web`; the server forwards them through the same telemetry reporter and local opt-out config used by the CLI.

Never collected:

- repo names
- project paths
- git remotes
- branch names
- issue or PR titles, bodies, URLs, or numbers
- prompts
- provider output
- diffs
- file paths
- usernames or emails
- hostnames
- environment variables
- tokens or secrets
- raw stack traces

## Amplitude

Night Watch sends telemetry through Amplitude HTTP ingestion using a public project API key for `nightwatchcli.com`. This key is intentionally public for write-only ingestion and is not an Amplitude Secret Key. You can override it for development with `NW_AMPLITUDE_API_KEY`.

Telemetry failures are best-effort and must not change CLI command, web UI, or API behavior. Tests mock telemetry clients and do not perform real Amplitude calls.

For privacy questions, open an issue in the Night Watch repository or contact the maintainer through the support channels listed in the README.
