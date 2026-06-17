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
			for (const change of event.contentChanges) {
				const insertedText = change.text;
				const lineCount = insertedText.split('\n').length;
				const charCount = insertedText.length;

				const isLikelyAISuggestion = lineCount >= AI_MIN_LINES && charCount >= AI_MIN_CHARS && change.rangeLength === 0; // Heuristic to identify potential AI-generated code based on the number of lines and characters inserted, and ensuring it's an insertion (not a replacement)
				if (isLikelyAISuggestion) {
					// Log acceptance
					logTelemetry('aiSuggestionAccepted', {
						fileName: event.document.fileName,
						language: event.document.languageId,
						insertedLines: lineCount,
						insertedChars: charCount,
					});

					if (postAIIdleTimer) clearTimeout(postAIIdleTimer); // Clear any existing idle timer to reset the countdown for logging idle time after AI-generated code is detected
					postAIIdleTimer = setTimeout(() => {
						logTelemetry('postAISuggestionIdle', {
							fileName: event.document.fileName,
							idleSeconds: POST_AI_IDLE_THRESHOLD / 1000,
						});
						postAIIdleTimer = null; // Reset the timer variable after logging idle time
					}, POST_AI_IDLE_THRESHOLD);

					// Reset undo tracking
                    undoCountSinceAI = 0;
                    lastAIInsertionCharCount = charCount;
                    trackingUndos = true;
				}
				else {
					if(postAIIdleTimer) {
						clearTimeout(postAIIdleTimer); // Clear the idle timer if the user makes another edit before the idle threshold is reached, indicating they are actively working and not idle	
						postAIIdleTimer = null;
						logTelemetry('postAIResumedEditing', {
							fileName: event.document.fileName,
						});
					}

					if(trackingUndos){
						const isUndo = change.text === '' && change.rangeLength > 0; // Heuristic to identify undo actions based on the change being a deletion (empty text with a range length greater than 0)
						if(isUndo){
							undoCountSinceAI++;
							logTelemetry('undoAfterAISuggestion', {
								fileName: event.document.fileName,
								undoCount: undoCountSinceAI,
								removedChars: change.rangeLength,
							});
							if (change.rangeLength >= lastAIInsertionCharCount) {
                                logTelemetry('aiSuggestionFullyReverted', {
                                    fileName: event.document.fileName,
                                    totalUndos: undoCountSinceAI,
                                });
                                trackingUndos = false;
                                undoCountSinceAI = 0;
                            }
						}
					}
				}
			}
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

	context.subscriptions.push({
		dispose: () => {
			if (postAIIdleTimer) clearTimeout(postAIIdleTimer); // Clear the idle timer when the extension is deactivated to prevent any lingering timers from running after the extension is no longer active
		}
	});
	
    return {
        getStats() {
            return {
                totalEdits,
                totalSaves
            };
        }
    };
}