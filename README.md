# CodexLog — VS Code Activity & Telemetry Extension

CodexLog is a VS Code extension for collecting structured coding activity telemetry in a format inspired by ProgSnap2. The goal is to standardize event logging so that editor behavior can be analyzed more easily, linked to CUPS-style state transitions, and used to generate AI-personalized feedback.

## What has changed

- Telemetry is now modeled as a standardized event stream rather than ad-hoc logging.
- Events follow a ProgSnap2-inspired structure, making them easier to compare, analyze, and export.
- The logging pipeline is designed to be connected to a CUPS state diagram so that behavior can be interpreted as state transitions rather than isolated actions.
- The same telemetry stream will later be used to build prompts for AI-driven, personalized feedback about coding habits, debugging behavior, and AI-assistance usage.

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

## Testing the extension

Once the Extension Development Host is running, you can exercise the full telemetry flow with the steps below.

### 1. File save and file close

- Open or create a text file in the development host.
- Type a few changes and save the file.
- This should log a File.Save event and increment the save count shown by the telemetry summary.
- Close the tab or document.
- This should log a File.Close event.

### 2. Error tracker

- Open a file that can produce diagnostics, such as a Python or TypeScript file with an obvious syntax or runtime error.
- Save the file after introducing the error.
- The extension should log:
  - File.Open
  - X-Error.Introduced
  - Compile
  - X-Error.Persisted on later saves if the error remains
- Fix the error and save again.
- The extension should log X-Error.Resolved when the diagnostic disappears.

### 3. Runtime tracker / debug execution

- Open a supported script such as a Python, JavaScript, or TypeScript file.
- Start a normal VS Code debug session for that file.
- The runtime tracker now auto-runs whenever debugging starts, so users no longer need to invoke the CodexLog: Run and Track Errors command manually.
- The tracker is currently wired to the debug-based execution path rather than the plain Run command.
- If the file throws an error, the extension logs a Run.Program event with stack trace details.
- If the runtime is missing, the extension logs a runtime-not-found error and shows a warning message.
- A previous bug caused the runtime tracker to time out when the program hit an input block, such as waiting for user input from stdin. That is no longer the case; interactive execution is handled without treating input waits as a timeout.

### 4. Idle time tracking

- Leave the Extension Development Host window idle for more than 2 minutes.
- The session tracker should log an X-Session.Idle.Start event once the idle threshold is reached.
- Resume activity by typing or editing again.
- The tracker should then log X-Session.Idle.End and resume normal session tracking.

### 5. AI suggestion acceptance, survival, and revert

- In an editor, insert a large block of text as a single insertion (for example, 3 or more lines and 50+ characters).
- This should be treated as a likely AI suggestion and logged as X-AI.Suggestion.Accepted.
- Wait about 30 seconds after the accepted suggestion without further edits.
- The extension should log X-AI.Suggestion.Idle.
- Immediately after the acceptance, use Undo on the inserted block.
- If the undo targets the suggestion range, the extension should log X-AI.Suggestion.Reverted as either Full or Partial.
- To test the new survival metric, make a follow-up edit that touches the inserted block after the acceptance event:
  - keep most of the text intact for a high survival score
  - replace part of the block with different text for a lower score
  - delete most of the block for a very low score
- The extension should then log X-AI.Suggestion.SurvivalCheck with a survivalScore value in the event payload.
- Future implementation may include to log the event only when the Ai suggestion idle timer is reached

### 6. Session and summary commands

- Use the command CodexLog: Log Telemetry to view a quick summary of total edits and saves.
- Use Open Telemetry Log to view the generated JSON telemetry log directly.

The telemetry output is written to the extension storage area and can be inspected locally for analysis or debugging.

## Development notes

- Source is under `src/`.
- Activity tracking is implemented in `src/activityTracker.ts` and captures edits, saves, AI suggestion outcomes, undo behavior, active editing state, and AI-suggestion survival scoring.
- Runtime execution tracking is implemented in `src/runtimeTracker.ts` for supported Python, JavaScript, and TypeScript files and now auto-triggers during debug sessions.
- Error tracking is implemented in `src/errorTracking.ts` and captures runtime failures, console errors, and diagnostics.
- Telemetry logging is centralized in `src/telemetry.ts`, and the shared schema lives in `src/types.ts`.
- Events are persisted as JSON for local storage and later analysis.
- Session tracking and Copilot detection are wired in through `src/sessionTracker.ts` and `src/detectCopilot.ts`.
- The extension also registers a telemetry summary command in `src/extension.ts` for quick inspection.

## Current state

- Activity tracking for edits, saves, AI-suggestion acceptance/reversion, post-AI editing behavior, and AI-suggestion survival scoring is in place.
- Structured telemetry events are being logged in a ProgSnap2-inspired schema.
- Runtime tracking now auto-starts during debugging and no longer times out on input-blocking programs.
- The event format is being prepared for integration with CUPS-style state modeling.
- The logging pipeline is being positioned as the foundation for AI-generated personalized feedback prompts.

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
