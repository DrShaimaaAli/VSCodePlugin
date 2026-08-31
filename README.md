# CodexLog — VS Code Activity & Telemetry Extension

CodexLog is a VS Code extension for collecting structured coding activity telemetry in a format inspired by ProgSnap2. The goal is to standardize event logging so that editor behavior can be analyzed more easily, linked to CUPS-style state transitions, and used to generate AI-personalized feedback.

## What has changed

- Telemetry is now modeled as a standardized event stream rather than ad-hoc logging.
- Events follow a ProgSnap2-inspired structure, making them easier to compare, analyze, and export.
- The logging pipeline is designed to be connected to a CUPS state diagram so that behavior can be interpreted as state transitions rather than isolated actions.
- The same telemetry stream will later be used to build prompts for AI-driven, personalized feedback about coding habits, debugging behavior, and AI-assistance usage.
- New post-hoc analysis signals include a regret-window summary for follow-up deletions after AI suggestion acceptance and a scaffold decay-rate checkpoint that tracks how much AI-inserted content persists across subsequent edits.
- Session lifecycle logging is now more robust, with Session.Start and Session.End events tied to persisted session state so they are less likely to produce false session churn when the window is closed, refreshed, or crashes unexpectedly.

## Telemetry format

Each recorded interaction is stored as a structured JSON event with consistent fields such as:

- Event ID and session identifiers
- Event type and subtype
- Client and server timestamps
- Source location and file context
- Code state and programmer state information
- Optional metadata such as edit type, execution result, error reason, or AI-assistance outcome

This makes the logs suitable for:

- standardized analysis across sessions
- comparison of coding behavior over time
- downstream integration with state-based models
- prompt generation for feedback systems

## CUPS state integration

The telemetry stream is intended to be linked to a CUPS-style state diagram that captures higher-level programmer behavior, including:

- writing new code
- editing existing code
- debugging or handling errors
- testing or running code
- idle or pause states
- AI-assisted coding interactions

By tying individual events to these states, the system can describe not just what happened, but also the context in which it happened.

## AI-personalized feedback

The long-term purpose of this telemetry format is to provide the information needed to create prompts for AI-generated feedback. Those prompts can combine:

- recent event history
- state transitions
- error and recovery patterns
- AI suggestion acceptance or rejection behavior
- session-level activity summaries

This allows feedback to be grounded in actual coding behavior rather than generic guidance.

## Requirements

- Node.js 18+ (recommended)
- npm
- Visual Studio Code (for extension development)

## Quick setup

### Run it from GitHub

1. Fork or clone the repository from GitHub:

```bash
git clone <repo-url>
cd VSCodePlugin
```

2. Install the required tools:

- Node.js 18+ 
- npm
- Visual Studio Code

3. Install dependencies:

```bash
npm install
npm install @opentelemetry/sdk-trace-base
```

4. Open the project in VS Code:

```bash
code .
```

5. Start the extension in debug mode:

- Press F5, or
- Open Run and Debug and choose Run Extension within the extension.ts file

This launches a new Extension Development Host window where the plugin is active.

6. In the new window, use the Command Palette to run the available CodexLog commands such as:

- CodexLog: Log Telemetry
- CodexLog: Run and Track Errors
- Open Telemetry Log

7. During development, keep the TypeScript build watching:

```bash
npm run watch
```

If you want to verify that the extension compiles successfully before launching it, run:

```bash
npm run compile
```

## Testing the extension and programming states

Once the Extension Development Host is running, you can exercise the full telemetry flow and verify Programming State transitions with the steps below.

### 1. File save and file close

- Open or create a text file in the development host.
- Type a few changes and save the file.
- This should log a File.Save event and increment the save count shown by the telemetry summary.
- Close the tab or document.
- This should log a File.Close event.

### 2. Error tracker and Debugging state

- Open a file that can produce diagnostics, such as a Python or TypeScript file with an obvious syntax or runtime error.
- Save the file after introducing the error.
- The extension should log:
  - File.Open
  - X-Error.Introduced
  - Compile
  - X-Error.Persisted on later saves if the error remains
- Fix the error and save again.
- The extension should log X-Error.Resolved when the diagnostic disappears and transition out of Debugging.

### 3. Runtime tracker / debug execution

- Open a supported script such as a Python, JavaScript, or TypeScript file.
- Start a normal VS Code debug session for that file.
- The runtime tracker now auto-runs whenever debugging starts, so users no longer need to invoke the CodexLog: Run and Track Errors command manually.
- The tracker is currently wired to the debug-based execution path rather than the plain Run command.
- If the file throws an error, the extension logs a Run.Program event with stack trace details.
- If the runtime is missing, the extension logs a runtime-not-found error and shows a warning message.
- A previous bug caused the runtime tracker to time out when the program hit an input block, such as waiting for user input from stdin. That is no longer the case; interactive execution is handled without treating input waits as a timeout.

### 4. Idle time tracking (Idle state)

- Leave the Extension Development Host window idle for more than 2 minutes.
- Expected Telemetry:
  - Logs an X-Session.Idle.Start event.
  - State Transition: ProgrammerState transitions to Idle.
- Type or move the cursor in the editor.
- Expected Telemetry: Logs X-Session.Idle.End, records StateDurationMs, and returns to the active state.

### 5. AI suggestion acceptance, survival, and revert

Accepting an inline AI completion triggers specific suggestion life-cycle tracking:
- State Shift to VerifyingSuggestion:
  - Triggering an AI completion fires X-AI.Suggestion.Accepted and immediately sets ProgrammerState to VerifyingSuggestion.
- Undo / Revert Tracking:
  - Performing a full Ctrl+Z or deleting the entire inserted block logs X-AI.Suggestion.Reverted (Full).
  - Character-by-character backspacing adjusts line ranges dynamically.
- Debounced Survival Checks & Shift to EditingSuggestion:
  - Modifying AI-generated text triggers a debounced (1.5-second) survival check (X-AI.Suggestion.SurvivalCheck), recording an n-gram Jaccard similarity score.
  - Short strings (<4 characters) automatically use exact normalized string matching.
  - If the survival score drops below 0.5, ProgrammerState shifts from EditingSuggestion to standard EditingCode.
- Inspect timing metrics (e.g., bufferMs) by running CodexLog: Open Verification Buffer Log.

### 6. Scaffold decay rate

- The scaffold decay-rate feature records cumulative AI-inserted characters versus cumulative manually typed characters and emits a checkpoint event on save.
- This is significant because it gives a simple longitudinal view of how much AI-generated scaffold persists over time. A high AI ratio suggests that the user kept or adapted the suggested structure, while a low ratio suggests that the scaffold was quickly overwritten, deleted, or replaced.
- In practice, this metric is most useful as a trend signal across many sessions rather than as a single-event verdict. It helps connect acceptance behavior to later editing behavior and provides a richer view of whether AI assistance actually shaped the final code.

### 7. Session lifecycle and shutdown handling

- The extension now persists session state so that Session.Start and Session.End events are written more reliably across regular shutdown, window refresh, and unexpected crashes.
- This avoids the previous problem of a user leaving VS Code or refreshing the window causing misleading extra session activity or a false session boundary.
- If the extension restarts quickly, it can resume the previous session state instead of treating the event as a brand-new session.

### 8. Session and summary commands

- Use the command CodexLog: Log Telemetry to view a quick summary of total edits and saves.
- Use Open Telemetry Log to view the generated JSON telemetry log directly.
- Use CodexLog: Open Verification Buffer Log to inspect the derived verification-buffer data for post-hoc analysis.

The telemetry output is written to the extension storage area and can be inspected locally for analysis or debugging.

## Development notes

- Source files are located under src/.
- Activity & State Tracking: Implemented in src/activityTracker.ts (captures edits, saves, AI suggestion outcomes, undo behavior, CUPS state transitions, and survival scoring).
- Runtime Execution Tracking: Implemented in src/runtimeTracker.ts for Python, JavaScript, and TypeScript debug sessions.
- Error Tracking: Implemented in src/errorTracking.ts (captures runtime failures, console errors, and editor diagnostics).
- Centralized Telemetry & Schema: Handled in src/telemetry.ts and src/types.ts.
- Session & Copilot Integration: Implemented in src/sessionTracker.ts and src/detectCopilot.ts.
- Extension Registry & Commands: Registered in src/extension.ts.

## Current state

- Activity tracking for edits, saves, AI-suggestion acceptance/reversion, post-AI editing behavior, AI-suggestion survival scoring, and regret-window summaries is operational.
- Structured telemetry events are logged under a ProgSnap2-inspired schema.
- Dynamic CUPS programming state modeling is fully integrated into the event stream.
- Scaffold decay-rate checkpoints are emitted to monitor AI content persistence over time.
- Runtime tracking auto-starts during debugging without input-blocking timeouts.
- Session lifecycle handling persists state to avoid false session boundaries.
- The pipeline is prepared for generating downstream AI-personalized feedback prompts.

## Files of interest

- [CHANGELOG.md](CHANGELOG.md) — high-level release notes and progress.
- `src/activityTracker.ts`
- `src/runtimeTracker.ts`
- `src/errorTracking.ts`
- `src/telemetry.ts`
- `src/types.ts`
- `src/extension.ts`
- `src/detectCopilot.ts`
- `src/sessionTracker.ts`

## Contributing

- Follow the setup steps above.
- Open an issue if you want to discuss schema changes, state-model integration, or feedback-prompt design.
