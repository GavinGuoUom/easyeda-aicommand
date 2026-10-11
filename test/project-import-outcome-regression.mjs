import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

async function main() {
	const ROOT = resolve(import.meta.dirname, '..');
	const built = await build({
		stdin: {
			contents: `import { projectCommands } from '../src/commands/project.ts'; import { executeCommand, registerCommand } from '../src/engine/registry.ts'; export { projectCommands, executeCommand, registerCommand };`,
			resolveDir: resolve(ROOT, 'test'),
			sourcefile: 'project-import-outcome-regression-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const { projectCommands, executeCommand, registerCommand } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
	const importFile = projectCommands.find(command => command.name === 'project.importFile');
	assert.ok(importFile);
	for (const command of projectCommands) registerCommand(command);
	let calls = 0;
	let outcome;
	let afterCalls = 0;
	globalThis.eda = {
		dmt_Team: { getCurrentTeamInfo: async () => ({ uuid: 'team-1' }) },
		dmt_Project: { getCurrentProjectInfo: async () => ({ uuid: 'before-1' }) },
		sys_FileManager: { importProjectByProjectFile: async (...args) => {
			calls++;
			assert.equal(args[1], 'JLCEDA Pro');
			assert.equal(args[3].newProjectName, 'layout-roundtrip');
			if (outcome instanceof Error)
				throw outcome;
			return outcome;
		} },
	};

	await assert.rejects(() => importFile.handler({ fileName: 'unsupported.bin', base64: 'YQ==' }), /无法按扩展名/);
	assert.equal(calls, 0, 'preflight rejection happens before import call');

	for (const result of [undefined, null, {}, new Error('transport timeout')]) {
		outcome = result;
		const error = await importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'layout-roundtrip' }).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.outcome, 'unknown');
		assert.equal(error.cause?.fileName, 'layout.epro2');
		assert.equal(error.cause?.newProjectName, 'layout-roundtrip');
		assert.equal(error.cause?.beforeProjectUuid, 'before-1');
		assert.equal(JSON.stringify(error.cause).includes('YQ=='), false, 'base64 is never copied into error metadata');
	}
	assert.equal(calls, 4, 'each uncertain outcome is a single SDK invocation');

	registerCommand({
		name: 'test.importFollowup',
		summary: 'test',
		params: [],
		handler: async () => {
			afterCalls++;
			return true;
		},
	});
	outcome = undefined;
	calls = 0;
	const macro = await executeCommand({ cmd: 'macro', params: { stopOnError: false, steps: [
		{ cmd: 'project.importFile', params: { fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'layout-roundtrip' } },
		{ cmd: 'test.importFollowup', params: {} },
	] } });
	assert.equal(macro.ok, false);
	assert.equal(macro.data?.stoppedReason, 'partial');
	assert.equal(macro.data?.unexecutedSteps, 1);
	assert.equal(calls, 1, 'macro does not reissue an unknown import');
	assert.equal(afterCalls, 0, 'partial import stops macro even when stopOnError is false');

	outcome = { uuid: 'created-1', name: 'layout-roundtrip' };
	assert.equal((await importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'layout-roundtrip' })).uuid, 'created-1');
	console.log('project import outcome regression: preflight, unknown, macro-stop, success passed');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
