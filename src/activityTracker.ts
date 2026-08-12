// Refactored VSCode extension main activity tracking logic

import * as vscode from 'vscode'; 
import { logTelemetry, isTelemetryLogDocument, writeVerificationBufferLog } from './telemetry'; 
import * as cups from './cupsStateTracker';
import { CupsState, EditType } from './types';

let totalEdits = 0; 
let totalSaves = 0; 

const PASTE_CHAR_THRESHOLD = 10;
const POST_AI_IDLE_THRESHOLD = 30 * 1000; 
const UNDO_ATTRIBUTION_THRESHOLD = 60 * 1000; 
const AI_INSERTION_WINDOW_MS = 3000; 
const PASTE_RECONCILE_DELAY_MS = 3000;
const SURVIVAL_CHECK_DEBOUNCE_MS = 1500;

interface LineRange { startLine: number; endLine: number; } 

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
    if (editStartLine > range.endLine) {
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
    const normOrig = originalText.replace(/\s+/g, ' ').trim();
    const normCurr = currentText.replace(/\s+/g, ' ').trim();

    if (normOrig === normCurr) return 1;
    if (normOrig.length === 0 || normCurr.length === 0) return 0;

    // Fallback for short strings (<4 chars) where n-grams cannot be generated
    if (normOrig.length < 4 || normCurr.length < 4) {
        return normOrig === normCurr ? 1 : 0;
    }

    const a = ngrams(normOrig);
    const b = ngrams(normCurr);
    if (a.size === 0 || b.size === 0) return 0;

    let intersection = 0;
    for (const gram of a) {
        if (b.has(gram)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 1 : intersection / union;
}

let postAIIdleTimer: NodeJS.Timeout | null = null; 
let survivalCheckTimer: NodeJS.Timeout | null = null;
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

function claimPendingPasteCandidate(fileHint: string): PendingPasteCandidate | undefined {
    if (pendingPasteCandidates.length === 0) return undefined;

    let idx = pendingPasteCandidates.findIndex(c => c.file === fileHint);
    if (idx === -1) {
        idx = pendingPasteCandidates.length - 1;
    }

    const candidate = pendingPasteCandidates[idx];
    clearTimeout(candidate.timer);
    pendingPasteCandidates.splice(idx, 1);
    return candidate;
}

function scheduleSurvivalCheck(relFile: string, document: vscode.TextDocument, editType: EditType) {
    if (survivalCheckTimer) clearTimeout(survivalCheckTimer);
    
    survivalCheckTimer = setTimeout(() => {
        if (!lastAiInsertionRange || !lastAiInsertionOriginalText) return;

        const clampedEndLine = Math.min(lastAiInsertionRange.endLine, document.lineCount - 1);
        const currentRangeText = document.getText(new vscode.Range(lastAiInsertionRange.startLine, 0, clampedEndLine + 1, 0));
        const score = survivalScore(lastAiInsertionOriginalText, currentRangeText);

        const survivalEvent = logTelemetry(
            'X-AI.Suggestion.SurvivalCheck',
            null,
            { survivalScore: score },
            {
                file: relFile,
                parentEventId: lastAiAcceptedEventId ?? undefined,
                editType
            }
        );

        // State-gated CUPS notification
        const currentState = cups.getCurrentState();
        if (currentState === 'VerifyingSuggestion' || currentState === 'EditingSuggestion') {
            cups.onSurvivalCheck?.(relFile, survivalEvent.EventID, survivalEvent.ClientTimestamp, score);
        }
    }, SURVIVAL_CHECK_DEBOUNCE_MS);
}

export function registerPendingAiInsertion() {
    pendingAiInsertionTimestamp = Date.now();
}

export function onAISuggestionAccepted(
    fileFallback: string,
    languageFallback: string,
    acceptedText: string,
    startLine: number,
    otelSpanId: string
) {
    const claimedPaste = claimPendingPasteCandidate(fileFallback);

    const file = claimedPaste ? claimedPaste.file : fileFallback;
    const language = claimedPaste ? claimedPaste.language : languageFallback;
    const charCount = claimedPaste ? claimedPaste.charCount : acceptedText.length;
    const lineCount = claimedPaste ? claimedPaste.lineCount : acceptedText.split('\n').length;
    const fullInsertedText = claimedPaste ? claimedPaste.insertedText : acceptedText;

    if (file.includes('telemetry.json')) return;

    cumulativeAiChars += charCount;
    lastTrackedFile = file;

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

    cups.onAISuggestionAccepted(file, acceptedEvent.EventID, acceptedEvent.ClientTimestamp);

    lastAiAcceptedEventId = acceptedEvent.EventID; 
    lastAiAcceptedTime = Date.now(); 
    lastAiInsertionRange = { startLine, endLine: startLine + lineCount - 1 }; 
    lastAiInsertionOriginalText = fullInsertedText; 

    if (postAIIdleTimer) clearTimeout(postAIIdleTimer); 
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
            if (event.document.uri.scheme !== 'file') return;

            const relFile = vscode.workspace.asRelativePath(event.document.uri, false);
            const normLastTrackedFile = lastTrackedFile ? vscode.workspace.asRelativePath(lastTrackedFile, false) : null;
            
            const touchesSuggestion = (change: vscode.TextDocumentContentChangeEvent): boolean => {
                if (!lastAiInsertionRange) return false;
                return rangesOverlap(lastAiInsertionRange, change.range.start.line, change.range.end.line);
            };

            // 1. NATIVE CTRL+Z / UNDO DETECTION (Range-Aware)
            const isNativeUndo = event.reason === vscode.TextDocumentChangeReason.Undo;
            if (isNativeUndo) {
                const now = Date.now();
                const withinWindow = lastAiAcceptedTime !== null && (now - lastAiAcceptedTime) <= UNDO_ATTRIBUTION_THRESHOLD;

                if (trackingUndos && normLastTrackedFile === relFile && withinWindow) {
                    const overlapsAiSuggestion = event.contentChanges.some(touchesSuggestion);
                    
                    if (overlapsAiSuggestion) {
                        undoCountSinceAI++;
                        
                        const revertEvent = logTelemetry(
                            'X-AI.Suggestion.Reverted',
                            'Full',
                            {
                                undoCount: undoCountSinceAI,
                                reason: 'Ctrl+Z'
                            },
                            {
                                file: relFile,
                                parentEventId: lastAiAcceptedEventId ?? undefined,
                                editType: 'Undo',
                            }
                        );

                        // State-gated CUPS transition
                        const currentState = cups.getCurrentState();
                        if (currentState === 'VerifyingSuggestion' || currentState === 'EditingSuggestion') {
                            cups.onEditDuringOrAfterSuggestion(relFile, revertEvent.EventID, revertEvent.ClientTimestamp);
                        }

                        // Reset tracking state
                        trackingUndos = false;
                        undoCountSinceAI = 0;
                        lastAiAcceptedEventId = null;
                        lastAiAcceptedTime = null;
                        lastAiInsertionRange = null;
                        lastAiInsertionOriginalText = null;
                    }
                }
                return;
            }

            const isWithinAiWindow = (Date.now() - pendingAiInsertionTimestamp) <= AI_INSERTION_WINDOW_MS;
            const isJustAcceptedAI = lastAiAcceptedTime !== null && (Date.now() - lastAiAcceptedTime) <= 2000;

            for (const change of event.contentChanges) {
                const insertedText = change.text;
                const lineCount = insertedText.split('\n').length;
                const charCount = insertedText.length;
                const isDeletion = change.text === '' && change.rangeLength > 0;

                // 2. CHECK UNDOS / MANUAL REVERTS FIRST
                if (isDeletion) {
                    if (trackingUndos && relFile === normLastTrackedFile) {
                        const withinWindow = lastAiAcceptedTime !== null && (Date.now() - lastAiAcceptedTime) <= UNDO_ATTRIBUTION_THRESHOLD;
                        
                        if (withinWindow && touchesSuggestion(change)) {
                            const isFullRevert = change.rangeLength >= lastAIInsertionCharCount; 
                            
                            if (isFullRevert) {
                                undoCountSinceAI++;
                                const revertEvent = logTelemetry(
                                    'X-AI.Suggestion.Reverted', 
                                    'Full',
                                    {
                                        undoCount: undoCountSinceAI,
                                        removedChars: change.rangeLength,
                                    },
                                    {
                                        file: relFile,
                                        parentEventId: lastAiAcceptedEventId ?? undefined,
                                        editType: 'Undo' as EditType, 
                                    }
                                );

                                // State-gated CUPS transition for full revert
                                const currentState = cups.getCurrentState();
                                if (currentState === 'VerifyingSuggestion' || currentState === 'EditingSuggestion') {
                                    cups.onEditDuringOrAfterSuggestion(relFile, revertEvent.EventID, revertEvent.ClientTimestamp);
                                }

                                // Reset tracking state
                                trackingUndos = false;
                                undoCountSinceAI = 0;
                                lastAiAcceptedEventId = null;
                                lastAiAcceptedTime = null;
                                lastAiInsertionRange = null;
                                lastAiInsertionOriginalText = null;
                            } else {
                                // Partial deletion (e.g. backspacing character-by-character)
                                // Adjust tracked range and defer telemetry to debounced survival check
                                if (lastAiInsertionRange) {
                                    const lineDelta = change.range.end.line - change.range.start.line;
                                    lastAiInsertionRange = {
                                        startLine: lastAiInsertionRange.startLine, 
                                        endLine: Math.max(lastAiInsertionRange.startLine, lastAiInsertionRange.endLine - lineDelta)
                                    };
                                }

                                const currentState = cups.getCurrentState();
                                if (currentState === 'VerifyingSuggestion') {
                                    cups.onEditDuringOrAfterSuggestion(relFile, 'internal_edit', new Date().toISOString());
                                }

                                // Trigger debounced survival calculation instead of per-keystroke logging
                                if (lastAiInsertionRange !== null && lastAiInsertionOriginalText !== null) {
                                    scheduleSurvivalCheck(relFile, event.document, 'Delete' as EditType);
                                }
                            }
                        }
                    }
                    continue; 
                }

                // 3. IGNORE EMPTY CHANGES THAT AREN'T DELETIONS
                if (charCount === 0) continue;
                
                if (isJustAcceptedAI) {
                    cumulativeAiChars += charCount;
                    continue;
                }

                // 4. PASTE DETECTION FOR INSERTIONS
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

                // 5. MANUAL TYPING
                cumulativeManualChars += charCount;

                // State-gated generic edit tracking
                const currentState = cups.getCurrentState();
                if (currentState !== 'WritingNewCode') {
                    const editEvent = logTelemetry('File.Edit', null, { lineCount, charCount }, { file: relFile, language: event.document.languageId });
                    if (currentState === 'VerifyingSuggestion' || currentState === 'Idle') {
                        cups.onGenericEdit(relFile, editEvent.EventID, editEvent.ClientTimestamp);
                    }
                }

                if (postAIIdleTimer) {
                    clearTimeout(postAIIdleTimer); 
                    postAIIdleTimer = null;
                }
                
                const editTouchesSuggestion = touchesSuggestion(change);

                if (trackingUndos && relFile === normLastTrackedFile) {
                    const withinWindow = lastAiAcceptedTime !== null && (Date.now() - lastAiAcceptedTime) <= UNDO_ATTRIBUTION_THRESHOLD;
                    if (!withinWindow) { 
                        trackingUndos = false;
                        undoCountSinceAI = 0;
                        lastAiAcceptedEventId = null;
                        lastAiAcceptedTime = null;
                        lastAiInsertionRange = null;
                        lastAiInsertionOriginalText = null;
                    } else if (lastAiInsertionRange) {
                        lastAiInsertionRange = shiftRangeForEdit(lastAiInsertionRange, change.range.start.line, change.range.end.line, lineCount);
                    }
                }

                // Trigger debounced survival check if edit modified AI content
                if (editTouchesSuggestion && lastAiInsertionRange !== null && lastAiInsertionOriginalText !== null) {
                    scheduleSurvivalCheck(relFile, event.document, change.rangeLength > 0 ? "Replace" : "Insert");
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
            if (survivalCheckTimer) clearTimeout(survivalCheckTimer);
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