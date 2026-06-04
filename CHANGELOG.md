# Change Log

All notable changes to the "codexlog" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Implemented activity tracking for text document edits and saves via `src/activityTracker.ts`
- Added telemetry logging helper in `src/telemetry.ts` and shared `TelemetryEvent` type in `src/types.ts`
- Registered a telemetry summary command `codexlog.logTelemetry` in `src/extension.ts`
- Added session tracking startup and GitHub Copilot detection using `src/sessionTracker.ts` and `src/detectCopilot.ts`
- Current telemetry output is logged to the VS Code console for development/inspection

### Next steps

- Send current telemetry logs to a backend analytics server for dashboard reporting
- Add secure event transport, batching, and retry logic to avoid data loss
- Define backend-friendly telemetry payloads and dashboard metrics
- Add privacy controls and consent handling before production data collection