// This file contains the main logic for the VSCode extension, including event listeners for tracking user activity and logging telemetry data

import * as vscode from 'vscode'; // This gives access to: editor events, documents, commands, windows, workspace, APIs
import { logTelemetry, isTelemetryLogDocument} from './telemetry'; // Importing the logTelemetry function to use for logging telemetry events

let totalEdits = 0; // Global variable to track total edits across all documents
let totalSaves = 0; // Global variable to track total saves across all documents

const AI_MIN_LINES = 3;
const AI_MIN_CHARS = 50; 
const POST_AI_IDLE_THRESHOLD = 30 * 1000; // 30 seconds
const UNDO_ATTRIBUTION_THRESHOLD = 60 * 1000; // Number of undos after which we stop attributing to the AI suggestion


interface LineRange {startLine: number; endLine: number;} // Interface to represent a range of lines in a document, used for tracking changes and edits

function rangesOverlap(range: LineRange, editStartLine: number, editEndLine: number): boolean {
	return editStartLine <= range.endLine && editEndLine >= range.startLine; // Check if two line ranges overlap, used to determine if an edit affects a tracked range
}

// Keep tracked range in sync as edits are made to the document, adjusting the start and end lines based on the edit's position and length
function shiftRangeForEdit(range: LineRange, editStartLine: number, editEndLine: number, insertedLineCount: number): LineRange {
	const netLineDelta = insertedLineCount - (editEndLine - editStartLine + 1); // Calculate the net change in line count due to the edit
	if (editEndLine < range.startLine) {
		return {
			startLine: range.startLine + netLineDelta,
			endLine: range.endLine + netLineDelta
		};
	}
	if (editStartLine > range.endLine){
		return range; // Edit is after the range, no change needed
	}
	// Edit overlaps with the range, adjust the end line based on the net line delta
	return range;
}

export function startActivityTracking(context: vscode.ExtensionContext) {
    let postAIIdleTimer: NodeJS.Timeout | null = null; // Timer to track idle time after AI-generated code is detected
	let undoCountSinceAI = 0; // Counter to track the number of undo actions since AI-generated code was detected
	let lastAIInsertionCharCount = 0; // Variable to track the character count of the last AI-generated code insertion
	let trackingUndos = false; // Flag to indicate whether we are currently tracking undo actions after AI-generated code is detected
	let lastAiAcceptedEventId: string | null = null; // ParentEventID for reverts/idle tied to this acceptance
	let lastAiAcceptedTime: number | null = null; // Timestamp of the last AI-generated code acceptance, used to determine if subsequent edits are related to the AI suggestion
	let lastAiInsertionRange: LineRange | null = null; // Range of lines affected by the last AI-generated code insertion, used to determine if subsequent edits overlap with the AI suggestion

	// Adding event listeners to the extension's subscriptions to ensure they are properly disposed of when the extension is deactivated, 
	// preventing memory leaks and ensuring clean resource management
	context.subscriptions.push(
		// Triggers telemetry logging when a text document is changed, capturing details about the change for analysis
		vscode.workspace.onDidChangeTextDocument((event) => {
			// Ignore changes to the telemetry log file itself — otherwise, if the user has
			// opened it via codexlog.openLog, every appended log entry shows up as an
			// external file change, gets misread as a large AI-style insertion, and gets
			// logged as another event, which triggers another change, forever.
			if (isTelemetryLogDocument(event.document.uri)) {
				return;
			}

			const relFile = vscode.workspace.asRelativePath(event.document.uri, false);
			const language = event.document.languageId;
			
			for (const change of event.contentChanges) {
				const insertedText = change.text;
				const lineCount = insertedText.split('\n').length;
				const charCount = insertedText.length;

				const isLikelyAISuggestion = lineCount >= AI_MIN_LINES && charCount >= AI_MIN_CHARS && change.rangeLength === 0; // Heuristic to identify potential AI-generated code based on the number of lines and characters inserted, and ensuring it's an insertion (not a replacement)
				if (isLikelyAISuggestion) {
					// Log acceptance
					const acceptedEvent = logTelemetry('X-AI.Suggestion.Accepted', null, 
					{
						insertedLines: lineCount,
						insertedChars: charCount,
					},
					{
						file: relFile,
						language
					}
				);
				lastAiAcceptedEventId = acceptedEvent.EventID; // remember it for any follow-up event
				lastAiAcceptedTime = Date.now(); // remember it for any follow-up event
				lastAiInsertionRange = {startLine: change.range.start.line, endLine: change.range.start.line + lineCount - 1}; // remember it for any follow-up event
					if (postAIIdleTimer) clearTimeout(postAIIdleTimer); // Clear any existing idle timer to reset the countdown for logging idle time after AI-generated code is detected
					postAIIdleTimer = setTimeout(() => {
						logTelemetry('X-AI.Suggestion.Idle', null, 
						{
							idleSeconds: POST_AI_IDLE_THRESHOLD / 1000,
						},
						{
							file: relFile,
							parentEventId: lastAiAcceptedEventId ?? undefined,
							initiator: 'ToolTimedEvent', // fired by setTimeout, not a direct user action
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
					}

					if(trackingUndos){
						const withinWindow = lastAiAcceptedTime !== null && (Date.now() - lastAiAcceptedTime) <= UNDO_ATTRIBUTION_THRESHOLD;
						if (!withinWindow) { // If the undo action occurs outside the attribution window, stop tracking undos and reset related variables
							trackingUndos = false;
							undoCountSinceAI = 0;
							lastAiAcceptedEventId = null;
							lastAiAcceptedTime = null;
							lastAiInsertionRange = null;
						}
						else {
							const editStartLine = change.range.start.line;
							const editEndLine = change.range.end.line;
							const editInsertedLineCount = lineCount;

							const touchesSuggestion = lastAiInsertionRange !== null && rangesOverlap(lastAiInsertionRange, editStartLine, editEndLine);
							const isUndo = change.text === '' && change.rangeLength > 0;
 						
							if(isUndo && touchesSuggestion){
								undoCountSinceAI++;
								const isFullRevert = change.rangeLength >= lastAIInsertionCharCount; // 
								const revertEvent = logTelemetry('X-AI.Suggestion.Reverted', isFullRevert ? 'Full' : 'Partial',
									{
										undoCount: undoCountSinceAI,
										removedChars: change.rangeLength,
							
									},
									{
										file: relFile,
										parentEventId: lastAiAcceptedEventId ?? undefined,
										editType: 'Undo',	
									}
								);
								// cups.onEditDuringOrAfterSuggestion(relFile, revertEvent.EventID, revertEvent.ClientTimestamp);
								if (isFullRevert) {
									trackingUndos = false;
									undoCountSinceAI = 0;
									lastAiAcceptedEventId = null;
									lastAiAcceptedTime = null;
									lastAiInsertionRange = null;
								}
								else if(lastAiInsertionRange){
									// Partial revert, update the tracked range to reflect the new state of the document after the undo
									lastAiInsertionRange = {startLine: lastAiInsertionRange.startLine, endLine: Math.max(lastAiInsertionRange.startLine, lastAiInsertionRange.endLine - (editEndLine - editStartLine))};
								}
								continue; // already logged + classified this change, skip the generic-edit check below
								}

								// Not an undo, but still touches the AI suggestion range, update the tracked range to reflect the new state of the document after the edit
								if (lastAiInsertionRange) {
									// Update the tracked range to reflect the new state of the document after the edit, ensuring that subsequent edits are correctly evaluated for overlap with the AI suggestion
									lastAiInsertionRange = shiftRangeForEdit(lastAiInsertionRange, editStartLine, editEndLine, editInsertedLineCount);
								}
							}
						}
					// Only emit a File.Edit event (and feed the classifier) when we're not
                    // already in WritingNewCode — this bounds event volume to transition
                    // boundaries instead of logging every keystroke.
                    /*if (cups.getCurrentState() !== 'WritingNewCode') {
                        const editType = charCount === 0 ? 'Delete' : (change.rangeLength > 0 ? 'Replace' : 'Insert');
                        const editEvent = logTelemetry(
                            'File.Edit',
                            null,
                            { lineCount, charCount },
                            { file: relFile, language, editType }
                        );
                        cups.onGenericEdit(relFile, editEvent.EventID, editEvent.ClientTimestamp);
                    }*/
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
			if (isTelemetryLogDocument(document.uri)) return;
			logTelemetry('File.Save', null, {
				editsSinceLastSave: totalEdits, // Log the number of edits since the last save to analyze editing patterns and work cadence
			},
			{
				file: vscode.workspace.asRelativePath(document.uri, false), language: document.languageId
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