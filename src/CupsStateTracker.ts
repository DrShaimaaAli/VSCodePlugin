// A rule-based classifier that turns the raw Events stream into CUPS-inspired
// behavioral states. This is the "behavioral layer" of the telemetry system, which
// allows us to reason about the user's behavior in terms of higher-level states rather
// than just raw events. The CUPS model is a well-known framework for understanding
// user behavior in interactive systems, and this implementation adapts it to the context
// of a VSCode extension that tracks coding activity.

import {CupsState} from  './types';
import {recordClosedState} from './telemetry';

interface OpenState {
    state: CupsState;
    file: string | null;
    startEventId: string;
    startTime: string;
}

let current: OpenState | null = null; // Tracks the currently open behavioral state, if any

// Core transition logic: close out the current segment
// and open a new one. Called by every rule below
// never call this directly from the tracker, always go throug ha named rule
// the the mapping from 'raw event' to 'why this state' stays legible
function transition(newState: CupsState, file: string | null, eventId: string, time: string) {
    if(current && current.state === newState) {
        // Same state just touched a different/same file
        // Duration gets computed whenever this segment eventually does close
        return; 
    }
    if (current) {
        recordClosedState(current.state, current.file, current.startEventId, current.startTime, eventId, time);
    }
    current = {
        state: newState,
        file,
        startEventId: eventId,
        startTime: time
    };
}

// Rules, one per meaningful trigger

// Rule: accepting an AI suggestion starts a 'verifying' period 
// we assume the next few seconds are spent reading and verifying the suggestion, and not actively coding
export function onAISuggestionAccepted(file: string, eventId: string, time: string) {
    transition('VerifyingSuggestion', file, eventId, time);
}

// Rule: if the student edits/undoes code while we wre in VerifyingSuggestion,
// we assume they are actively correcting the suggestion,
export function onEditDuringOrAfterSuggestion(file: string, eventId: string, time: string) {
    if (current?.state === 'VerifyingSuggestion') {
        transition('EditingSuggestion', file, eventId, time);
    } else {
        transition('WritingNewCode', file, eventId, time);
    }
}

// Rule: a plain typed edit with no AI context nearby is just ... writing code.
export function onGenericEdit(file: string, eventId: string, time: string) {
    if (current?.state === 'DebuggingTesting') {
        return; // a stray edit mid-debug doesn't necessarily end debugging
    }
    transition('WritingNewCode', file, eventId, time);
}

// Rule: running the program, or a compile error appearing/persisting, means 
// the student is now debuggin/testing - regardless of what they were doing before.
export function onIdleOrFocusLost(eventId: string, time: string) {
    transition('Idle', current?.file ?? null, eventId, time);
}

// Lets callers check 'would loggging this edit actually change anything' before
// deciding to emit a File.Edit event at all - keeps event volume bounded to
// transition boundaries instead of every keystroke
export function getCurrentState(): CupsState | null {
    return current?.state ?? null;
}

// Called on Session.End so the final open segment doesn't get lost
export function closeCurrentState() {
    if (current) {
        const now = new Date().toISOString();
        recordClosedState(current.state, current.file, current.startEventId, current.startTime, null, now);
        current = null;
    }
}