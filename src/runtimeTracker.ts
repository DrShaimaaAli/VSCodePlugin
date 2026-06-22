// runtimeTracker.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from 'child_process';
import { logTelemetry } from './telemetry';

const RUNTIME_MAP: Record<string, string> = {
    'py': 'python3',
    'js': 'node',
    'ts': 'ts-node',
};

interface StackFrame {
    file: string;
    line: number;
    functionName: string;
    code: string;
}

function parseStackTrace(stderr: string): {
    frames: StackFrame[];
    errorType: string;
    errorMessage: string;
    raw: string;
} {
    const lines = stderr.split('\n').map(l => l.trim());
    const frames: StackFrame[] = [];
    const framePattern = /File "(.+)", line (\d+), in (.+)/;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(framePattern);
        if (match) {
            frames.push({
                file: match[1],
                line: parseInt(match[2]),
                functionName: match[3],
                code: lines[i + 1] ?? '',
            });
        }
    }

    const lastLine = lines.filter(l => l.length > 0).pop() ?? '';
    const [errorType, ...rest] = lastLine.split(':');

    return {
        frames,
        errorType: errorType.trim(),
        errorMessage: rest.join(':').trim(),
        raw: stderr,
    };
}

export function runAndTrackErrors(filePath: string, language: string) {
    if (!fs.existsSync(filePath)) {
        logTelemetry('runtimeSkipped', { reason: 'file not found', filePath });
        return;
    }

    const extension = filePath.split('.').pop() ?? '';
    const runtime = RUNTIME_MAP[extension];
    if (!runtime) {
        logTelemetry('runtimeUnsupported', { filePath, extension });
        return;
    }

    exec(`${runtime} "${filePath}"`, { timeout: 5000 }, (error, stdout, stderr) => {
        if (error?.killed) {
            logTelemetry('runtimeTimeout', { filePath, timeoutMs: 5000 });
            return;
        }

        if (!error) {
            logTelemetry('runtimeSuccess', { filePath, language });
            return;
        }

        const { frames, errorType, errorMessage, raw } = parseStackTrace(stderr);

        logTelemetry('runtimeError', {
            filePath,
            language,
            exitCode: error.code,
            errorType,
            errorMessage,
            frameCount: frames.length,
            stackFrames: frames,
            rawStderr: raw,
        });
    });
}