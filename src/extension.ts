// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { time } from 'console';
import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs

let totalEdits = 0; // Global variable to track total edits across all documents
let totalSaves = 0; // Global variable to track total saves across all documents

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
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

	// Creating a reusable function to log telemetry events
	// standardizing the format of telemetry data for better analysis
	function logTelemetry(eventName: string, data: any) {
		const payload = {
			event: eventName,
			timestamp: new Date().toISOString(),
			data
		};
		console.log('Telemetry Event:', JSON.stringify(payload));
	}

	// Adding event listeners to the extension's subscriptions to ensure they are properly disposed of when the extension is deactivated, 
	// preventing memory leaks and ensuring clean resource management
	context.subscriptions.push(
		// Triggers telemetry logging when a text document is changed, capturing details about the change for analysis
		vscode.workspace.onDidChangeTextDocument((event) => {
			logTelemetry('textDocumentChanged', { // returning the event name and relevant data about the change for analysis
				fileName: event.document.fileName,
				language: event.document.languageId,
				changes: event.contentChanges.length
			});
			totalEdits++;
		})
	);

	context.subscriptions.push(
		// Triggers telemetry logging when a text document is saved, capturing details about the saved document for analysis
		// Used to indicate checkpoint behavour, work cadence, and likely completion milestones
		// can later evaluate edits per save, time between saves, and assignment engagement
		vscode.workspace.onDidSaveTextDocument((document) => {
			logTelemetry('document_saved', {
				fileName: document.fileName,
				language: document.languageId
			});
			totalSaves++;
		})
	);

}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('Extension "codexlog" has been deactivated. Total edits:', totalEdits, 'Total saves:', totalSaves);
}
