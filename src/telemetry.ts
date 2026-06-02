// logs telemetry data about user interactions with the VS Code extension, 
// such as edits and saves, to help analyze usage patterns and improve the extension's features
import { TelemetryEvent } from "./types";
import time from "console";

// Creating a reusable function to log telemetry events
// standardizing the format of telemetry data for better analysis
export 	function logTelemetry(eventName: string, data: any) {
		const payload = {
			event: eventName,
			timestamp: new Date().toISOString(),
			data
		};
		console.log('Telemetry Event:', JSON.stringify(payload));

	}