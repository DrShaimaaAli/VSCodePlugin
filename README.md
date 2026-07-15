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

Once the Extension Development Host is running, you can generate sample telemetry by:

1. Opening or editing a file in the development host.
2. Saving the file to trigger a save event.
3. Running or compiling a supported script to trigger execution-related telemetry.
4. Using the Command Palette to run the telemetry-related commands.

To inspect the recorded data, use:

- Open Telemetry Log to view the generated log file.
- CodexLog: Log Telemetry to see a quick summary in the UI.

The telemetry output is written to the extension storage area and can be used for local inspection or later analysis.

## Development notes

- Source is under `src/`.
- Activity tracking is implemented in `src/activityTracker.ts` and captures edits, saves, AI suggestion outcomes, undo behavior, and active editing state.
- Runtime execution tracking is implemented in `src/runtimeTracker.ts` for supported Python, JavaScript, and TypeScript files.
- Error tracking is implemented in `src/errorTracking.ts` and captures runtime failures, console errors, and diagnostics.
- Telemetry logging is centralized in `src/telemetry.ts`, and the shared schema lives in `src/types.ts`.
- Events are persisted as JSON for local storage and later analysis.
- Session tracking and Copilot detection are wired in through `src/sessionTracker.ts` and `src/detectCopilot.ts`.
- The extension also registers a telemetry summary command in `src/extension.ts` for quick inspection.

## Current state

- Activity tracking for edits, saves, AI-suggestion acceptance/reversion, and post-AI editing behavior is in place.
- Structured telemetry events are being logged in a ProgSnap2-inspired schema.
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
