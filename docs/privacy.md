# Privacy

Night Watch collects anonymous product telemetry to understand CLI usage, improve reliability, and prioritize fixes. Telemetry is enabled by default and is announced with a one-time first-run notice.

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

Telemetry failures are best-effort and must not change CLI command behavior. Tests mock telemetry clients and do not perform real Amplitude calls.

For privacy questions, open an issue in the Night Watch repository or contact the maintainer through the support channels listed in the README.
