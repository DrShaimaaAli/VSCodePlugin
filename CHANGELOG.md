# Change Log

All notable changes to the "codexlog" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Implemented activity tracking for text document edits and saves in `src/activityTracker.ts`, including likely AI suggestion acceptances, undo tracking after AI insertions, and post-AI active editing/resume state
- Added runtime execution tracking in `src/runtimeTracker.ts` to run supported files and log runtime errors with stack traces
- Added telemetry logging helper in `src/telemetry.ts` and shared `TelemetryEvent` type in `src/types.ts`
- Added error tracking in `src/errorTracking.ts` to capture runtime errors and stack traces from the extension environment
- Registered a telemetry summary command `codexlog.logTelemetry` in `src/extension.ts`
- Added session tracking startup and GitHub Copilot detection using `src/sessionTracker.ts` and `src/detectCopilot.ts`
- Current telemetry output is logged to the VS Code console for development/inspection

### Next steps

- Send current telemetry logs to a backend analytics server for dashboard reporting
- Add secure event transport, batching, and retry logic to avoid data loss
- Define backend-friendly telemetry payloads and dashboard metrics
- Add privacy controls and consent handling before production data collection