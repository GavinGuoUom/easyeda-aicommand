import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import JSZip from 'jszip';

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
	let existingNames = [];
	let mismatchProjectIdentity = false;
	let teamReadDelayMs = 0;
	let projectListCalls = 0;
	let expectedFriendlyName = 'layout-roundtrip';
let expectedDescription;
	globalThis.eda = {
		dmt_Team: { getCurrentTeamInfo: async () => {
			if (teamReadDelayMs)
				await new Promise(resolve => setTimeout(resolve, teamReadDelayMs));
			return { uuid: 'team-1' };
		} },
		dmt_Project: {
			getCurrentProjectInfo: async () => ({ uuid: 'before-1' }),
			getAllProjectsUuid: async (teamUuid) => {
				projectListCalls++;
				assert.equal(teamUuid, 'team-1');
				return existingNames.map((_, index) => `project-${index}`);
			},
			getProjectInfo: async (uuid) => ({ uuid: mismatchProjectIdentity ? 'other-project' : uuid, teamUuid: 'team-1', friendlyName: existingNames[Number(uuid.split('-')[1])] }),
		},
		sys_FileManager: { importProjectByProjectFile: async (...args) => {
			calls++;
			assert.equal(args[1], 'JLCEDA Pro');
			if (expectedFriendlyName === undefined)
				assert.equal(Object.hasOwn(args[3], 'newProjectFriendlyName'), false, 'omitted name must not be sent as an undefined property');
			else
				assert.equal(args[3].newProjectFriendlyName, expectedFriendlyName);
			if (expectedDescription === undefined)
				assert.equal(Object.hasOwn(args[3], 'newProjectDescription'), false, 'unavailable description must be omitted');
			else
				assert.equal(args[3].newProjectDescription, expectedDescription);
			assert.equal(args[3].newProjectName, undefined);
			if (outcome instanceof Error)
				throw outcome;
			return outcome;
		} },
	};

	await assert.rejects(() => importFile.handler({ fileName: 'unsupported.bin', base64: 'YQ==' }), /无法按扩展名/);
	await assert.rejects(() => importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: '  ' }), /空白字符串/);
	existingNames = ['layout-roundtrip'];
	await assert.rejects(() => importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'layout-roundtrip' }), /已有同名工程/);
	mismatchProjectIdentity = true;
	await assert.rejects(() => importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'new-name' }), /无法读取工程/);
	mismatchProjectIdentity = false;
	existingNames = [];
	assert.equal(calls, 0, 'preflight rejection happens before import call');
	teamReadDelayMs = 1100;
	await assert.rejects(() => importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'deadline-name', _timeoutMs: 1000 }), /超过 1000ms 操作期限/);
	teamReadDelayMs = 0;
	assert.equal(calls, 0, 'deadline during async import preflight prevents import SDK call');
	const realDateNow = Date.now;
	let fakeNow = realDateNow();
	const listCallsBeforeDeadline = projectListCalls;
	globalThis.eda.dmt_Team.getCurrentTeamInfo = async () => ({
		get uuid() {
			fakeNow += 1001;
			return 'team-1';
		},
	});
	Date.now = () => fakeNow;
	try {
		await assert.rejects(() => importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==', newProjectName: 'deadline-after-team-read', _timeoutMs: 1000 }), /超过 1000ms 操作期限/);
	}
	finally {
		Date.now = realDateNow;
	}
	assert.equal(projectListCalls, listCallsBeforeDeadline, 'an expired deadline prevents starting the next project-list read');
	assert.equal(calls, 0, 'an expired preflight deadline prevents the import write');

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

	const zip = new JSZip();
	zip.file('project2.json', JSON.stringify({ title: 'Derived title', description: 'description from archive' }));
	const archiveBase64 = Buffer.from(await zip.generateAsync({ type: 'uint8array' })).toString('base64');
	expectedFriendlyName = 'Derived title';
	expectedDescription = 'description from archive';
	outcome = { uuid: 'created-derived', name: 'Derived title' };
	assert.equal((await importFile.handler({ fileName: 'layout.epro2', base64: archiveBase64 })).uuid, 'created-derived');
	expectedFriendlyName = undefined;
	expectedDescription = undefined;
	outcome = undefined;
	const callsBeforeUnnamed = calls;
	const unnamed = await importFile.handler({ fileName: 'layout.epro2', base64: 'YQ==' }).catch(reason => reason);
	assert.match(unnamed.message, /请显式传 newProjectName/);
	assert.equal(calls, callsBeforeUnnamed, 'cannot derive a name from invalid metadata, so SDK is never called');
	console.log('project import outcome regression: friendly name, duplicate preflight, unknown, macro-stop, success passed');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
