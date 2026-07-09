// runtimeTracker.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import {execSync} from 'child_process';
import { logTelemetry } from './telemetry';

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

function getRuntimeCommand(extension: string): string | null { // checks if the runtime for the given file extension is available on the system PATH and returns the command to invoke it, or null if not found
    const isWindows = os.platform() === 'win32';

    const candidates: Record<string, string[]> = {
        'py': isWindows ? ['python', 'python3'] : ['python3', 'python'],
        'js': ['node'],
        'ts': ['ts-node'],
    };

    const options = candidates[extension];
    if (!options) return null;

    // Try each candidate and return the first one that exists on PATH
    for (const cmd of options) {
        try {
            execSync(`${cmd} --version`, { stdio: 'ignore' });
            return cmd; // this one works
        } catch {
            continue; // not found, try next
        }
    }

    return null; // nothing found
}

export function runAndTrackErrors(filePath: string, language: string) {
    if (!fs.existsSync(filePath)) {
        logTelemetry('runtimeSkipped', { reason: 'file not found', filePath });
        return;
    }

    const extension = filePath.split('.').pop() ?? '';
    const runtime = getRuntimeCommand(extension);
    if (!runtime) {
        // Specific message for missing Python on Windows
        logTelemetry('runtimeUnsupported', {
            filePath,
            extension,
            reason: 'runtime not found on PATH',
            platform: os.platform(),
        });
        vscode.window.showErrorMessage(
            `No runtime found for .${extension} files. Make sure Python is installed and added to PATH.`
        );
        return;
    }

    exec(`"${runtime}" "${filePath}"`, { timeout: 5000 }, (error, stdout, stderr) => {
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