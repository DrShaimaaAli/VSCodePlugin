# Changelog

All notable changes to CodexLog are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — Behavioral State Layer

### Added
* **ProgrammerStates Table (`programmerStates.json`):** Tracks segments of session time labeled with CUPS-inspired behavioral states (`WritingNewCode`, `VerifyingSuggestion`, `EditingSuggestion`, `DebuggingTesting`, `Idle`), adapted from Mozannar et al. (*CHI 2024*).
* **`cupsStateTracker.ts`:** Implements a rule-based classifier mapping raw events to behavioral state transitions, featuring `ParentEventID`-style linking between segment boundaries and triggering events.
* **`EventInitiator` Attribute:** Added to every event (`UserDirectAction` / `ToolReaction` / `ToolTimedEvent`) to distinguish direct student actions from tool-driven events (e.g., idle timers, linter runs).
* **ProgSnap2 Schema Attributes:** Integrated `EditType`, `CompileResult`, `ExecutionResult`, and `SourceLocation` fields directly from the ProgSnap2 specification in place of legacy ad-hoc `EventSubtype` values.
* **`X-Workspace.Folders.Changed` Event:** Added missing event type found during migration.
* **Debug Adapter Protocol (DAP) Stack Tracing:** Enables stack-trace error logging directly from the Debug button via VS Code Debug Adapter hooks (supported across Python, Node.js, Java, and C++ extensions). *Note: Only available during active debugging sessions.*
* **Copilot OTel Survival Score:** Integrated survival score metrics into Copilot telemetry to provide signals for runtime persistence and assistant outcomes.
* **Post-Acceptance Regret-Window Summary:** Emits post-hoc analysis signals tracking follow-up deletions occurring within a short window after AI suggestion acceptance.
* **Scaffold Decay-Rate Checkpoint:** Emits cumulative AI-inserted vs. manually typed character ratios on save to provide a longitudinal persistence metric.
* **Verification Buffer Log Command:** Added `CodexLog: Open Verification Buffer Log` to the Command Palette to inspect derived `bufferMs` timing metrics.

### Changed
* **Collapsed Compile Events:** Merged `Compile.Error` and `Compile.Success` into a unified `Compile` event type carrying a `CompileResult` field.
* **Execution Result Field:** Relocated `Run.Program` results out of `EventSubtype` into a dedicated `ExecutionResult` attribute.
* **Throttled File-Edit Logging:** Restricted `File.Edit` telemetry output exclusively to state-transition boundaries, drastically reducing event volume while preserving behavioral classification input.

### Fixed
* **Diagnostic Filter Template String:** Fixed string literal bug in `errorTracking.ts` (`'${relFile}::'` $\rightarrow$ `` `${relFile}::` ``) that silently disabled `X-Error.Persisted` and `X-Error.Resolved` logging.
* **Listener Syntax Error:** Added missing closing brace in `errorTracking.ts` (`closeListener`).
* **Edit Handler Syntax Error:** Removed duplicate closing brace in `activityTracker.ts` edit handler.
* **AI-Suggestion Reversion Window & Range:** Resolved unbounded revert attribution on `X-AI.Suggestion.Reverted`:
  * Added a 60-second time bound (`UNDO_ATTRIBUTION_WINDOW_MS`).
  * Implemented line-range tracking (`lastAiInsertionRange`) so only deletions directly overlapping AI-inserted lines register as reverts.
  * Fixed range-shrink math by changing the formula from lines spanned (`editEndLine - editStartLine + 1`) to lines removed (`editEndLine - editStartLine`), preventing single-line backspaces from collapsing the tracked range prematurely.
* **Git URI File-Close Filter:** Filtered out virtual Git scheme URIs (`git://`) in `onDidCloseTextDocument` listeners to prevent non-workspace file disposals from logging as user `File.Close` events with full Windows paths.
* **Session Lifecycle Persistence:** Persisted session state across window refreshes, unexpected crashes, and close events to eliminate false `Session.Start` and `Session.End` churn.

---

## [0.2.0] — ProgSnap2-Style Schema

### Added
* **CodeStates Table (`codeStates.json`):** Introduced `createCodeState()` to decouple large code snapshots from the primary event stream.
* **Core Event Identifiers:** Added `Order`, `SessionID`, `SubjectID` (hashed/pseudonymous), `ParentEventID`, and `X-InterEventDeltaMs` (pause-time signal) to all telemetry events.
* **Error Lifespan Pairing:** Implemented error introduce/persist/resolve tracking in `errorTracking.ts` to replace flat per-save snapshots with actionable time-to-fix metrics.
* **`EVENT_SCHEMA.md`:** Added complete schema specification and architectural rationale documentation.

### Changed
* **Logger Signature Update:** Refactored `logTelemetry()` signature from `(eventName, data)` to `(type, subtype, data, opts)` to align with ProgSnap2 standard structures.
* **JSON Serialization:** Replaced string-splicing event log writers with structured JSON parse/stringify serialization.

---

## [0.1.1] — Critical Bug Fix

### Fixed
* **Telemetry Self-Logging Loop:** Fixed an infinite loop where opening the log file via `codexlog.openLog` caused log file writes to be detected as user document edits, triggering secondary AI-insertion logging cycles. Resolved by adding `isTelemetryLogDocument()` in `telemetry.ts` to filter log document events.

---

## [0.1.0] — Initial Extension

### Added
* **Session Tracking:** Initial implementation for start/end lifecycle handling, 2-minute idle detection, and workspace folder state tracking.
* **Activity & AI Detection:** Basic tracking for file saves and edits, paired with heuristic AI-suggestion detection ($\ge$3 lines, $\ge$50 chars, pure insertion) and basic undo metrics.
* **Error Tracking:** Diagnostics collection firing per-save error snapshots.
* **Runtime Execution Tracking:** Program execution tracking with stack-trace parsing on script failures.
* **Copilot Detection:** Detects Copilot extension installation and active state.
* **Telemetry Storage:** Initial flat `{event, timestamp, data}` JSON telemetry output.