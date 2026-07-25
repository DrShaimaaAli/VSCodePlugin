// analysis/verificationBuffer.ts
//
// Contribution 1: "Verification Buffer" (Time-to-Execution Delta)
//
// For every X-AI.Suggestion.Accepted event, finds the *next* execution event
// on the same file and computes the delta — how long the student waited
// after accepting a suggestion before actually running it. This is a pure
// analysis-layer query: both endpoints (acceptance, execution) are already
// logged by the extension, so no new instrumentation is needed.
//
// "Execution" is defined primarily as Run.Program (an explicit run command —
// the strongest signal that the student actually tested the code), with
// Compile (a real build-task run) as a secondary/fallback signal, since a
// build without a run is a weaker but still meaningful verification step.

import * as fs from 'fs';
import { isTelemetryLogDocument } from './telemetry';

interface TelemetryEventLike {
    EventID: string;
    Order: number;
    SessionID?: string; // <--- Added SessionID here
    EventType: string;
    File: string | null;
    ClientTimestamp: string;
}

interface VerificationBufferResult {
    acceptanceEventId: string;
    file: string;
    acceptedAt: string;
    executedAt: string | null;
    executionEventType: 'Run.Program' | 'Compile' | null;
    bufferMs: number | null; // null if no execution ever followed
    bufferSeconds: number | null;
    bufferFormatted: string | null;
}

/**
 * List of specific internal state/telemetry JSON files to ignore.
 */
const IGNORED_STATE_FILES = [
    'verificationbuffer.json',
    'codeStates.json',
    'programmerStates.json',
];

/**
 * Checks if a file path belongs to one of the internal extension state files.
 */
function isIgnoredStateFile(filePath: string | null): boolean {
    if (!filePath) return false;
    const normalizedPath = filePath.toLowerCase();
    
    return IGNORED_STATE_FILES.some(ignoredFile => normalizedPath.endsWith(ignoredFile));
}

/**
 * Compute the Verification Buffer for every AI-suggestion acceptance in a
 * telemetry log.
 *
 * @param logPath path to telemetry.json
 */
export function computeVerificationBuffers(logPath: string): VerificationBufferResult[] {
    const events: TelemetryEventLike[] = JSON.parse(fs.readFileSync(logPath, 'utf-8'));

    // Sort by Order to guarantee we scan forward in real session order.
    const sorted = [...events].sort((a, b) => new Date(a.ClientTimestamp).getTime() - new Date(b.ClientTimestamp).getTime());
   // Filter acceptances with guard for specific internal state JSON files
    const acceptances = sorted.filter(e => {
        if (e.EventType !== 'X-AI.Suggestion.Accepted') return false;
        if (!e.File) return false;
        
        // Guard: Ignore specific state log files (verificationBuffer.json, cupsState.json, programmerState.json)
        if (isIgnoredStateFile(e.File)) return false;

        return true;
    });
    const results: VerificationBufferResult[] = [];

    for (const acceptance of acceptances) {
        const acceptedAtMs = new Date(acceptance.ClientTimestamp).getTime();

        // Find the next Run.Program on the same file, after this acceptance.
        const execution = sorted.find(e =>{
            const eventMs = new Date(e.ClientTimestamp).getTime();
            const isAfter = eventMs > acceptedAtMs;
            const isSameSession = !e.SessionID || !acceptance.SessionID || e.SessionID === acceptance.SessionID;
            const isSameFile = !e.File || !acceptance.File || e.File === acceptance.File;
            const isExecution = (
                e.EventType === 'Run.Program' ||
                e.EventType === 'Compile' ||
                e.EventType === 'X-Debug.Start'
                //e.EventType === 'X-Diagnostics.Check'
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
            bufferMs,
            bufferSeconds,
            bufferFormatted: bufferSeconds !== null ? `${bufferSeconds}s` : null,
        });
    }

    return results;
}

/**
 * Summary stats across all acceptances in a session — useful for the
 * headline number in a presentation ("median verification buffer: Xs").
 */
export function summarizeVerificationBuffers(results: VerificationBufferResult[]) {
    const withBuffer = results
        .map(r => r.bufferMs)
        .filter((ms): ms is number => ms !== null)
        .sort((a, b) => a - b);

    const neverExecuted = results.length - withBuffer.length;

    if (withBuffer.length === 0) {
        return { count: results.length, neverExecuted, medianMs: null, meanMs: null, minMs: null, maxMs: null };
    }

    const mid = Math.floor(withBuffer.length / 2);
    const medianMs = withBuffer.length % 2 === 0
        ? (withBuffer[mid - 1] + withBuffer[mid]) / 2
        : withBuffer[mid];
    const meanMs = withBuffer.reduce((a, b) => a + b, 0) / withBuffer.length;

    return {
        count: results.length,
        neverExecuted, // acceptances that were never followed by a run/compile at all — "blind trust" cases with no verification whatsoever
        medianMs,
        meanMs,
        minMs: withBuffer[0],
        maxMs: withBuffer[withBuffer.length - 1],
    };
}