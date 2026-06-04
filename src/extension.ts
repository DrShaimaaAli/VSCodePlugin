// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs
import { startActivityTracking } from './activityTracker';
import {isCopilotActive} from './detectCopilot';
import {startSessionTracking} from './sessionTracker';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

let activeSession: any; // Variable to hold the active session tracking instance, allowing it to be accessed and ended when the extension is deactivated

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codexlog" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('codexlog.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello VS Code!');
	});
	context.subscriptions.push(disposable); // This ensures that the command is disposed of when the extension is deactivated

	const tracker = startActivityTracking(context); // Start tracking user activity and logging telemetry data, passing the extension context for proper resource management
	activeSession = startSessionTracking(context); // Start tracking the user's session, including workspace activity and idle time, passing the extension context for proper resource management

	// Registering a new command to log telemetry data, allowing users to view a summary of their editing activity
	const summaryCommand = vscode.commands.registerCommand('codexlog.logTelemetry', () => {
		const stats = tracker.getStats(); // receive the current stats from the activity tracker, which includes total edits and saves
		vscode.window.showInformationMessage(`Total Edits: ${stats.totalEdits}, Total Saves: ${stats.totalSaves}`); // Display the telemetry summary to the user in an information message box
	});
	context.subscriptions.push(summaryCommand); // This ensures that the command is disposed of when the extension is deactivated

	// detecting if GitHub Copilot is active in the user's VSCode environment, allowing the extension to adjust its behavior accordingly
	const copilotStatus = isCopilotActive();
	console.log('GitHub Copilot Status:', copilotStatus);
}

// This method is called when your extension is deactivated
export function deactivate() {
	activeSession?.endSession(); // Call the endSession function to log the final session summary when the extension is deactivated
}
