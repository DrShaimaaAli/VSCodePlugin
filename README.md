# CodexLog — VS Code Activity & Telemetry Extension

Small extension that tracks editor activity (edits, saves, sessions) and logs telemetry for development and analytics.

## Requirements

- Node.js 18+ (recommended)
- npm
- Visual Studio Code (for extension development)

## Quick setup

1. Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd VSCodePlugin
npm install
```

2. Open the project in VS Code and run the extension host (F5):

```bash
code .
```

3. Use the live-watch build during development:

```bash
npm run watch
```

## Development notes

- Source is under `src/`.
- Activity tracking implemented in `src/activityTracker.ts` (tracks edits and saves).
- Telemetry helper is in `src/telemetry.ts` and `src/types.ts` holds `TelemetryEvent`.
- Commands registered in `src/extension.ts` include `codexlog.logTelemetry` which shows a console summary.
- Copilot detection is implemented in `src/detectCopilot.ts` and session tracking is started via `src/sessionTracker.ts`.

## Current state (Unreleased)

- Implemented activity tracking for text document edits and saves.
- Added telemetry logging helper and shared telemetry type.
- Registered a telemetry summary command for quick inspection.
- Session tracking startup and GitHub Copilot detection are wired in.
- Telemetry currently logs to the VS Code console (`console.log`) for development.

## Next steps (planned)

1. Transport: send telemetry to a backend analytics server for dashboarding.
   - Use secure HTTPS endpoints, API key or token authentication, and respect user privacy.
   - Implement batching, backoff/retry, and local buffering to prevent data loss.

2. Payload & dashboard: define backend-friendly event schemas and key metrics (edits/day, saves/day, active session length).

3. Privacy & consent: add an opt-in flow before sending production telemetry; document data collected and retention.

4. Tests & CI: add unit tests for telemetry formatting and integration tests for transport logic.

## How to implement the telemetry backend (short guide)

- Endpoint: POST /telemetry with JSON payloads over TLS.
- Authentication: use an API key or token stored in environment or VS Code secret storage.
- Reliability: batch events (e.g. 50 or 5s), retry with exponential backoff, and persist unsent events to disk.
- Security & privacy: hash or omit personally-identifying fields; expose a setting to opt out and to clear stored telemetry.

## Files of interest

- [CHANGELOG.md](CHANGELOG.md) — high-level release notes and progress.
- `src/README` — quick local setup for contributing to the extension.
- `src/activityTracker.ts`, `src/telemetry.ts`, `src/extension.ts`, `src/detectCopilot.ts`, `src/sessionTracker.ts`

## Contributing

- Follow the repo setup steps above.
- Open an issue for design decisions or telemetry schema changes.

---
This README was updated to reflect current development progress and next steps for adding backend telemetry and dashboarding.
