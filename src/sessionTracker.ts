// this typescript code will track events such as:
// workspace opened
// workspace closed
// session duration
// active coding time
// idle time
import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs
import {logTelemetry} from './telemetry';
export function startSessionTracking (context: vscode.ExtensionContext) {
    const sessionStart = Date.now();
    let activeCodingTime = 0; // Time spent actively coding (not idle)
    let idleTime = 0; // Time spent idle (no activity detected)
    let lastActivityTime = Date.now(); // Timestamp of the last detected activity, used to calculate idle time
    let isIdle = false; // Flag to indicate whether the user is currently idle, helps in determining when to start and stop idle time tracking

    const idleThreshold = 2 * 60 * 1000; // 2 minutes

    logTelemetry('sessionStarted', {workspace : vscode.workspace.name}); // Log the start of a new session with a timestamp for analysis

    function registerActivity() { // Function to register user activity, updating active coding time and resetting idle time tracking
        const now = Date.now();
        activeCodingTime += now - lastActivityTime; // Update active coding time by adding the time since the last activity
        lastActivityTime = now;
        if (isIdle) { // If the user was previously idle, log the idle time and reset the idle flag
            logTelemetry('idleTime', {duration: idleTime}); // Log the duration of idle time for analysis
            idleTime = 0; // Reset idle time after logging
            isIdle = false; // Reset idle flag to indicate the user is now active
        } 
    }

    const testListener = vscode.workspace.onDidChangeTextDocument(() => registerActivity()); // Listen for text document changes to detect coding activity
    context.subscriptions.push(testListener); // Ensure the listener is disposed of when the extension is deactivated

    const idleChecker = setInterval(() => { // Set up an interval to check for idle time every minute
        const now = Date.now();
        const idleDuration = now - lastActivityTime; // Calculate the duration of idle time since the last activity
        if (idleDuration >= idleThreshold && !isIdle) { // If the idle duration exceeds the threshold and the user is not already marked as idle
            isIdle = true;
            logTelemetry('userIdle', {idleMinutes: Math.floor(idleDuration / 60000)}); // Log the start of idle time for analysis
        }
    }, 10000); // Check every 10 seconds
    context.subscriptions.push({ dispose: () => clearInterval(idleChecker) }); // Ensure the idle checker interval is cleared when the extension is deactivated

    vscode.workspace.onDidChangeWorkspaceFolders(event => {logTelemetry("workspace_changed", {added: event.added.length, removed: event.removed.length});}); // Listen for workspace changes to log when workspaces are opened or closed

    function endSession() {
        const totalTime = Date.now() - sessionStart; // Calculate the total session duration from the start time to the current time
        sessionStart; // Log the end of the session with total duration, active coding time, and idle time for analysis
        logTelemetry("session_summary", {durationMinutes: Math.floor(totalTime / 60000), activeCodingMinutes: Math.floor(activeCodingTime / 60000), idleMinutes: Math.floor(idleTime / 60000)});
    }

    return{endSession}; // Return the endSession function so it can be called when the extension is deactivated to log the final session summary
}