// Creates shared types for the extension, such as telemetry event names and data structures
// This allows for better type safety and consistency across the extension's codebase

export interface TelemetryEvent {
    event: string; // The name of the telemetry event, used for categorization and analysis
    timestamp: string; // The ISO string representation of the event's occurrence time, useful for time-based analysis
    data: Record<string, any>; // Additional data associated with the event, which can include details about the user's actions or environment
}