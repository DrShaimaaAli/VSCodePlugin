// logs telemetry data about user interactions with the VS Code extension, 
// such as edits and saves, to help analyze usage patterns and improve the extension's features
import { TelemetryEvent } from "./types";
import * as fs from 'fs';
import * as path from 'path';

// Define the directory and file path for storing telemetry logs
let LOG_FILE: string | null = null;

// Initialize the telemetry logging system by setting up the log file path and ensuring the necessary directories exist
export function initTelemetry(storagePath: string) {
	if (!fs.existsSync(storagePath)) {
		fs.mkdirSync(storagePath, { recursive: true });
  	}
    LOG_FILE = path.join(storagePath, 'telemetry.json');
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, '[]', 'utf-8');
    }
}

function readEvents(): TelemetryEvent[] {
 	if (!LOG_FILE) return [];
    try {
        const raw = fs.readFileSync(LOG_FILE, 'utf-8');
        return JSON.parse(raw) as TelemetryEvent[];
    } catch {
        return [];
    }
}

function appendEvent(event: TelemetryEvent) {
    if (!LOG_FILE) return;
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

    if (!LOG_FILE) {
        console.warn('Telemetry not initialised — call initTelemetry() first.');
        return;
    }

    try {
        appendEvent(payload);
    } catch (error) {
        console.error('Failed to log telemetry event:', error);
    }
}

export function getLogFilePath(): string | null {
	return LOG_FILE;
}