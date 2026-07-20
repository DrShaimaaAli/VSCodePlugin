// Tracks linter/compiler errors (diagnostics) for files opened during this session,
// logging a snapshot of error diagnostics each time the user saves.
import * as vscode from 'vscode';
import { logTelemetry, isTelemetryLogDocument} from './telemetry';
//import * as cups from './cupsStateTracker';

interface TrackedError{
    eventId: string; // the X-Error.Introduced event ID that introduced this error
    introducedAt: number; // ms timestamp
    savesSeen: number;
}
// Keyed by `${file}::${message}::${source}` to uniquely identify each error diagnostic, so we can track when it was introduced and how many saves have occurred since then
function errorKey(file: string, message: string, source: string | undefined): string {
    return `${file}::${message}::${source ?? 'unknown'}`;
}

export function startErrorTracking(context: vscode.ExtensionContext) {
    // Track URIs of filed opened during this session to know which files to monitor for diagnostics
    const trackedFiles = new Set<string>();
    const openErrors = new Map<string, TrackedError>(); // Map of errorKey -> TrackedError to track errors across saves

    // Register newly opened files (track both saved files and untitled editors)
    const openListener = vscode.workspace.onDidOpenTextDocument(document => {
        if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
            return;
        }
        if (isTelemetryLogDocument(document.uri)) {
            return;
        }
        trackedFiles.add(document.uri.toString());
        logTelemetry('File.Open', null, {}, {
            file: vscode.workspace.asRelativePath(document.uri, false),
            language: document.languageId,
        });
    });
    context.subscriptions.push(openListener);

    // On save, log error diagnostics for the saved file if it's being tracked
    const saveListener = vscode.workspace.onDidSaveTextDocument(document => {
        // Only consider real files and saved untitled editors
        if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
            return;
        }
        if (isTelemetryLogDocument(document.uri)) {
            return;
        }

        const relFile = vscode.workspace.asRelativePath(document.uri, false);
        // Ensure the saved document is tracked (covers untitled -> file URI transitions)
        trackedFiles.add(document.uri.toString());

        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const errorDiagnostics = diagnostics.filter(diag => diag.severity === vscode.DiagnosticSeverity.Error); // Filter to only include error diagnostics, excluding warnings and informational messages
        
        // build the set of error keys present right now
        const currentKeys = new Set<string>();
        for(const diag of errorDiagnostics){
            const source = diag.source ?? 'unknown';
            currentKeys.add(errorKey(relFile, diag.message, source));
        }

        // New errors: in currentKeys but not previously tracked -> X-Error.Introduced
        for(const diag of errorDiagnostics){
            const source = diag.source ?? 'unknown';
            const key = errorKey(relFile, diag.message, source);
            if(!openErrors.has(key)){
                const event = logTelemetry('X-Error.Introduced', null, {
                    message: diag.message, source
                },
                {
                    file: relFile,
                    language: document.languageId,
                    initiator: 'ToolReaction', // introduced by the linter/compiler, not the user
                    sourceLocation: {
                        startLine: diag.range.start.line,
                        startColumn: diag.range.start.character,
                        endLine: diag.range.end.line,
                        endColumn: diag.range.end.character,
                    }
                });
                openErrors.set(key, {eventId: event.EventID, introducedAt: Date.now(), savesSeen: 1});
                // cups.onRunOrComileError(relFile, event.EventID, event.ClientTimestamp);
                }
            }

            // Previously tracked errors: either persisted (still present) or resolved (gone now)
            for(const [key, tracked] of Array.from(openErrors.entries())){
                if(!key.startsWith(`${relFile}::`)) continue; // only consider errors for this file
                if(currentKeys.has(key)) {
                    tracked.savesSeen++; // still present, increment savesSeen
                    const persistedEvent = logTelemetry('X-Error.Persisted', null, {
                        savesSeen: tracked.savesSeen},
                        {file: relFile, parentEventId: tracked.eventId, initiator: 'ToolReaction'});
                        //cups.onRunOrCompileError(relFile, persistedEvent.EventID, persistedEvent.ClientTimestamp);
                } else {
                    // resolved, log X-Error.Resolved and remove from openErrors
                    logTelemetry(
                        'X-Error.Resolved',
                        null,
                        {
                            resolvedAfterMs: Date.now() - tracked.introducedAt,
                            savesSinceIntroduced: tracked.savesSeen,
                        },
                        {file: relFile, parentEventId: tracked.eventId, initiator: 'ToolReaction'}
                    );
                    openErrors.delete(key);
                }
             }
             
             logTelemetry('X-Diagnostics.Check', null, {
                errorCount: errorDiagnostics.length},
                {
                    file: relFile,
                    language: document.languageId,
                    initiator: 'ToolReaction',
                    compileResult: errorDiagnostics.length > 0 ? 'Error' : 'Success',
                }
            );
        });

        context.subscriptions.push(saveListener);

        // When a file is closed, stop tracking it to avoid memory leaks and unnecessary telemetry logging for files no longer in use
        const closeListener = vscode.workspace.onDidCloseTextDocument(document => {
            if (isTelemetryLogDocument(document.uri)) {
                return;
            }
            trackedFiles.delete(document.uri.toString()); // Stop tracking files that are closed to avoid memory leaks
            logTelemetry('File.Close', null, {}, {
                file: vscode.workspace.asRelativePath(document.uri, false),
        });
        context.subscriptions.push(closeListener);
    });
}