// runtimeTracker.ts
import * as vscode from 'vscode';
import { logTelemetry } from './telemetry';
import * as cups from './cupsStateTracker';

interface StackFrame {
    file: string;
    line: number;
    column: number;
    functionName: string;
    code: string;
}

interface CapturedException {
    errorType: string;
    errorMessage: string;
    stackFrames: StackFrame[];
    rawStackTrace: string;
}

// Maps active debug session IDs to their captured exceptions
const sessionExceptions = new Map<string, CapturedException>();

/**
 * Custom Debug Adapter Tracker that programmatically queries the debugger
 * when it encounters an uncaught runtime crash.
 */
class ProgrammaticErrorTracker implements vscode.DebugAdapterTracker {
    constructor(private session: vscode.DebugSession) {}

    async onDidSendMessage(message: any): Promise<void> {
        // Detect when the debugger hits a stop event
        if (message.type === 'event' && message.event === 'stopped') {
            const { reason, threadId } = message.body || {};

            // If the process stopped due to an unhandled exception, query it!
            if (reason === 'exception' && threadId !== undefined) {
                await this.captureExceptionDetails(threadId);
            }
        }
    }

    private async captureExceptionDetails(threadId: number): Promise<void> {
        try {
            let errorType = 'UncaughtException';
            let errorMessage = 'An unhandled runtime error occurred.';
            let rawStackTrace = '';
            const parsedFrames: StackFrame[] = [];

            // 1. Programmatically request exception details (DAP exceptionInfo)
            // Removed the session.capabilities check. We try the request directly.
            try {
                const exceptionInfo = await this.session.customRequest('exceptionInfo', { threadId });
                if (exceptionInfo) {
                    errorType = exceptionInfo.exceptionId || errorType;
                    errorMessage = exceptionInfo.description || exceptionInfo.text || errorMessage;
                }
            } catch (err) {
                // If the specific debug adapter doesn't support exceptionInfo, 
                // it rejects here and we safely fallback to our defaults.
            }

            // 2. Programmatically request structured stack trace (DAP stackTrace)
            try {
                const stackTrace = await this.session.customRequest('stackTrace', {
                    threadId,
                    startFrame: 0,
                    levels: 10 // Capture up to 10 frames of depth
                });

                if (stackTrace && stackTrace.stackFrames) {
                    for (const frame of stackTrace.stackFrames) {
                        // Convert the frame path to workspace-relative layout
                        const absolutePath = frame.source?.path || '';
                        const relPath = absolutePath 
                            ? vscode.workspace.asRelativePath(absolutePath, false)
                            : (frame.source?.name || 'unknown');

                        parsedFrames.push({
                            file: relPath,
                            line: frame.line || 0,
                            column: frame.column || 0,
                            functionName: frame.name || 'anonymous',
                            code: '' // Programmatic DAP requests provide frame metrics instead of source content
                        });
                    }

                    // Build a standard formatted traceback string for the raw log
                    rawStackTrace = stackTrace.stackFrames
                        .map((frame: any) => {
                            const source = frame.source?.path || frame.source?.name || 'unknown';
                            return `  at ${frame.name} (${source}:${frame.line}:${frame.column})`;
                        })
                        .join('\n');
                }
            } catch (err) {
                // Fall back if stackTrace request fails
            }

            // Cache the compiled exception details under the session ID
            sessionExceptions.set(this.session.id, {
                errorType,
                errorMessage,
                stackFrames: parsedFrames,
                rawStackTrace
            });

        } catch (error) {
            console.error('[codexlog] Failed to retrieve programmatic exception details:', error);
        }
    }
}

/**
 * Registers the passive debugger tracker factory and maps lifecycle completions
 * to write structured telemetry events safely.
 */
export function registerAutomaticRuntimeTracker(context: vscode.ExtensionContext) {
    
    // Register the passive DAP tracker factory across all files & languages
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker(session: vscode.DebugSession) {
                return new ProgrammaticErrorTracker(session);
            }
        })
    );

    // Track active completions when execution sessions terminate
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession((session) => {
            const exception = sessionExceptions.get(session.id);
            sessionExceptions.delete(session.id);

            const filePath = session.configuration.program || vscode.window.activeTextEditor?.document.fileName || 'unknown';
            const relFile = vscode.workspace.asRelativePath(filePath, false);
            const language = session.configuration.type || 'unknown';

            if (exception) {
                // Case A: Program crashed
                const firstFrame = exception.stackFrames[0] ?? null;

                const event = logTelemetry('Run.Program', null, {
                    executionResult: 'Error',
                    file: relFile,
                    language,
                    exitCode: 1,
                    errorType: exception.errorType,
                    errorMessage: exception.errorMessage,
                    frameCount: exception.stackFrames.length,
                    stackFrames: exception.stackFrames,
                    rawStderr: exception.rawStackTrace,
                    sourceLocation: firstFrame ? { startLine: firstFrame.line } : undefined
                });
                
            // Notify CUPS of execution/error state
            cups.onRunOrCompileError(relFile, event.EventID, event.ClientTimestamp);
            } else {
                // Case B: Clean execution
                const event = logTelemetry('Run.Program', null, { 
                    executionResult: 'Success',
                    file: relFile,
                    language,
                    reason: 'success' 
                });
            
            // Notify CUPS of execution/error state
            cups.onRunOrCompileError(relFile, event.EventID, event.ClientTimestamp);
            }
        })
    );
}