import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

async function main() {
	const root = resolve(import.meta.dirname, '..');
	const built = await build({
		stdin: {
			contents: 'import { pcbCommands } from \'../src/commands/pcb.ts\'; export { pcbCommands }',
			resolveDir: resolve(root, 'test'),
			sourcefile: 'auto-route-start-outcome-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
	const { pcbCommands } = await import(moduleUrl);
	const start = pcbCommands.find(command => command.name === 'pcb.autoRouteStart');

	function install({ startFailure = undefined, startState = 'READY_TO_START' } = {}) {
		const calls = [];
		const edaCalls = [];
		let jobState = startState;
		const dsnFile = new Blob(['dsn']);
		Object.defineProperty(dsnFile, 'name', { value: 'design.dsn' });
		globalThis.eda = {
			dmt_SelectControl: { getCurrentDocumentInfo: async () => { edaCalls.push('getCurrentDocumentInfo'); return { documentType: 3, uuid: 'pcb-A' } } },
			pcb_ManufactureData: { getDsnFile: async () => { edaCalls.push('getDsnFile'); return dsnFile } },
			sys_ClientUrl: {
				request: async (url, method, body) => {
					calls.push({ url, method, body });
					if (startFailure === 'transport' && method === 'PUT' && url.endsWith('/jobs/job-A/start'))
						throw new Error('connection reset after request dispatch');
					if (startFailure === 'http' && method === 'PUT' && url.endsWith('/jobs/job-A/start')) {
						return { ok: false, status: 500, text: async () => 'start refused' };
					}
					if (method === 'PUT' && url.endsWith('/jobs/job-A/cancel'))
						jobState = 'CANCELLED';
					return {
						ok: true,
						status: 200,
						json: async () => {
							if (url.endsWith('/sessions/create'))
								return { id: 'session-A' };
							if (url.endsWith('/jobs/enqueue'))
								return { id: 'job-A' };
							if (url.endsWith('/jobs/job-A/start'))
								return { state: startState };
							if (url.endsWith('/jobs/job-A'))
								return { state: jobState, stage: 'queued', current_pass: 0 };
							return {};
						},
					};
				},
			},
		};
		return { calls, edaCalls };
	}

	const status = pcbCommands.find(command => command.name === 'pcb.autoRouteStatus');
	const stop = pcbCommands.find(command => command.name === 'pcb.autoRouteStop');
	const invalidCalls = install();
	for (const skipDrc of [null, 'false', 1])
		await assert.rejects(() => start.handler({ skipDrc }, {}), /skipDrc 必须是布尔值/);
	for (const noImport of [null, 'true', 0])
		await assert.rejects(() => status.handler({ noImport }, {}), /noImport 必须是布尔值/);
	assert.deepEqual(invalidCalls, { calls: [], edaCalls: [] }, 'invalid flags must be rejected before EDA or HTTP calls');
	for (const startFailure of ['http', 'transport']) {
		const { calls: failedCalls } = install({ startFailure });
		const error = await start.handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.jobId, 'job-A');
		assert.equal(error.cause?.outcome, 'start-request-unknown');
		assert.match(error.message, /结果未知/);
		assert.equal(failedCalls.filter(call => call.method === 'PUT' && call.url.endsWith('/jobs/job-A/start')).length, 1);

		const beforeDuplicate = failedCalls.length;
		await assert.rejects(() => start.handler({}, {}), /已有布线任务/);
		assert.equal(failedCalls.length, beforeDuplicate, 'a duplicate start must not make another HTTP request');

		const observed = await status.handler({ noImport: true }, {});
		assert.equal(observed.jobId, 'job-A');
		assert.equal(observed.state, 'READY_TO_START');
		const cancelled = await stop.handler({}, {});
		assert.deepEqual(cancelled, { cancelled: true, jobId: 'job-A', state: 'CANCELLED' });
		assert.equal(failedCalls.some(call => call.method === 'GET' && call.url.endsWith('/jobs/job-A')), true);
		assert.equal(failedCalls.some(call => call.method === 'PUT' && call.url.endsWith('/jobs/job-A/cancel')), true);
	}

	const { calls } = install({ startState: 'READY_TO_START' });
	const result = await start.handler({ skipDrc: true }, {});
	assert.equal(result.jobId, 'job-A');
	assert.equal(result.outcome, 'start-request-submitted');
	assert.equal(result.stateVerified, false);
	assert.equal(Object.hasOwn(result, 'state'), false);
	assert.doesNotMatch(JSON.stringify(result), /RUNNING/);
	assert.match(result.note, /查询任务实际状态/);
	assert.match(result.note, /不要重复提交/);
	assert.match(result.note, /状态查询只读/);
	assert.match(result.note, /pcb\.importAutoRouteSes 导入/);
	assert.doesNotMatch(result.note, /清除未锁定铜层走线|自动回灌/);
	assert.equal(calls.filter(call => call.method === 'PUT' && call.url.endsWith('/jobs/job-A/start')).length, 1);
	console.log('PASS autoRouteStart reports submission without claiming RUNNING and rejects API failure');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
