import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerPendingAiInsertion, onAISuggestionAccepted } from './activityTracker';
import { logTelemetry } from './telemetry';

class CopilotOtelFileWatcher {
    private filePath: string;
    private fileOffset: number = 0;
    private lineBuffer: string = '';

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    public start() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, '');
        }

        const stats = fs.statSync(this.filePath);
        this.fileOffset = stats.size;

        // Use watchFile instead of watch for guaranteed polling on appended logs
        fs.watchFile(this.filePath, { interval: 1000 }, (curr, prev) => {
            if (curr.size !== prev.size || curr.mtimeMs !== prev.mtimeMs) {
                console.log("[DEBUG OTel] File changed event fired.");
                this.readIncremental();
            }
        });

        console.log(`[CodexLog OTel] Watching Copilot OTel log file: ${this.filePath}`);
    }

    private readIncremental() {
        try {
            const stats = fs.statSync(this.filePath);

            // Handle file truncation or reset
            if (stats.size < this.fileOffset) {
                this.fileOffset = stats.size;
                return;
            }
            if (stats.size === this.fileOffset) {
                return;
            }

            const stream = fs.createReadStream(this.filePath, {
                start: this.fileOffset,
                end: stats.size,
                encoding: 'utf8'
            });

            let newChunk = '';
            stream.on('data', (chunk) => { newChunk += chunk; });
            stream.on('end', () => {
                this.fileOffset = stats.size;

                const fullText = this.lineBuffer + newChunk;
                const lines = fullText.split('\n');
                this.lineBuffer = lines.pop() || ''; // Preserve incomplete trailing line

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const parsed = JSON.parse(trimmed);
                        this.processSpan(parsed);
                    } catch (e) {
                        // Skip partial or non-JSON log lines
                    }
                }
            });
        } catch (err) {
            console.error('[CodexLog OTel] Error reading OTel log file:', err);
        }
    }

    private static readonly EDIT_LIKE_TOOL_NAME = /\b(edit|replace|write|patch|insert|apply)(?:_(file|changes|edit|patch|snippet))?\b/i; // Heuristic regex to identify tool calls that likely result in code edits

    private processSpan(rec: any) {
        console.log("[DEBUG OTel] Processing span:", rec.attributes?.['event.name']);
        if ('scopeMetrics' in rec) { // This is a metrics record, not a span — ignore it
            return;
        }

        const attrs: Record<string, any> = rec.attributes;
        const eventName: string | undefined = attrs['event.name'];
        if (!eventName) {
            return;
        } 

        if (eventName === 'copilot_chat.edit.hunk.action') {
            registerPendingAiInsertion();
            if (String(attrs['outcome']).toLowerCase() === 'accepted') {
                this.logAcceptance(rec, {
                    source: eventName,
                    file: attrs['copilot_chat.file.relative_path'],
                    language: attrs['language_id'],
                    lineCount: attrs['line_count'],
                    linesAdded: attrs['lines_added'],
                    linesRemoved: attrs['lines_removed'],
                });
            }
            return;
        }
 
        if (eventName === 'copilot_chat.edit.survival') {
            return;
        }

        // Only proceed if it is an actual edit action (e.g., tool call success)
        if (eventName !== 'copilot_chat.tool.call') {
            return;
        }

        if (eventName === 'copilot_chat.tool.call') {
            const toolName = String(attrs['gen_ai.tool.name'] ?? '');
            const succeeded = attrs['success'] === true;

            console.log(`[DEBUG OTel] TOOL CALL FIRED! Name: "${toolName}", Success:`, succeeded);

            if (succeeded && CopilotOtelFileWatcher.EDIT_LIKE_TOOL_NAME.test(toolName)) {
                registerPendingAiInsertion();
                this.logAcceptance(rec, { source: eventName, toolName });
            }
            return;
        }
 
        // Confirmed-real but not yet mapped to anything (session.start,
        // agent.turn, inference.operation.details) — not silently dropped,
        // logged generically for later inspection.
        console.log(`[CodexLog OTel] Unmapped event.name: ${eventName}`, attrs);

    }
    

    private logAcceptance(rec: any, mapped: Record<string, any> = {}) {
        const editor = vscode.window.activeTextEditor;

        const file = mapped.file ?? (editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined);
        const language = mapped.language ?? editor?.document.languageId ?? 'unknown';

        if (!file) {
            console.warn('[CodexLog OTel] Acceptance-like signal detected but no active editor — cannot attribute file/line.');
            return;
        }
        
        const startLine = editor?.selection.active.line ?? 0;
        let acceptedText = '';
        try {
            acceptedText = editor ? (editor.document.lineAt(startLine).text ?? '') : '';
        } catch {
            acceptedText = '';
        }

        const spanId: string = 'hunk_acceptance';
 
        onAISuggestionAccepted(file, language, acceptedText, startLine, spanId);
    }

    public stop() {
        fs.unwatchFile(this.filePath);
    } 
}

/**
 * Main entry point called from extension.ts
 */
export async function startCopilotOtelTracking(context: vscode.ExtensionContext) {
    const otelLogPath = path.join(context.globalStorageUri.fsPath, 'copilot-otel-spans.jsonl');

    // Enable Copilot's OTel file exporter settings globally
    const config = vscode.workspace.getConfiguration('github.copilot.chat.otel');
    await config.update('enabled', true, vscode.ConfigurationTarget.Global);
    await config.update('exporterType', 'file', vscode.ConfigurationTarget.Global);
    await config.update('outfile', otelLogPath, vscode.ConfigurationTarget.Global);

    const watcher = new CopilotOtelFileWatcher(otelLogPath);
    watcher.start();

    context.subscriptions.push({
        dispose: () => watcher.stop()
    });
}