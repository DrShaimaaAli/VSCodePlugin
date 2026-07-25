import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { initTelemetry, logTelemetry, writeVerificationBufferLog } from '../telemetry';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('writes verification buffer data to a separate log file', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexlog-test-'));
		initTelemetry(tempDir);

		const acceptedEvent = logTelemetry('X-AI.Suggestion.Accepted', null, { insertedChars: 120 }, { file: 'demo.py' });
		logTelemetry('Run.Program', null, { executionResult: 'Success' }, { file: 'demo.py' });

		const outputPath = writeVerificationBufferLog();
		assert.ok(outputPath);

		const payload = JSON.parse(fs.readFileSync(outputPath!, 'utf8'));
		assert.strictEqual(payload.length, 1);
		assert.strictEqual(payload[0].acceptanceEventId, acceptedEvent.EventID);
		assert.ok(payload[0].bufferMs === null || payload[0].bufferMs >= 0);
	});
});
