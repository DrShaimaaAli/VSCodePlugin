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

interface TelemetryEventLike {
    EventID: string;
    Order: number;
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
    const sorted = [...events].sort((a, b) => a.Order - b.Order);

    const acceptances = sorted.filter(e => e.EventType === 'X-AI.Suggestion.Accepted');
    const results: VerificationBufferResult[] = [];

    for (const acceptance of acceptances) {
        const acceptedAtMs = new Date(acceptance.ClientTimestamp).getTime();

        // Find the next Run.Program on the same file, after this acceptance.
        const nextRun = sorted.find(e =>
            e.Order > acceptance.Order &&
            e.File === acceptance.File &&
            e.EventType === 'Run.Program'
        );

        // Fallback: the next Compile (real build task), if no run ever happened.
        const nextCompile = sorted.find(e =>
            e.Order > acceptance.Order &&
            e.File === acceptance.File &&
            e.EventType === 'Compile'
        );

        const execution = nextRun ?? nextCompile ?? null;

        results.push({
            acceptanceEventId: acceptance.EventID,
            file: acceptance.File ?? 'unknown',
            acceptedAt: acceptance.ClientTimestamp,
            executedAt: execution?.ClientTimestamp ?? null,
            executionEventType: execution ? (execution.EventType as 'Run.Program' | 'Compile') : null,
            bufferMs: execution ? new Date(execution.ClientTimestamp).getTime() - acceptedAtMs : null,
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