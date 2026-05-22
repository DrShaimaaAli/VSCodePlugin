// This file contains the main logic for the VSCode extension, including event listeners for tracking user activity and logging telemetry data

import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs
import { logTelemetry } from './telemetry'; // Importing the logTelemetry function to use for logging telemetry events

let totalEdits = 0; // Global variable to track total edits across all documents
let totalSaves = 0; // Global variable to track total saves across all documents

export function startActivityTracking(context: vscode.ExtensionContext) {
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

    return {
        getStats() {
            return {
                totalEdits,
                totalSaves
            };
        }
    };
}