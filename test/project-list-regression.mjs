import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

async function main() {
	const ROOT = resolve(import.meta.dirname, '..');
	const built = await build({
		stdin: {
			contents: `import { projectCommands } from '../src/commands/project.ts'; export { projectCommands };`,
			resolveDir: resolve(ROOT, 'test'),
			sourcefile: 'project-list-regression-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const { projectCommands } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
	const list = projectCommands.find(command => command.name === 'project.list');
	assert.ok(list);

	let result;
	let calls = [];
	const infoCalls = [];
	globalThis.eda = {
		dmt_Project: {
			getAllProjectsUuid: async (...args) => {
				calls.push(args);
				return result;
			},
			getProjectInfo: async (uuid) => {
				infoCalls.push(uuid);
				return { name: `info-${uuid}` };
			},
		},
	};

	result = ['p-1', 'p-2'];
	assert.deepEqual(await list.handler({}), ['p-1', 'p-2']);
	assert.deepEqual(calls, [[]], 'omitting teamUuid preserves the zero-argument SDK call');

	calls = [];
	result = ['p-3'];
	assert.deepEqual(await list.handler({ teamUuid: 'raw/team scope' }), ['p-3']);
	assert.deepEqual(calls, [['raw/team scope']], 'teamUuid is passed unchanged without UUID-format enforcement');

	calls = [];
	result = [];
	assert.deepEqual(await list.handler({}), [], 'a real empty array remains a valid empty result');
	assert.deepEqual(calls, [[]]);

	for (const [badResult, expectedError] of [
		[undefined, /收到 undefined/],
		[null, /收到 null/],
		[{}, /收到 object/],
		['p-1', /收到 string/],
		[[1], /第 0 项是 number/],
		[[''], /第 0 项 uuid 为空/],
	]) {
		result = badResult;
		await assert.rejects(() => list.handler({}), expectedError);
	}

	for (const badTeamUuid of [null, '', 7, []]) {
		calls = [];
		await assert.rejects(() => list.handler({ teamUuid: badTeamUuid }), /teamUuid 必须是非空字符串/);
		assert.equal(calls.length, 0, 'invalid teamUuid is rejected before the SDK call');
	}

	calls = [];
	infoCalls.length = 0;
	result = ['first', 'second', 'third'];
	assert.deepEqual(await list.handler({ detail: true }), [
		{ uuid: 'first', info: { name: 'info-first' } },
		{ uuid: 'second', info: { name: 'info-second' } },
		{ uuid: 'third', info: { name: 'info-third' } },
	]);
	assert.deepEqual(infoCalls, ['first', 'second', 'third'], 'detail lookups retain SDK list order');
	assert.deepEqual(calls, [[]]);

	console.log('project.list regression: default, teamUuid, empty array, invalid SDK results, invalid params, detail order passed');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
