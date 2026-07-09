// Tracks linter/compiler errors (diagnostics) for files opened during this session,
// logging a snapshot of error diagnostics each time the user saves.
import * as vscode from 'vscode';
import { logTelemetry, isTelemetryLogDocument} from './telemetry';

export function startErrorTracking(context: vscode.ExtensionContext) {
    // Track URIs of filed opened during this session to know which files to monitor for diagnostics
    const trackedFiles = new Set<string>();

    // Register newly opened files (track both saved files and untitled editors)
    const openListener = vscode.workspace.onDidOpenTextDocument(document => {
        if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
            return;
        }
        if (isTelemetryLogDocument(document.uri)) {
            return;
        }
        trackedFiles.add(document.uri.toString());
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

        const uriString = document.uri.toString();
        // Ensure the saved document is tracked (covers untitled -> file URI transitions)
        trackedFiles.add(uriString);

        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const errorDiagnostics = diagnostics.filter(diag => diag.severity === vscode.DiagnosticSeverity.Error); // Filter to only include error diagnostics, excluding warnings and informational messages
        
        if (errorDiagnostics.length === 0) {
            logTelemetry('saveCheckpoint', {
                fileName: document.fileName,
                language: document.languageId,
                errorCount: 0,
            });
            return; // If there are no error diagnostics, log a checkpoint with zero errors and return early
        }

        // Log telemetry with details about the file and its error diagnostics, including message, source, and range for each error, to help analyze common issues and improve the extension's features
        logTelemetry('saveCheckpoint', {
            fileName: document.fileName,
            language: document.languageId,
            errorCount: errorDiagnostics.length,
                errors: errorDiagnostics.map(diag => ({
                message: diag.message,
                source: diag.source ?? 'unknown',
                range: {
                    startLine: diag.range.start.line,
                    startCharacter: diag.range.start.character,
                    endLine: diag.range.end.line,
                    endCharacter: diag.range.end.character,
                }
            }))
        });
    });
        
    context.subscriptions.push(saveListener);

    // When a file is closed, stop tracking it to avoid memory leaks and unnecessary telemetry logging for files no longer in use
    const closeListener = vscode.workspace.onDidCloseTextDocument(document => {
        trackedFiles.delete(document.uri.toString()); // Stop tracking files that are closed to avoid memory leaks
    });
    context.subscriptions.push(closeListener);
}