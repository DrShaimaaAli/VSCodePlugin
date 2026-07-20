// Creates shared types for the extension, such as telemetry event names and data structures
// This allows for better type safety and consistency across the extension's codebase

// Adopts sever fields directly from the ProgSnap2 telemetry schema, ensuring compatibility with the existing telemetry infrastructure and data analysis tools

// --- Controlled Vocabulary for Telemetry Event Names ---
// Types without an "X-" prefix

export type EventType = 
    | 'Session.Start'
    | 'Session.End'
    | 'X-Session.Idle.Start'
    | 'X-Session.Idle.End'
    | 'X-Environment.Snapshot'
    | 'X-Workspace.Folders.Changed'
    | 'File.Open'
    | 'File.Close'
    | 'File.Edit'
    | 'File.Save'
    | 'X-Diagnostics.Check' // renamed from misuse of 'Compile'
    | 'X-AI.Suggestion.SurvivalCheck'
    | 'Compile'
    | 'Run.Program'
    | 'X-AI.Suggestion.Accepted'
    | 'X-AI.Suggestion.Reverted'
    | 'X-AI.Suggestion.SurvivalCheck' // continuous 0-1 similarity score, inspired by Copilot's own edit.Survival. * OTel metrics
    | 'X-AI.Suggestion.Idle'
    | 'X-Error.Introduced'
    | 'X-Error.Resolved'
    | 'X-Error.Persisted'
    | 'X-Debug.Start'
    | 'X-Debug.End'
    | 'X-Focus.Lost'
    | 'X-Focus.Gained';

export type EventSubtype = // General purpose subtype field for telemetry events, allowing for more granular categorization of events within the same event type (e.g., AI-revert extent)
    | 'Partial'
    | 'Full'
    | null

// Who/what caused the event
// This field helps identify the source of the event, 
// (e.g., user action, system process, or external tool), which can be useful for debugging and understanding user behavior
export type EventInitiator = 
    | 'UserDirectAction' // the student did this directly (typed, saved, ran code)
    | 'ToolReaction' // the tool did this automatically in response to a user action
    | 'ToolTimedEvent'; // the tool did this on a timer, with no direct trigger

export type EditType = 
    | 'Insert'
    | 'Delete' 
    | 'Replace' 
    | 'Paste' 
    | 'Undo' 
    | 'Redo' 
    | 'Refactor' 
    | 'Reset'
    | null;

export type CompileResult =
    | 'Success'
    | 'Warning'
    | 'Error'
    | 'Timeout'
    | null;

export type ExecutionResult = 
    | 'Success'
    | 'Error'
    | 'Timeout'
    | 'TestFailed'
    | null

// Where in the file something happens - promoted out of X-Data so it's
// queryable without parsing the JSON payload
export interface SourceLocation {
    startLine: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
}

// --- Table 1: Events (MainTable) -----------------------------------------------------------------------------------------

export interface TelemetryEvent {
    EventID: string;                 // uuid
    Order: number;                   // monotonically increasing per session
    SessionID: string;
    SubjectID: string;               // pseudonymized (hashed) student id — never a real username/email
    AssignmentID: string | null;
    ToolInstance: string;            // e.g. "codexlog-vscode/0.3.0"
    ClientTimestamp: string;         // ISO 8601
    ServerTimestamp: string | null;  // set by backend on ingest, not the client
    EventType: EventType;
    EventSubtype: EventSubtype;
    EventInitiator: EventInitiator;
    EditType: EditType;
    CompileResult: CompileResult;
    ExecutionResult: ExecutionResult;
    SourceLocation: SourceLocation | null;
    File: string | null;             // workspace-relative path — never absolute
    Language: string | null;
    CodeStateID: string | null;      // FK into CodeStates, null if no snapshot applies
    ParentEventID: string | null;    // links e.g. X-Error.Resolved -> X-Error.Introduced
    'X-InterEventDeltaMs': number | null; // ms since previous event in the same file
    'X-Data': Record<string, any>;   // event-specific payload not covered by a named column
}

// --- Table 2: CodeStates --------------------------------------------------

export interface CodeState {
    CodeStateID: string;
    File: string;
    Content: string | null;
    Diff: string | null;
    Hash: string;
}

export interface ErrorIntroductionData {
    message: string;
    source: string;
}

export interface ErrorResolvedData {
    resolvedAfterMs: number;
    savesSinceIntroduced: number;
}

export interface RunProgramData {
    exitCode?: number | null;
    errorType?: string;
    errorMessage?: string;
    frameCount?: number;
}

export interface AiSuggestionData {
    inserteeLines: number;
    insertedChars: number;
}

export type CupsState = 
    | 'WritingNewCode'
    | 'VerifyingSuggestion'
    | 'EditingSuggestion'
    | 'PromptCrafting'
    | 'DebuggingTesting'
    | 'Idle'

export interface ProgrammerState {
    StateID: string;
    SessionID: string;
    SubjectID: string;
    File: string | null;
    State: CupsState;
    StartEventID: string;         // FK into Events — the event that triggered entry into this state
    EndEventID: string | null;    // FK into Events — the event that triggered the next transition; null if still open
    StartTime: string;            // ISO 8601
    EndTime: string | null;       // ISO 8601, null if still open
    DurationMs: number | null;    // null while open
}
 