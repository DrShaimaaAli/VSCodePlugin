// This file contains the main logic for the VSCode extension, including event listeners for tracking user activity and logging telemetry data

import * as vscode from 'vscode'; 
import { logTelemetry, isTelemetryLogDocument, writeVerificationBufferLog } from './telemetry'; 

let totalEdits = 0; 
let totalSaves = 0; 

const PASTE_CHAR_THRESHOLD = 10;
const POST_AI_IDLE_THRESHOLD = 30 * 1000; 
const UNDO_ATTRIBUTION_THRESHOLD = 60 * 1000; 
const AI_INSERTION_WINDOW_MS = 3000; 
const PASTE_RECONCILE_DELAY_MS = 3000;

interface LineRange {startLine: number; endLine: number;} 

function rangesOverlap(range: LineRange, editStartLine: number, editEndLine: number): boolean {
	return editStartLine <= range.endLine && editEndLine >= range.startLine; 
}

function shiftRangeForEdit(range: LineRange, editStartLine: number, editEndLine: number, insertedLineCount: number): LineRange {
	const netLineDelta = insertedLineCount - (editEndLine - editStartLine + 1); 
	if (editEndLine < range.startLine) {
		return {
			startLine: range.startLine + netLineDelta,
			endLine: range.endLine + netLineDelta
		};
	}
	if (editStartLine > range.endLine){
		return range; 
	}
	return range;
}

function ngrams(text: string, n = 4): Set<string> {
	const grams = new Set<string>();
	const normalized = text.replace(/\s+/g, ' ').trim();
	for (let i = 0; i <= normalized.length - n; i++) {
		grams.add(normalized.slice(i, i + n));
	}
	return grams;
}

function survivalScore(originalText: string, currentText: string): number {
	if (originalText.length === 0 && currentText.length === 0) {
		return 1;
	}
	const a = ngrams(originalText);
	const b = ngrams(currentText);
	if (a.size === 0 || b.size === 0) {
		return a.size === b.size ? 1 : 0;
	}
	let intersection = 0;
	for (const gram of a) {
		if (b.has(gram)) {
			intersection++;
		}
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 1 : intersection / union;
}

let postAIIdleTimer: NodeJS.Timeout | null = null; 
let undoCountSinceAI = 0; 
let lastAIInsertionCharCount = 0; 
let trackingUndos = false; 
let lastAiAcceptedEventId: string | null = null; 
let lastAiAcceptedTime: number | null = null; 
let lastAiInsertionRange: LineRange | null = null; 
let lastAiInsertionOriginalText: string | null = null; 
let lastTrackedFile: string | null = null;

let cumulativeAiChars = 0;
let cumulativeManualChars = 0;
let pendingAiInsertionTimestamp = 0;

// --- Paste/AI reconciliation queue ---------------------------------------
interface PendingPasteCandidate {
	file: string;
	language: string;
	lineCount: number;
	charCount: number;
	insertedText: string;
	timer: NodeJS.Timeout;
}
let pendingPasteCandidates: PendingPasteCandidate[] = [];

function schedulePasteCandidate(file: string, language: string, lineCount: number, charCount: number, insertedText: string) {
	const timer = setTimeout(() => {
		pendingPasteCandidates = pendingPasteCandidates.filter(c => c.timer !== timer);
		// Paste silently dropped if not claimed by AI

		logTelemetry(
			'X-External.Paste',
			null,
			{
				insertedChars: charCount,
				insertedLines: lineCount,
				file: file,
				language: language
			},
			{ initiator: 'UserDirectAction' }
		);
	}, PASTE_RECONCILE_DELAY_MS);

	pendingPasteCandidates.push({ file, language, lineCount, charCount, insertedText, timer });
}

// UPDATE: Aggressive claiming. If the fileHint fails (due to activeTextEditor shifting), 
// just grab the most recent large paste in the queue regardless of file name.
function claimPendingPasteCandidate(fileHint: string): PendingPasteCandidate | undefined {
    if (pendingPasteCandidates.length === 0) return undefined;

    let idx = pendingPasteCandidates.findIndex(c => c.file === fileHint);
    
    // If strict match fails, assume the OTel fallback was wrong and grab the latest edit
    if (idx === -1) {
        idx = pendingPasteCandidates.length - 1;
    }

    const candidate = pendingPasteCandidates[idx];
    clearTimeout(candidate.timer);
    pendingPasteCandidates.splice(idx, 1);
    return candidate;
}

export function registerPendingAiInsertion() {
	pendingAiInsertionTimestamp = Date.now();
}

export function onAISuggestionAccepted (
	fileFallback: string,
	languageFallback: string,
	acceptedText: string,
	startLine : number,
	otelSpanId: string
) {
	const claimedPaste = claimPendingPasteCandidate(fileFallback);

	// Inherit the TRUE file and language from the synchronous queue event
    const file = claimedPaste ? claimedPaste.file : fileFallback;
    const language = claimedPaste ? claimedPaste.language : languageFallback;
	const charCount = claimedPaste ? claimedPaste.charCount : acceptedText.length;
	const lineCount = claimedPaste ? claimedPaste.lineCount : acceptedText.split('\n').length;
	const fullInsertedText = claimedPaste ? claimedPaste.insertedText : acceptedText;

	if (file.includes('telemetry.json')) return; // Ignore telemetry log edits

	cumulativeAiChars += charCount;
	lastTrackedFile = file;

    // 4. Log the AI event as normal
    const acceptedEvent = logTelemetry(
        'X-AI.Suggestion.Accepted',
        null,
        {
            insertedChars: charCount,
            insertedLines: lineCount,
            source: 'OTel.SpanProcessor',
            otelSpanId
        },
        { file, language, initiator: 'UserDirectAction' }
    );

	lastAiAcceptedEventId = acceptedEvent.EventID; 
	lastAiAcceptedTime = Date.now(); 
	lastAiInsertionRange = {startLine, endLine: startLine + lineCount - 1}; 
	lastAiInsertionOriginalText = fullInsertedText; 

	if (postAIIdleTimer) {
		clearTimeout(postAIIdleTimer); 
	}
	postAIIdleTimer = setTimeout(() => {
			logTelemetry('X-AI.Suggestion.Idle', null, 
			{ idleSeconds: POST_AI_IDLE_THRESHOLD / 1000 },
			{ file, parentEventId: lastAiAcceptedEventId ?? undefined, initiator: 'ToolTimedEvent' });
			postAIIdleTimer = null; 
		}, POST_AI_IDLE_THRESHOLD);

		undoCountSinceAI = 0;
		lastAIInsertionCharCount = charCount;
		trackingUndos = true;
}

export function startActivityTracking(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (isTelemetryLogDocument(event.document.uri)) return;

			const relFile = vscode.workspace.asRelativePath(event.document.uri, false);
			const isWithinAiWindow = (Date.now() - pendingAiInsertionTimestamp) <= AI_INSERTION_WINDOW_MS;

			for (const change of event.contentChanges) {
				const insertedText = change.text;
				const lineCount = insertedText.split('\n').length;
				const charCount = insertedText.length;

				if (charCount === 0) continue;
				
				// UPDATE: If we are in the AI window, automatically queue it even if it's small
				const isPaste = charCount >= PASTE_CHAR_THRESHOLD || lineCount > 1 || isWithinAiWindow;

				if (isPaste) {
					schedulePasteCandidate(
						relFile,
						event.document.languageId,
						lineCount,
						charCount,
						insertedText
					);
					if (postAIIdleTimer) {
						clearTimeout(postAIIdleTimer);
						postAIIdleTimer = null;
					}
					continue; 
				}

				cumulativeManualChars += charCount;

				if (postAIIdleTimer) {
					clearTimeout(postAIIdleTimer); 
					postAIIdleTimer = null;
				}
				
				let touchesSuggestion = false;
				if (trackingUndos && relFile === lastTrackedFile) {
					const withinWindow = lastAiAcceptedTime !== null && (Date.now() - lastAiAcceptedTime) <= UNDO_ATTRIBUTION_THRESHOLD;
					if (!withinWindow) { 
						trackingUndos = false;
						undoCountSinceAI = 0;
						lastAiAcceptedEventId = null;
						lastAiAcceptedTime = null;
						lastAiInsertionRange = null;
						lastAiInsertionOriginalText = null;
					} else {
						const editStartLine = change.range.start.line;
						const editEndLine = change.range.end.line;
						const editInsertedLineCount = lineCount;

						touchesSuggestion = lastAiInsertionRange !== null && rangesOverlap(lastAiInsertionRange, editStartLine, editEndLine);
						const isUndo = change.text === '' && change.rangeLength > 0;
					
						if(isUndo && touchesSuggestion){
							undoCountSinceAI++;
							const isFullRevert = change.rangeLength >= lastAIInsertionCharCount; 
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
							if (isFullRevert) {
								trackingUndos = false;
								undoCountSinceAI = 0;
								lastAiAcceptedEventId = null;
								lastAiAcceptedTime = null;
								lastAiInsertionRange = null;
								lastAiInsertionOriginalText = null;
							} else if(lastAiInsertionRange){
								lastAiInsertionRange = {startLine: lastAiInsertionRange.startLine, endLine: Math.max(lastAiInsertionRange.startLine, lastAiInsertionRange.endLine - (editEndLine - editStartLine))};
							}
							continue; 
						}

						if (lastAiInsertionRange) {
							lastAiInsertionRange = shiftRangeForEdit(lastAiInsertionRange, editStartLine, editEndLine, editInsertedLineCount);
						}
					}
				}

				if (touchesSuggestion && lastAiInsertionRange !== null && lastAiInsertionOriginalText !== null) {
					const clampedEndLine = Math.min(lastAiInsertionRange.endLine, event.document.lineCount - 1);
					const currentRangeText = event.document.getText(new vscode.Range(lastAiInsertionRange.startLine, 0, clampedEndLine + 1, 0));
					const score = survivalScore(lastAiInsertionOriginalText, currentRangeText);
					logTelemetry(
						'X-AI.Suggestion.SurvivalCheck',
						null,
						{survivalScore: score},
						{
							file: relFile,
							parentEventId: lastAiAcceptedEventId ?? undefined,
							editType: change.rangeLength > 0 ? "Replace" : "Insert"
						}
					);
				}
			}
			totalEdits++;
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (isTelemetryLogDocument(document.uri)) return;
			
			logTelemetry('File.Save', null, {
				editsSinceLastSave: totalEdits, 
			},
			{ file: vscode.workspace.asRelativePath(document.uri, false), language: document.languageId });

			const totalChars = cumulativeAiChars + cumulativeManualChars;
			logTelemetry(
				'X-Scaffold.DecayCheckpoint', null,
				{
					cumulativeAiChars,
					cumulativeManualChars,
					aiRatio: totalChars > 0 ? cumulativeAiChars / totalChars : null,
				},
				{ file: vscode.workspace.asRelativePath(document.uri, false), initiator: 'ToolReaction' }
			);

			writeVerificationBufferLog();

			totalEdits = 0; 
			totalSaves++;
		})
	);

	context.subscriptions.push({
		dispose: () => {
			if (postAIIdleTimer) clearTimeout(postAIIdleTimer); 
			for (const candidate of pendingPasteCandidates) clearTimeout(candidate.timer);
			pendingPasteCandidates = [];
		}
	});
	
    return {
        getStats() {
            return { totalEdits, totalSaves };
        }
    };
}