import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerPendingAiInsertion, onAISuggestionAccepted } from './activityTracker';

class CopilotOtelFileWatcher {
    private filePath: string;
    private fileOffset: number = 0;
    private watcher: fs.FSWatcher | null = null;
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

        this.watcher = fs.watch(this.filePath, (eventType) => {
            if (eventType === 'change') {
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
                        this.unwrapAndProcess(parsed);
                    } catch (e) {
                        // Skip partial or non-JSON log lines
                    }
                }
            });
        } catch (err) {
            console.error('[CodexLog OTel] Error reading OTel log file:', err);
        }
    }

    /**
     * Unwraps standard OTLP JSON envelopes (resourceLogs/scopeLogs or resourceSpans/scopeSpans)
     * down to individual record items before processing.
     */
    private unwrapAndProcess(rawObj: any) {
        if (rawObj.resourceLogs || rawObj.resourceSpans) {
            const items = rawObj.resourceLogs ?? rawObj.resourceSpans ?? [];
            for (const item of items) {
                const scopes = item.scopeLogs ?? item.scopeSpans ?? [];
                for (const scope of scopes) {
                    const records = scope.logRecords ?? scope.spans ?? [];
                    for (const record of records) {
                        this.processSpan(record);
                    }
                }
            }
        } else {
            // Direct flat JSON record
            this.processSpan(rawObj);
        }
    }

    private processSpan(span: any) {
        const attributes = this.flattenAttributes(span.attributes ?? span.Attributes);

        // Resolve event/span name across standard OTel property locations
        const name: string = 
            span.name ?? 
            span.Name ?? 
            span.body?.stringValue ?? 
            attributes['event.name'] ?? 
            attributes['gen_ai.operation.name'] ?? 
            attributes['code.function'] ?? 
            '';

        const ACCEPTANCE_EVENT_NAMES = new Set([
            'copilot_chat.edit.feedback',      // File-level agent edit accepted/rejected
            'copilot_chat.edit.hunk.action',   // Individual hunk accepted/rejected
            'copilot_chat.inline.done',        // Inline Chat (Ctrl+I) edit accepted/rejected
            'copilot_chat.user.action.count',  // User engagement actions (insert/apply/copy)
        ]);

        const RELEVANT_SPAN_NAMES = new Set([
            'invoke_agent', 
            'chat', 
            'execute_tool', 
            'execute_hook'
        ]);

        const isRelevant = 
            ACCEPTANCE_EVENT_NAMES.has(name) || 
            RELEVANT_SPAN_NAMES.has(name) || 
            name.includes('copilot') || 
            name.includes('inlineChat') || 
            name.includes('edit.survival');

        if (!isRelevant) {
            return;
        }

        // Arm suppression window early to mitigate latency before follow-up edit processing
        registerPendingAiInsertion();

        if (!ACCEPTANCE_EVENT_NAMES.has(name)) {
            return; // Relevant telemetry span, but not a specific acceptance event
        }

        // Check outcome via string keywords or boolean flags
        const outcome = String(
            attributes['outcome'] ?? attributes['action'] ?? attributes['result'] ?? ''
        ).toLowerCase();

        const isAcceptedBool = attributes['accepted'] === true || attributes['accepted'] === 'true';
        const isAcceptance = isAcceptedBool || outcome.includes('accept') || outcome.includes('apply') || outcome.includes('insert');

        if (!isAcceptance) {
            return; // Rejected edit or hunk
        }

        this.logProgSnap2Acceptance(span, attributes);
    }

    private flattenAttributes(attrs: any): Record<string, any> {
        if (!attrs) return {};
        if (!Array.isArray(attrs)) return attrs; // Already a flat key-value object

        const out: Record<string, any> = {};
        for (const attr of attrs) {
            if (!attr || !attr.key) continue;
            const v = attr.value ?? {};
            out[attr.key] = 
                v.stringValue ?? 
                v.intValue ?? 
                v.doubleValue ?? 
                v.boolValue ?? 
                v.bytesValue ?? 
                undefined;
        }
        return out;
    }

    private logProgSnap2Acceptance(span: any, attributes: Record<string, any>) {
        const editor = vscode.window.activeTextEditor;

        // Fallback hierarchy for file path and language
        const file = attributes['file_path'] ?? 
            (editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : 'unknown');
        
        const language = attributes['language_id'] ?? 
            (editor ? editor.document.languageId : 'unknown');

        const startLine = editor ? editor.selection.active.line : 0;

        let acceptedText = '';
        if (editor) {
            try {
                acceptedText = editor.document.lineAt(startLine).text || '';
            } catch {
                acceptedText = '';
            }
        }

        const spanId: string = span.spanId ?? span.TraceId ?? span.spanContext?.()?.spanId ?? 'unknown';

        onAISuggestionAccepted(file, language, acceptedText, startLine, spanId);
    }

    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
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