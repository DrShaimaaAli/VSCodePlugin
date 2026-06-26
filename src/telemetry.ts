// logs telemetry data about user interactions with the VS Code extension, 
// such as edits and saves, to help analyze usage patterns and improve the extension's features
import { TelemetryEvent } from "./types";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';


// Store log file in the user's home directory under a dedicated folder
// This ensures it's always writable regardless of where the extension is installed
const LOG_DIR = path.join(os.homedir(), '.codexlog');
const LOG_FILE = path.join(LOG_DIR, 'telemetry.json');

function ensureLogFiles(){
	// Create the directory if it doesn't exist
	if (!fs.existsSync(LOG_DIR)) {
		fs.mkdirSync(LOG_DIR, { recursive: true });
	}
	// Create the file with an empty array if it doesn't exist
	if (!fs.existsSync(LOG_FILE)) {
		fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2), 'utf-8');
	}
}

function readEvents(): TelemetryEvent[] {
	try {
		const raw = fs.readFileSync(LOG_FILE, 'utf-8');
		return JSON.parse(raw) as TelemetryEvent[];
	} catch {
		// If the file doesn't exist or is corrupted, return an empty array
		return [];
	}
}

function appendEvent(event: TelemetryEvent) {
    // Read current content, strip the closing ], append new entry, re-close
    const raw = fs.readFileSync(LOG_FILE, 'utf-8').trim();
    const isFirstEntry = raw === '[]';
    const newEntry = JSON.stringify(event, null, 2);
    const updated = isFirstEntry
        ? `[\n${newEntry}\n]`
        : `${raw.slice(0, -1)},\n${newEntry}\n]`;
    fs.writeFileSync(LOG_FILE, updated, 'utf-8');
}

// Creating a reusable function to log telemetry events
// standardizing the format of telemetry data for better analysis
export 	function logTelemetry(eventName: string, data: any) {
	const payload = {
		event: eventName,
		timestamp: new Date().toISOString(),
		data
	};
	console.log('Telemetry Event:', JSON.stringify(payload));

	try {
		ensureLogFiles();
		appendEvent(payload);
	} catch(error) {
		console.error('Failed to log telemetry event:', error);
	}
}

export function getLogFilePath(): string {
	return LOG_FILE;
}