import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

async function main() {
	const root = resolve(import.meta.dirname, '..');
	const built = await build({
		stdin: {
			contents: `
import { schematicCommands } from '../src/commands/schematic.ts'
import { pcbCommands } from '../src/commands/pcb.ts'
import { executeCommand, registerCommand } from '../src/engine/registry.ts'
export { schematicCommands, pcbCommands, executeCommand, registerCommand }
`,
			resolveDir: resolve(root, 'test'),
			sourcefile: 'netlist-import-outcome-regression-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
	const { schematicCommands, pcbCommands, executeCommand, registerCommand } = await import(moduleUrl);
	const schematic = name => schematicCommands.find(item => item.name === name);
	const pcb = name => pcbCommands.find(item => item.name === name);
	let checks = 0;
	async function check(name, fn) {
		await fn();
		checks++;
		console.log(`PASS ${name}`);
	}

	const file = () => new Blob(['netlist'], { type: 'application/octet-stream' });

	await check('schematic and PCB netlist exporters accept nonempty blobs and reject missing, empty, or rejected results', async () => {
		for (const [apiName, command] of [
			['sch_ManufactureData', schematic('schematic.exportNetlist')],
			['pcb_ManufactureData', pcb('pcb.exportNetlist')],
		]) {
			globalThis.eda = { [apiName]: { getNetlistFile: async () => file() } };
			const result = await command.handler({}, {});
			assert.ok(result.size > 0);
			assert.ok(result.base64.length > 0);
			for (const resultValue of [undefined, new Blob([])]) {
				globalThis.eda = { [apiName]: { getNetlistFile: async () => resultValue } };
				await assert.rejects(() => command.handler({}, {}), /网表导出失败/);
			}
			globalThis.eda = { [apiName]: { getNetlistFile: async () => {
				throw new Error('sdk export failed');
			} } };
			await assert.rejects(() => command.handler({}, {}), /sdk export failed/);
		}
	});

	await check('schematic getNetlist rejects empty and whitespace-only output', async () => {
		for (const text of ['', ' \t\r\n ']) {
			globalThis.eda = { sch_Netlist: { getNetlist: async () => text } };
			await assert.rejects(() => schematic('schematic.getNetlist').handler({}, {}), /非字符串或空/);
		}
		globalThis.eda = { sch_Netlist: { getNetlist: async () => 'net' } };
		assert.equal((await schematic('schematic.getNetlist').handler({}, {})).netlist, 'net');
	});

	function pcbFocus(currentUuid = 'pcb-A') {
		return {
			dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ documentType: 3, uuid: currentUuid() }) },
		};
	}
	const importHandler = pcb('pcb.importChanges').handler;

	await check('importChanges true remains pending and nonretryable until content verification', async () => {
		let calls = 0;
		globalThis.eda = { ...pcbFocus(() => 'pcb-A'), pcb_Document: { importChanges: async () => {
			calls++;
			return true;
		} } };
		const error = await importHandler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.documentUuid, 'pcb-A');
		assert.equal(error.cause?.sdkResult, true);
		assert.equal(error.cause?.outcome, 'pending-verification');
		assert.equal(error.cause?.importRequested, true);
		assert.equal(error.cause?.contentsVerified, false);
		assert.equal(error.cause?.completionVerified, false);
		assert.equal(calls, 1);
	});

	await check('importChanges false and undefined are partial, nonretryable outcomes after one call', async () => {
		for (const outcome of [false, undefined]) {
			let calls = 0;
			globalThis.eda = { ...pcbFocus(() => 'pcb-A'), pcb_Document: { importChanges: async () => {
				calls++;
				return outcome;
			} } };
			const error = await importHandler({}, {}).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(error.cause?.partial, true);
			assert.equal(error.cause?.retryable, false);
			assert.equal(error.cause?.documentUuid, 'pcb-A');
			assert.equal(error.cause?.sdkResult, outcome === undefined ? 'undefined' : false);
			assert.equal(error.cause?.outcome, outcome === undefined ? 'undefined' : 'sdk-false');
			assert.equal(error.cause?.imported, undefined);
			assert.equal(calls, 1);
		}
		let calls = 0;
		let markerWrites = 0;
		registerCommand(pcb('pcb.importChanges'));
		registerCommand({
			name: 'test.importFalseMarker',
			summary: 'marker',
			params: [],
			returns: '{}',
			handler: async () => {
				markerWrites++;
				return {};
			},
		});
		globalThis.eda = { ...pcbFocus(() => 'pcb-A'), pcb_Document: { importChanges: async () => {
			calls++;
			return false;
		} } };
		const macro = await executeCommand({ cmd: 'macro', params: { stopOnError: false, steps: [
			{ cmd: 'pcb.importChanges', params: {} },
			{ cmd: 'test.importFalseMarker', params: {} },
		] } });
		assert.equal(macro.ok, false);
		assert.equal(macro.data.stoppedReason, 'partial');
		assert.equal(macro.data.steps[0].error.cause.partial, true);
		assert.equal(macro.data.unexecutedSteps, 1);
		assert.equal(markerWrites, 0);
		assert.equal(calls, 1);
	});

	await check('SDK true after simulated source change still marks partial and blocks later writes', async () => {
		let simulatedContentChanged = false;
		let importCalls = 0;
		let markerWrites = 0;
		registerCommand(pcb('pcb.importChanges'));
		registerCommand({
			name: 'test.importTrueMarker',
			summary: 'marker',
			params: [],
			returns: '{}',
			handler: async () => {
				markerWrites++;
				return {};
			},
		});
		globalThis.eda = {
			...pcbFocus(() => 'pcb-A'),
			pcb_Document: {
				importChanges: async () => {
					importCalls++;
					simulatedContentChanged = true;
					return true;
				},
			},
		};
		const macro = await executeCommand({ cmd: 'macro', params: {
			stopOnError: false,
			steps: [
				{ cmd: 'pcb.importChanges', params: {} },
				{ cmd: 'test.importTrueMarker', params: {} },
			],
		} });
		assert.equal(simulatedContentChanged, true);
		assert.equal(macro.ok, false);
		assert.equal(macro.data.stoppedReason, 'partial');
		assert.equal(macro.data.steps[0].error.cause.sdkResult, true);
		assert.equal(macro.data.steps[0].error.cause.outcome, 'pending-verification');
		assert.equal(macro.data.steps[0].error.cause.contentsVerified, false);
		assert.equal(macro.data.steps[0].error.cause.completionVerified, false);
		assert.equal(macro.data.unexecutedSteps, 1);
		assert.equal(markerWrites, 0);
		assert.equal(importCalls, 1);
	});

	await check('importChanges rejection is partial and nonretryable after one call', async () => {
		let calls = 0;
		globalThis.eda = { ...pcbFocus(() => 'pcb-A'), pcb_Document: { importChanges: async () => {
			calls++;
			throw new Error('sdk import rejected');
		} } };
		const error = await importHandler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.documentUuid, 'pcb-A');
		assert.equal(error.cause?.outcome, 'unknown');
		assert.equal(calls, 1);
	});

	await check('pre-import focus mismatch prevents the importer from running and is not partial', async () => {
		let calls = 0;
		globalThis.eda = {
			dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ documentType: 1, uuid: 'sch-A' }) },
			pcb_Document: { importChanges: async () => {
				calls++;
				return true;
			} },
		};
		const error = await importHandler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, undefined);
		assert.equal(calls, 0);
		globalThis.eda = {
			...pcbFocus(() => 'pcb-B'),
			pcb_Document: { importChanges: async () => {
				calls++;
				return true;
			} },
		};
		const wrongTarget = await importHandler({ __docUuid: 'pcb-A' }, {}).catch(reason => reason);
		assert.ok(wrongTarget instanceof Error);
		assert.match(wrongTarget.message, /请求目标不符/);
		assert.equal(wrongTarget.cause?.partial, undefined);
		assert.equal(calls, 0);
	});

	await check('post-import focus change reports partial and nonretryable despite SDK true', async () => {
		let currentUuid = 'pcb-A';
		let calls = 0;
		globalThis.eda = {
			...pcbFocus(() => currentUuid),
			pcb_Document: { importChanges: async () => {
				calls++;
				currentUuid = 'pcb-B';
				return true;
			} },
		};
		const error = await importHandler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.documentUuid, 'pcb-A');
		assert.equal(error.cause?.afterDocumentUuid, 'pcb-B');
		assert.equal(calls, 1);
	});

	await check('post-import focus read failure marks partial and stops a macro', async () => {
		let focusCalls = 0;
		let importCalls = 0;
		let markerWrites = 0;
		registerCommand(pcb('pcb.importChanges'));
		registerCommand({
			name: 'test.importFocusFailureMarker',
			summary: 'marker',
			params: [],
			returns: '{}',
			handler: async () => {
				markerWrites++;
				return {};
			},
		});
		globalThis.eda = {
			dmt_SelectControl: {
				getCurrentDocumentInfo: async () => {
					focusCalls++;
					if (focusCalls === 3)
						throw new Error('post-write focus lookup failed');
					return { documentType: 3, uuid: 'pcb-A' };
				},
			},
			pcb_Document: {
				importChanges: async () => {
					importCalls++;
					return true;
				},
			},
		};
		const result = await executeCommand({ cmd: 'macro', params: {
			stopOnError: false,
			steps: [
				{ cmd: 'pcb.importChanges', params: {} },
				{ cmd: 'test.importFocusFailureMarker', params: {} },
			],
		} });
		assert.equal(result.ok, false);
		assert.equal(result.data.stoppedReason, 'partial');
		assert.equal(result.data.steps[0].error.cause.partial, true);
		assert.equal(result.data.steps[0].error.cause.retryable, false);
		assert.equal(result.data.unexecutedSteps, 1);
		assert.equal(markerWrites, 0);
		assert.equal(importCalls, 1);
		assert.equal(focusCalls, 3);
	});

	await check('importChanges timeout stops a macro and ignores a late resolve without another call', async () => {
		const realSetTimeout = globalThis.setTimeout;
		let importCalls = 0;
		let lateResolved = false;
		let markerWrites = 0;
		registerCommand({
			name: 'test.netlistImportMarker',
			summary: 'marker',
			params: [],
			returns: '{}',
			handler: async () => {
				markerWrites++;
				return { written: true };
			},
		});
		globalThis.eda = {
			...pcbFocus(() => 'pcb-A'),
			pcb_Document: { importChanges: () => {
				importCalls++;
				return new Promise(resolve => setImmediate(() => {
					lateResolved = true;
					resolve(true);
				}));
			} },
		};
		globalThis.setTimeout = (callback, delay, ...args) => {
			if (delay === 280_000) {
				setImmediate(() => callback(...args));
				return 0;
			}
			if (delay > 280_000)
				return 0;
			return realSetTimeout(callback, delay, ...args);
		};
		try {
			registerCommand(pcb('pcb.importChanges'));
			const result = await executeCommand({ cmd: 'macro', params: {
				stopOnError: false,
				steps: [{ cmd: 'pcb.importChanges', params: {} }, { cmd: 'test.netlistImportMarker', params: {} }],
			} });
			assert.equal(result.ok, false);
			assert.equal(result.data.stoppedReason, 'partial');
			assert.equal(result.data.steps[0].error.cause.partial, true);
			assert.equal(result.data.steps[0].error.cause.retryable, false);
			assert.equal(result.data.unexecutedSteps, 1);
			assert.equal(markerWrites, 0);
			assert.equal(importCalls, 1);
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(lateResolved, true);
			assert.equal(importCalls, 1);
		}
		finally {
			globalThis.setTimeout = realSetTimeout;
		}
	});

	console.log(`PASS ${checks} netlist/import outcome checks`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
