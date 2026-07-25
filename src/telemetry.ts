// Logs telemetry data about user interactions with the VS Code extension,
// in the ProgSnap2-style schema defined in EVENT_SCHEMA.md / types.ts.
import { TelemetryEvent, EventType, EventSubtype, EventInitiator, EditType, CompileResult, ExecutionResult, SourceLocation, CodeState, CupsState, ProgrammerState } from "./types";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

let LOG_FILE: string | null = null;
let CODE_STATES_FILE: string | null = null;
let STATES_FILE: string | null = null;
let VERIFICATION_BUFFER_FILE: string | null = null;

// --- Session-scoped state, set once in initTelemetry() ----------------------
let SESSION_ID: string | null = null;
let SUBJECT_ID: string | null = null;
let ASSIGNMENT_ID: string | null = null; // set from workspace config in initTelemetry() - see extension.ts
const TOOL_INSTANCE = 'codexlog-vscode/0.3.0';

let orderCounter = 0;                                  // per-session monotonic Order
const lastEventTimeByFile = new Map<string, number>();  // File -> ms timestamp, for X-InterEventDeltaMs

export function initTelemetry(storagePath: string) {
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }
    LOG_FILE = path.join(storagePath, 'telemetry.json');
    CODE_STATES_FILE = path.join(storagePath, 'codeStates.json');
    STATES_FILE = path.join(storagePath, 'programmerStates.json');
    VERIFICATION_BUFFER_FILE = path.join(storagePath, 'verificationBuffer.json');

    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '[]', 'utf-8');
    if (!fs.existsSync(CODE_STATES_FILE)) fs.writeFileSync(CODE_STATES_FILE, '[]', 'utf-8');
    if (!fs.existsSync(STATES_FILE)) fs.writeFileSync(STATES_FILE, '[]', 'utf-8');
    if (!fs.existsSync(VERIFICATION_BUFFER_FILE)) fs.writeFileSync(VERIFICATION_BUFFER_FILE, '[]', 'utf-8');

    SESSION_ID = crypto.randomUUID();
    ASSIGNMENT_ID = ASSIGNMENT_ID ?? null;
    orderCounter = 0;
    lastEventTimeByFile.clear();

    // Pseudonymous, stable-per-machine subject id. Swap this for a real
    // instructor-issued roster ID later — the point for now is that no raw
    // username/email is ever written to the log.
    const seed = `${os_userInfo()}::${os_hostname()}`;
    SUBJECT_ID = 'h_' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
}

function os_userInfo(): string {
    try { return require('os').userInfo().username; } catch { return 'unknown'; }
}
function os_hostname(): string {
    try { return require('os').hostname(); } catch { return 'unknown'; }
}

// --- Reading/writing the Events table ---------------------------------------

function readEvents(): TelemetryEvent[] {
    if (!LOG_FILE) return [];
    try {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')) as TelemetryEvent[];
    } catch {
        return [];
    }
}

function appendEvent(event: TelemetryEvent) {
    if (!LOG_FILE) return;
    const events = readEvents();
    events.push(event);
    fs.writeFileSync(LOG_FILE, JSON.stringify(events, null, 2), 'utf-8');
}

/**
 * Log a telemetry event in the ProgSnap2-style schema.
 *
 * @param type      Controlled-vocabulary EventType (see types.ts)
 * @param subtype   Controlled-vocabulary EventSubtype, or null
 * @param data      Event-specific payload -> becomes X-Data
 * @param opts      Optional linking/context fields
 * @returns the full TelemetryEvent that was written — callers that need to
 *          link a *future* event back to this one (e.g. an AI suggestion
 *          accepted now, reverted later) should hold on to `.EventID`.
 */
export function logTelemetry(
    type: EventType,
    subtype: EventSubtype,
    data: Record<string, any>,
    opts: {
        file?: string;
        language?: string;
        parentEventId?: string;
        codeStateId?: string;
        assignmentId?: string;
        initiator?: EventInitiator;   // defaults to 'UserDirectAction' — override for tool-driven events
        editType?: EditType;
        compileResult?: CompileResult;
        executionResult?: ExecutionResult;
        sourceLocation?: SourceLocation;
    } = {}
): TelemetryEvent {
    if (!LOG_FILE || !SESSION_ID || !SUBJECT_ID) {
        console.warn('Telemetry not initialised — call initTelemetry() first.');
        // Still return a well-formed (if orphaned) event so callers don't need null checks.
    }

    const now = Date.now();
    let interEventDeltaMs: number | null = null;
    if (opts.file) {
        const last = lastEventTimeByFile.get(opts.file);
        interEventDeltaMs = last !== undefined ? now - last : null;
        lastEventTimeByFile.set(opts.file, now);
    }

    const event: TelemetryEvent = {
        EventID: crypto.randomUUID(),
        Order: ++orderCounter,
        SessionID: SESSION_ID ?? 'uninitialised',
        SubjectID: SUBJECT_ID ?? 'uninitialised',
        AssignmentID: opts.assignmentId ?? null,
        ToolInstance: TOOL_INSTANCE,
        ClientTimestamp: new Date(now).toISOString(),
        ServerTimestamp: null,
        EventType: type,
        EventSubtype: subtype,
        EventInitiator: opts.initiator ?? 'UserDirectAction',
        EditType: opts.editType ?? null,
        CompileResult: opts.compileResult ?? null,
        ExecutionResult: opts.executionResult ?? null,
        SourceLocation: opts.sourceLocation ?? null,
        File: opts.file ?? null,
        Language: opts.language ?? null,
        CodeStateID: opts.codeStateId ?? null,
        ParentEventID: opts.parentEventId ?? null,
        'X-InterEventDeltaMs': interEventDeltaMs,
        'X-Data': data,
    };

    console.log('Telemetry Event:', event.EventType, event.EventSubtype ?? '');

    try {
        appendEvent(event);
    } catch (error) {
        console.error('Failed to log telemetry event:', error);
    }

    return event;
}
// --- Identity getters/setters --------------------------------------------

export function getSessionId(): string | null {
    return SESSION_ID;
}
export function setSessionId(id: string): void {
    SESSION_ID = id;
}
 
export function getSubjectId(): string | null {
    return SUBJECT_ID;
}
export function setSubjectId(id: string): void {
    SUBJECT_ID = id;
}
 
export function getAssignmentId(): string | null {
    return ASSIGNMENT_ID;
}
export function setAssignmentId(id: string | null): void {
    ASSIGNMENT_ID = id;
}
 

// --- CodeStates table ---------------------------------------------------------

function readCodeStates(): CodeState[] {
    if (!CODE_STATES_FILE) return [];
    try {
        return JSON.parse(fs.readFileSync(CODE_STATES_FILE, 'utf-8')) as CodeState[];
    } catch {
        return [];
    }
}

/**
 * Store a code snapshot and return its CodeStateID, for use as the
 * `codeStateId` option on a related logTelemetry() call. Only call this at
 * meaningful checkpoints (File.Save, Compile.Error, Run.Program) — not on
 * every keystroke, or this file grows as fast as the old one-table design did.
 */
export function createCodeState(file: string, content: string): string {
    const id = crypto.randomUUID();
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    const state: CodeState = { CodeStateID: id, File: file, Content: content, Diff: null, Hash: hash };

    if (CODE_STATES_FILE) {
        const states = readCodeStates();
        states.push(state);
        fs.writeFileSync(CODE_STATES_FILE, JSON.stringify(states, null, 2), 'utf-8');
    }
    return id;
}

export function getLogFilePath(): string | null {
    return LOG_FILE;
}

export function getVerificationBufferFilePath(): string | null {
    return VERIFICATION_BUFFER_FILE;
}

export function writeVerificationBufferLog(): string | null {
    if (!LOG_FILE || !VERIFICATION_BUFFER_FILE) return null;

    const events = readEvents();

    // sort chronologically by timestamp
    const sortedEvents = [...events].sort((a, b) =>
        new Date(a.ClientTimestamp).getTime() - new Date(b.ClientTimestamp).getTime()
    );

    const acceptances = events.filter(e => e.EventType === 'X-AI.Suggestion.Accepted');
    const results: Array<{
        acceptanceEventId: string;
        file: string;
        acceptedAt: string;
        executedAt: string | null;
        executionEventType: 'Run.Program' | 'Compile' | null;
        bufferMs: number | null;
        bufferSeconds: number | null;
        bufferFormatted: string | null;
    }> = [];

    for (const acceptance of acceptances) {
        const acceptedAtMs = new Date(acceptance.ClientTimestamp).getTime();

        // Fine the FIRST execution event chronologically AFTER this accepctance in the same session
        const execution = events.find(e =>{
            const eventMs = new Date(e.ClientTimestamp).getTime();
            const isAfter = eventMs > acceptedAtMs;
            const isSameSession = !e.SessionID || !acceptance.SessionID || e.SessionID === acceptance.SessionID;
            const isSameFile = !e.File || !acceptance.File || e.File === acceptance.File;
            const isExecution = (
                e.EventType === 'Run.Program' ||
                e.EventType === 'Compile' ||
                e.EventType === 'X-Debug.Start' ||
                e.EventType === 'X-Diagnostics.Check'
            );
            return isAfter && isSameSession && isSameFile && isExecution;
        }
        );

        const executedAtMs = execution ? new Date(execution.ClientTimestamp).getTime() : null;
        const bufferMs = executedAtMs !== null ? Math.max(0, executedAtMs - acceptedAtMs) : null;
        const bufferSeconds = bufferMs !== null ? Math.round((bufferMs / 1000) * 100) / 100 : null;
        
        results.push({
            acceptanceEventId: acceptance.EventID,
            file: acceptance.File ?? 'unknown',
            acceptedAt: acceptance.ClientTimestamp,
            executedAt: execution?.ClientTimestamp ?? null,
            executionEventType: execution ? (execution.EventType as 'Run.Program' | 'Compile') : null,
            bufferMs: bufferMs,
            bufferSeconds: bufferSeconds,
            bufferFormatted: bufferSeconds !== null ? `${bufferSeconds}s` : null,
        });
    }

    fs.writeFileSync(VERIFICATION_BUFFER_FILE, JSON.stringify(results, null, 2), 'utf-8');
    return VERIFICATION_BUFFER_FILE;
}

// --- ProgrammerStates table (CUPS-inspired behavioral layer) ----------------

function readStates(): ProgrammerState[] {
    if (!STATES_FILE) return [];
    try {
        return JSON.parse(fs.readFileSync(STATES_FILE, 'utf-8')) as ProgrammerState[];
    } catch {
        return [];
    }
}

/**
 * Persist a *closed* behavioral state segment. Called by cupsStateTracker.ts
 * whenever a rule decides the current state has ended — never on every raw
 * event, only on transitions. StartEventID/EndEventID must be real EventIDs
 * from the Events table, so a segment can always be traced back to exactly
 * the events that opened and closed it.
 */
export function recordClosedState(
    state: CupsState,
    file: string | null,
    startEventId: string,
    startTime: string,
    endEventId: string | null,
    endTime: string | null
): ProgrammerState {
    const entry: ProgrammerState = {
        StateID: crypto.randomUUID(),
        SessionID: SESSION_ID ?? 'uninitialised',
        SubjectID: SUBJECT_ID ?? 'uninitialised',
        File: file,
        State: state,
        StartEventID: startEventId,
        EndEventID: endEventId,
        StartTime: startTime,
        EndTime: endTime,
        DurationMs: endTime ? new Date(endTime).getTime() - new Date(startTime).getTime() : null,
    };

    if (STATES_FILE) {
        const states = readStates();
        states.push(entry);
        fs.writeFileSync(STATES_FILE, JSON.stringify(states, null, 2), 'utf-8');
    }
    return entry;
}

// Single source of truth for "is this document one of our own telemetry files?"
// Any listener on document events should call this first and bail out if true —
// otherwise writes to our own log/code-state files look like user edits and
// trigger another write, forever. See the activityTracker.ts / sessionTracker.ts
// fix history for why this matters.
export function isTelemetryLogDocument(uri: vscode.Uri): boolean {
    return (LOG_FILE !== null && uri.fsPath === LOG_FILE)
        || (CODE_STATES_FILE !== null && uri.fsPath === CODE_STATES_FILE)
        || (STATES_FILE !== null && uri.fsPath === STATES_FILE)
        || (VERIFICATION_BUFFER_FILE !== null && uri.fsPath === VERIFICATION_BUFFER_FILE);
}
