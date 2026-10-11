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
		const dsnFile = new Blob(['dsn']);
		Object.defineProperty(dsnFile, 'name', { value: 'design.dsn' });
		globalThis.eda = {
			pcb_ManufactureData: { getDsnFile: async () => dsnFile },
			sys_ClientUrl: {
				request: async (url, method, body) => {
					calls.push({ url, method, body });
					if (startFailure === 'transport' && method === 'PUT' && url.endsWith('/jobs/job-A/start'))
						throw new Error('connection reset after request dispatch');
					if (startFailure === 'http' && method === 'PUT' && url.endsWith('/jobs/job-A/start')) {
						return { ok: false, status: 500, text: async () => 'start refused' };
					}
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
								return { state: startState, stage: 'queued', current_pass: 0 };
							return {};
						},
					};
				},
			},
		};
		return calls;
	}

	const status = pcbCommands.find(command => command.name === 'pcb.autoRouteStatus');
	const stop = pcbCommands.find(command => command.name === 'pcb.autoRouteStop');
	for (const startFailure of ['http', 'transport']) {
		const failedCalls = install({ startFailure });
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
		assert.deepEqual(cancelled, { cancelled: true, jobId: 'job-A' });
		assert.equal(failedCalls.some(call => call.method === 'GET' && call.url.endsWith('/jobs/job-A')), true);
		assert.equal(failedCalls.some(call => call.method === 'PUT' && call.url.endsWith('/jobs/job-A/cancel')), true);
	}

	const calls = install({ startState: 'READY_TO_START' });
	const result = await start.handler({}, {});
	assert.equal(result.jobId, 'job-A');
	assert.equal(result.outcome, 'start-request-submitted');
	assert.equal(result.stateVerified, false);
	assert.equal(Object.hasOwn(result, 'state'), false);
	assert.doesNotMatch(JSON.stringify(result), /RUNNING/);
	assert.match(result.note, /查询任务实际状态/);
	assert.match(result.note, /不要重复提交/);
	assert.match(result.note, /清除全部未锁定线段、圆弧与过孔/);
	assert.equal(calls.filter(call => call.method === 'PUT' && call.url.endsWith('/jobs/job-A/start')).length, 1);
	console.log('PASS autoRouteStart reports submission without claiming RUNNING and rejects API failure');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
