// This file contains the main logic for the VSCode extension, including event listeners for tracking user activity and logging telemetry data

import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs
import { logTelemetry } from './telemetry'; // Importing the logTelemetry function to use for logging telemetry events

let totalEdits = 0; // Global variable to track total edits across all documents
let totalSaves = 0; // Global variable to track total saves across all documents

const AI_MIN_LINES = 3;
const AI_MIN_CHARS = 50; 
const POST_AI_IDLE_THRESHOLD = 30 * 1000; // 30 seconds

export function startActivityTracking(context: vscode.ExtensionContext) {
    let postAIIdleTimer: NodeJS.Timeout | null = null; // Timer to track idle time after AI-generated code is detected
	let undoCountSinceAI = 0; // Counter to track the number of undo actions since AI-generated code was detected
	let lastAIInsertionCharCount = 0; // Variable to track the character count of the last AI-generated code insertion
	let trackingUndos = false; // Flag to indicate whether we are currently tracking undo actions after AI-generated code is detected
	
	// Adding event listeners to the extension's subscriptions to ensure they are properly disposed of when the extension is deactivated, 
	// preventing memory leaks and ensuring clean resource management
	context.subscriptions.push(
		// Triggers telemetry logging when a text document is changed, capturing details about the change for analysis
		vscode.workspace.onDidChangeTextDocument((event) => {
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
				language: document.languageId,
				editsSinceLastSave: totalEdits, // Log the number of edits since the last save to analyze editing patterns and work cadence
			});
			totalEdits = 0; // Reset the edit count after logging to start tracking edits for the next save
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