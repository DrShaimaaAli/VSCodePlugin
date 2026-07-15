# Changelog

All notable changes to CodexLog are documented here.
Format loosely follows Keep a Changelog.

## [Unreleased] — behavioral state layer

### Added


ProgrammerStates table (programmerStates.json) — segments of session
time labeled with a CUPS-inspired behavioral state (WritingNewCode,
VerifyingSuggestion, EditingSuggestion, DebuggingTesting, Idle),
adapted from Mozannar et al., Reading Between the Lines: Modeling User
Behavior and Costs in AI-Assisted Programming (CHI 2024)
cupsStateTracker.ts — a rule-based classifier mapping raw events to
behavioral state transitions, with ParentEventID-style linking between
segment boundaries and the real events that triggered them
EventInitiator field on every event (UserDirectAction /
ToolReaction / ToolTimedEvent), distinguishing direct student actions
from tool-driven events (idle timers, linter runs)
EditType, CompileResult, ExecutionResult, and SourceLocation
fields, adopted directly from the ProgSnap2 spec in place of earlier
ad hoc EventSubtype values
X-Workspace.Folders.Changed event type (found missing during migration)


### Changed


Compile.Error / Compile.Success collapsed into a single Compile
event type with a CompileResult field
Run.Program's result moved from EventSubtype into a dedicated
ExecutionResult field
File.Edit logging throttled to state-transition boundaries only,
instead of never being logged at all — bounds event volume while still
feeding the behavioral classifier


### Fixed


File-scoping filter in errorTracking.ts used a plain string
('${relFile}::') instead of a template literal, silently disabling all
X-Error.Persisted / X-Error.Resolved logging with no compile error
closeListener in errorTracking.ts was missing its closing brace,
breaking compilation
Extra closing brace in activityTracker.ts's edit handler, introduced
while commenting out CUPS integration calls, broke compilation
X-AI.Suggestion.Reverted had no time limit on how long a deletion could
be attributed to an earlier AI-suggestion acceptance — found via real
session data showing undoCount: 24 with removedChars: 2, meaning
ordinary backspaces made minutes later, unrelated to the original
suggestion, were being logged as reverting it. Fixed in two layers:
a 60-second outer time bound (UNDO_ATTRIBUTION_WINDOW_MS) on how long
tracking continues at all, and — more precisely — line-range tracking
(lastAiInsertionRange) so only deletions that actually overlap the
AI-inserted lines count as reverting it, with the range shifted correctly
as other edits add/remove lines around it
The line-range tracking above had its own bug on introduction: the
partial-revert shrink formula used the "lines spanned" convention
(editEndLine - editStartLine + 1) instead of "lines actually removed"
(editEndLine - editStartLine), so every same-line backspace — even a
1-2 character one — incorrectly chopped a full line off the tracked
range. Verified this collapsed a 5-line range to nothing after ~5
ordinary backspaces; fixed by dropping the + 1.


## [0.2.0] — ProgSnap2-style schema

### Added


CodeStates table (codeStates.json) and createCodeState(), separating
bulky code snapshots from the lean event stream (not yet called by any
tracker)
Order, SessionID, SubjectID (hashed, pseudonymous), ParentEventID,
and X-InterEventDeltaMs (pause-time signal) fields on every event
Error introduce/persist/resolve pairing in errorTracking.ts — replaces
the old flat per-save error-count snapshot with real time-to-fix data
EVENT_SCHEMA.md — full schema specification and design rationale


### Changed


logTelemetry() signature changed from (eventName, data) to
(type, subtype, data, opts), matching the new structured schema
Event log storage rewritten from manual string-splicing to proper
JSON parse/stringify (simpler, less fragile, though more expensive per
write — acceptable at current event volume)


## [0.1.1] — critical bug fix

### Fixed


Infinite self-logging loop: opening the telemetry log via
codexlog.openLog caused every subsequent log write to be picked up by
VS Code as an external file change, which the AI-suggestion heuristic
misclassified as a large insertion, which got logged, which triggered
another change — repeating indefinitely. Fixed by adding
isTelemetryLogDocument() in telemetry.ts as a single source of truth,
checked by every document-event listener before processing.


## [0.1.0] — initial extension

### Added


Session tracking: start/end, idle detection, workspace folder changes
Activity tracking: edit/save counts, heuristic AI-suggestion detection
(≥3 lines, ≥50 chars, pure insertion) with undo/revert tracking
Error tracking: per-save diagnostics snapshot
Runtime tracking: run a file, parse stack traces on failure
Copilot install/active status detection
Flat {event, timestamp, data} telemetry log format