// this typescript code will track events such as:
// workspace opened
// workspace closed
// session duration
// active coding time
// idle time
import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs
import {logTelemetry, isTelemetryLogDocument} from './telemetry';
// import * as cups from './cupsStateTracker';

export function startSessionTracking (context: vscode.ExtensionContext) {
    const sessionStart = Date.now();
    let activeCodingTime = 0; // Time spent actively coding (not idle)
    let idleTime = 0; // Time spent idle (no activity detected)
    let lastActivityTime = Date.now(); // Timestamp of the last detected activity, used to calculate idle time
    let isIdle = false; // Flag to indicate whether the user is currently idle, helps in determining when to start and stop idle time tracking
    let idleStartEventId: string | null = null; // EventID for the start of the idle period, used to log when the user becomes idle

    const idleThreshold = 2 * 60 * 1000; // 2 minutes

    logTelemetry('Session.Start', null, {workspace : vscode.workspace.name}); // Log the start of a new session with a timestamp for analysis

    function registerActivity() { // Function to register user activity, updating active coding time and resetting idle time tracking
        const now = Date.now();
        activeCodingTime += now - lastActivityTime; // Update active coding time by adding the time since the last activity
        lastActivityTime = now;
        if (isIdle) { // If the user was previously idle, log the idle time and reset the idle flag
            logTelemetry('X-Session.Idle.End', null,{duration: idleTime},
                {
                    parentEventId:idleStartEventId ?? undefined,
                    initiator: 'ToolTimedEvent'
                }
            );
            idleTime = 0;
            isIdle = false;
            idleStartEventId = null;
        } 
    }

    const testListener = vscode.workspace.onDidChangeTextDocument((event) => {
        if (isTelemetryLogDocument(event.document.uri)) {
            return; // Ignore changes to the telemetry log file itself — otherwise, if the user has opened it via codexlog.openLog, every appended log entry shows up as an external file change, gets misread as a large AI-style insertion, and gets logged as another event, which triggers another change, forever.
        }
        registerActivity();
    });
    context.subscriptions.push(testListener); // Ensure the listener is disposed of when the extension is deactivated

    const idleChecker = setInterval(() => { // Set up an interval to check for idle time
        const now = Date.now();
        const idleDuration = now - lastActivityTime; // Calculate the duration of idle time since the last activity
        if (idleDuration >= idleThreshold && !isIdle) { // If the idle duration exceeds the threshold and the user is not already marked as idle
            isIdle = true;
            const event = logTelemetry('X-Session.Idle.Start', null, {idleMinutes: Math.floor(idleDuration / 60000)}, {initiator: 'ToolTimedEvent'}); // Log the start of idle time for analysis
            idleStartEventId = event.EventID;
            // cups.onIdleStart(event.EventID, event.ClientTimestamp); // Notify the CUPS state tracker that the user has become idle, allowing it to update its state accordingly
        }
    }, 10000); // Check every 10 seconds
    context.subscriptions.push({ dispose: () => clearInterval(idleChecker) }); // Ensure the idle checker interval is cleared when the extension is deactivated

    const folderListener = vscode.workspace.onDidChangeWorkspaceFolders(event => {
        logTelemetry("X-Workspace.Folders.Changed", null, {added: event.added.length, removed: event.removed.length});});
    context.subscriptions.push(folderListener); // Listen for changes in workspace folders to log when workspaces are added or removed

    function endSession() {
        // cups.closeCurrentState();
        const totalTime = Date.now() - sessionStart; // Calculate the total session duration from the start time to the current time
        logTelemetry("Session.End", null, {durationMinutes: Math.floor(totalTime / 60000), activeCodingMinutes: Math.floor(activeCodingTime / 60000), idleMinutes: Math.floor((totalTime - activeCodingTime) / 60000)});
    }

    return{endSession}; // Return the endSession function to be called when the extension is deactivated, allowing it to log the final session summary
}