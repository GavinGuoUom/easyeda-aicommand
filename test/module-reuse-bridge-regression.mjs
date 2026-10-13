import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..');
async function loadCommands() {
	const built = await build({
		stdin: {
			contents: `import { moduleReuseCommands } from '../src/commands/moduleReuse.ts'; export { moduleReuseCommands };`,
			resolveDir: resolve(ROOT, 'test'),
			sourcefile: 'module-reuse-bridge-regression-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const { moduleReuseCommands } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
	return moduleReuseCommands;
}

const validContext = {
	project: { uuid: 'project-1', name: 'project' },
	document: { uuid: 'document-1', name: 'document' },
};

function makeHarness({ reply, rpcError, afterProjectUuid, afterDocumentUuid, afterProjectError, afterDocumentError, initialProjectUuid = 'project-1', initialDocumentUuid = 'document-1', initialDocumentType = 1, afterDocumentType } = {}) {
	const calls = [];
	const events = [];
	let projectReads = 0;
	let documentReads = 0;
	globalThis.eda = {
		sys_MessageBus: {
			rpcCallPublic: async (...args) => {
				calls.push(args);
				events.push('rpc');
				if (rpcError)
					throw rpcError;
				return typeof reply === 'function' ? reply() : reply;
			},
		},
		dmt_Project: {
			getCurrentProjectInfo: async () => {
				events.push('project');
				projectReads++;
				if (projectReads > 1 && afterProjectError)
					throw afterProjectError;
				return { uuid: projectReads > 1 ? afterProjectUuid ?? initialProjectUuid : initialProjectUuid };
			},
		},
		dmt_SelectControl: {
			getCurrentDocumentInfo: async () => {
				events.push('document');
				documentReads++;
				if (documentReads > 1 && afterDocumentError)
					throw afterDocumentError;
				return {
					uuid: documentReads > 1 ? afterDocumentUuid ?? initialDocumentUuid : initialDocumentUuid,
					documentType: documentReads > 1 ? afterDocumentType ?? initialDocumentType : initialDocumentType,
				};
			},
		},
	};
	return { calls, events };
}

async function main() {
	const moduleReuseCommands = await loadCommands();
	const getStatus = moduleReuseCommands.find(command => command.name === 'module.getStatus');
	const getContext = moduleReuseCommands.find(command => command.name === 'module.getContext');
	const capturePair = moduleReuseCommands.find(command => command.name === 'module.capturePair');
	const probeNativeCopy = moduleReuseCommands.find(command => command.name === 'module.probeNativeCopy');
	const getCopyOperation = moduleReuseCommands.find(command => command.name === 'module.getCopyOperation');
	const restoreFile = moduleReuseCommands.find(command => command.name === 'module.restoreFile');
	const getRestoreOperation = moduleReuseCommands.find(command => command.name === 'module.getRestoreOperation');
	const exportTemplateFile = moduleReuseCommands.find(command => command.name === 'module.exportTemplateFile');
	assert.ok(getStatus);
	assert.ok(getContext);
	assert.ok(capturePair);
	assert.ok(probeNativeCopy);
	assert.ok(getCopyOperation);
	assert.ok(restoreFile);
	assert.ok(getRestoreOperation);
	assert.ok(exportTemplateFile);
	const capabilities = ['module.getStatus', 'module.getContext', 'module.capturePair', 'module.probeNativeCopy', 'module.getCopyOperation', 'module.restoreFile', 'module.getRestoreOperation', 'module.exportTemplateFile', 'module.placeSchematicPage', 'module.alignTemplatePcb', 'module.mapInstanceNets', 'module.getPlacementOperation'];
	const nativeCapabilities = { placeCbbSchematicPage: true, modifyPcbName: true };
	const success = (data, version = '0.1.5') => ({ protocol: 1, plugin: 'module-reuse', version, ok: true, data });
	let harness = makeHarness({ reply: success({ ready: true, source: 'independent-plugin', capabilities, nativeCapabilities }) });
	const status = await getStatus.handler({});
	assert.deepEqual(status, { ready: true, source: 'independent-plugin', capabilities, nativeCapabilities });
	assert.equal(harness.calls.length, 1, 'getStatus issues exactly one public RPC');
	assert.deepEqual(harness.calls[0], ['module-reuse:rpc:v1', { protocol: 1, operation: 'getStatus', params: {} }]);
	assert.deepEqual(harness.events, ['rpc']);
	harness = makeHarness({ reply: success({ capabilities, nativeCapabilities: { placeCbbSchematicPage: false, modifyPcbName: false } }) });
	assert.deepEqual(await getStatus.handler({}), { capabilities, nativeCapabilities: { placeCbbSchematicPage: false, modifyPcbName: false } }, 'nativeCapabilities reports method presence and may be false');
	for (const version of ['0.1.4', '0.1.5', '0.1.6', '99.9.9']) {
		harness = makeHarness({ reply: success({ capabilities: ['module.getStatus'], nativeCapabilities }, version) });
		assert.deepEqual(await getStatus.handler({}), { capabilities: ['module.getStatus'], nativeCapabilities }, `nonempty diagnostic version ${version} and partial capabilities are accepted`);
		assert.equal(harness.calls.length, 1);
	}
	const versionlessReply = success({ capabilities, nativeCapabilities });
	delete versionlessReply.version;
	harness = makeHarness({ reply: versionlessReply });
	assert.deepEqual(await getStatus.handler({}), { capabilities, nativeCapabilities }, 'a missing diagnostic version does not block an otherwise valid reply');
	for (const availableCapabilities of [[], ['module.getStatus'], [...capabilities, 'module.extra']]) {
		harness = makeHarness({ reply: success({ capabilities: availableCapabilities, nativeCapabilities }) });
		assert.deepEqual((await getStatus.handler({})).capabilities, availableCapabilities, 'capabilities are returned unchanged without fixed-length or fixed-membership requirements');
	}
	harness = makeHarness({ reply: success({ capabilities }) });
	assert.deepEqual(await getStatus.handler({}), { capabilities }, 'nativeCapabilities may be omitted');
	for (const availableNativeCapabilities of [{}, { newFunction: true }, { placeCbbSchematicPage: false, newFunction: true }]) {
		harness = makeHarness({ reply: success({ capabilities, nativeCapabilities: availableNativeCapabilities }) });
		assert.deepEqual((await getStatus.handler({})).nativeCapabilities, availableNativeCapabilities, 'nativeCapabilities accepts missing legacy keys and added boolean keys');
	}

	for (const badStatus of [null, 'status', {}, { capabilities: null, nativeCapabilities }, { capabilities: [''], nativeCapabilities }, { capabilities: ['module.getStatus', 1], nativeCapabilities }, { capabilities, nativeCapabilities: null }, { capabilities, nativeCapabilities: [] }, { capabilities, nativeCapabilities: { modifyPcbName: 1 } }]) {
		harness = makeHarness({ reply: success(badStatus) });
		await assert.rejects(() => getStatus.handler({}), /module.getStatus 插件数据错误/);
		assert.equal(harness.calls.length, 1, 'invalid status data fails after one RPC without retry');
	}

	const exportParams = {
		projectUuid: 'project-1',
		cbbUuid: 'cbb-1',
		libraryUuid: 'library-1',
		templateSchematicUuid: 'template-sch-1',
		templatePcbUuid: 'template-pcb-1',
		fileName: 'template.epro2',
	};
	const exportData = {
		...exportParams,
		exported: true,
		size: 4,
		mimeType: 'application/octet-stream',
		base64: 'ZmlsZQ==',
		contentVerified: false,
		templateBindingVerified: false,
	};
	harness = makeHarness({ reply: success(exportData) });
	assert.deepEqual(await exportTemplateFile.handler(exportParams), exportData);
	assert.deepEqual(harness.calls, [[
		'module-reuse:rpc:v1',
		{ protocol: 1, operation: 'exportTemplateFile', params: exportParams },
	]]);
	assert.deepEqual(harness.events, ['project', 'rpc', 'project'], 'template file export checks project identity before and after its single RPC');

	for (const invalid of [
		{ ...exportParams, projectUuid: '' },
		{ ...exportParams, cbbUuid: '' },
		{ ...exportParams, libraryUuid: '' },
		{ ...exportParams, templateSchematicUuid: '' },
		{ ...exportParams, templatePcbUuid: '' },
		{ ...exportParams, fileName: 'folder/template.epro2' },
		{ ...exportParams, fileName: 'template.epro' },
		{ ...exportParams, extra: true },
	]) {
		harness = makeHarness({ reply: success(exportData) });
		await assert.rejects(() => exportTemplateFile.handler(invalid));
		assert.equal(harness.calls.length, 0, 'invalid template export parameters fail before RPC');
	}

	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(exportData) });
	await assert.rejects(() => exportTemplateFile.handler(exportParams), /模板导出尚未开始：工程不匹配/);
	assert.equal(harness.calls.length, 0, 'template export checks project identity before RPC');

	for (const invalidData of [
		{ ...exportData, projectUuid: 'other-project' },
		{ ...exportData, cbbUuid: 'other-cbb' },
		{ ...exportData, libraryUuid: 'other-library' },
		{ ...exportData, templateSchematicUuid: 'other-schematic' },
		{ ...exportData, templatePcbUuid: 'other-pcb' },
		{ ...exportData, fileName: 'other.epro2' },
		{ ...exportData, exported: false },
		{ ...exportData, base64: '' },
		{ ...exportData, base64: 'not base64' },
		{ ...exportData, size: 3 },
		{ ...exportData, size: 4.5 },
		{ ...exportData, mimeType: '' },
		{ ...exportData, contentVerified: true },
		{ ...exportData, templateBindingVerified: true },
	]) {
		harness = makeHarness({ reply: success(invalidData) });
		await assert.rejects(() => exportTemplateFile.handler(exportParams), /module\.exportTemplateFile 插件数据错误/);
		assert.equal(harness.calls.length, 1, 'invalid export data is rejected after one RPC');
	}

	harness = makeHarness({ reply: success(exportData), afterProjectUuid: 'other-project' });
	await assert.rejects(() => exportTemplateFile.handler(exportParams), /模板导出后当前工程不匹配/);
	assert.equal(harness.calls.length, 1, 'post-export project change is rejected without retry');

	harness = makeHarness({ rpcError: new Error('template export RPC failed') });
	await assert.rejects(() => exportTemplateFile.handler(exportParams), /template export RPC failed/);
	assert.deepEqual(harness.events, ['project', 'rpc', 'project'], 'current project is checked after an RPC rejection as well');
	assert.equal(harness.calls.length, 1, 'failed export is not retried');

	const placeParams = {
		operationId: 'place-1',
		cbbUuid: 'cbb-1',
		libraryUuid: 'library-1',
		sourceSchematicUuid: 'source-sch-1',
		sourcePcbUuid: 'source-pcb-1',
		targetProjectUuid: 'project-1',
		targetSchematicUuid: 'target-sch-1',
		targetSchematicPageUuid: 'target-page-1',
		targetPcbUuid: 'target-pcb-1',
		x: 1200.5,
		y: 900,
		reimportWhenNameRepeated: true,
	};
	const placeData = {
		operationId: 'place-1',
		targetProjectUuid: 'project-1',
		args: placeParams,
		outcome: 'placed',
		phase: 'placement-readback-confirmed',
		sdkResult: true,
		placementVerified: true,
		preState: { sourceSchematicPageUuid: 'source-page-1' },
		targetPageReadback: {
			uuid: 'target-page-1',
			schematicUuid: 'target-sch-1',
			docType: 'SCH_PAGE',
			recordCount: 11,
			addedRecordIds: ['record-new-1'],
			addedRecords: [{ type: 'ATTR', id: 'record-new-1' }],
			addedComponentIds: ['component-new-1'],
			addedComponents: [{ id: 'component-new-1', groupId: '1' }],
			reuseBlocks: [{ componentId: 'component-new-1', value: 'Template', groupId: 'group-1', channelId: 'channel-1' }],
		},
		introducedBoards: [{ boardName: 'Board2', schematicUuid: 'source-sch-1', schematicName: 'Module', pageUuids: ['introduced-page-1'], pcbUuid: 'introduced-pcb-1', pcbName: 'Board2' }],
		pairAssociationVerified: false,
	};
	harness = makeHarness({ reply: success(placeData), initialDocumentUuid: 'target-page-1', initialDocumentType: 1 });
	const placed = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams);
	assert.deepEqual(placed, {
		operationId: 'place-1',
		targetProjectUuid: 'project-1',
		sdkResult: true,
		outcome: 'placed',
		phase: 'placement-readback-confirmed',
		placementVerified: true,
		targetPageReadback: placeData.targetPageReadback,
		introducedBoards: placeData.introducedBoards,
		pairAssociationVerified: false,
	});
	assert.deepEqual(harness.calls, [['module-reuse:rpc:v1', { protocol: 1, operation: 'placeSchematicPage', params: placeParams }]]);
	assert.deepEqual(harness.events, ['project', 'document', 'rpc'], 'validated placed RPC data is returned without redundant post-placement identity reads');
	harness = makeHarness({ reply: success({ ...placeData, operationId: 'place-2', args: { ...placeParams, operationId: 'place-2' }, introducedBoards: [] }), initialDocumentUuid: 'target-page-1', initialDocumentType: 1 });
	const repeatedPlaced = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler({ ...placeParams, operationId: 'place-2' });
	assert.equal(repeatedPlaced.outcome, 'placed', 'a subsequent placement may introduce no new boards');
	harness = makeHarness({
		reply: success({ ...placeData, introducedBoards: [{ ...placeData.introducedBoards[0], pageUuids: [] }] }),
		initialDocumentUuid: 'target-page-1',
		initialDocumentType: 1,
	});
	const emptyPageSummary = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams);
	assert.deepEqual(emptyPageSummary.introducedBoards[0].pageUuids, []);
	assert.equal(emptyPageSummary.pairAssociationVerified, false);
	for (const invalidPlacementData of [
		{ ...placeData, operationId: 'wrong-operation' },
		{ ...placeData, targetProjectUuid: 'wrong-project' },
		{ ...placeData, args: { ...placeParams, x: placeParams.x + 1 } },
		{ ...placeData, outcome: 'pending-verification', phase: 'readback-pending-verification', placementVerified: undefined },
		{ ...placeData, placementVerified: false },
		{ ...placeData, pairAssociationVerified: true },
		{ ...placeData, targetPageReadback: { ...placeData.targetPageReadback, addedRecordIds: ['different-record'] } },
		{ ...placeData, targetPageReadback: { ...placeData.targetPageReadback, addedRecords: [{ type: 'ATTR', id: 'different-record' }] } },
		{ ...placeData, targetPageReadback: { ...placeData.targetPageReadback, reuseBlocks: [] } },
	]) {
		harness = makeHarness({ reply: success(invalidPlacementData), initialDocumentUuid: 'target-page-1', initialDocumentType: 1 });
		const invalidResult = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('unverified placement response must not become success'), error => error);
		assert.equal(invalidResult.cause?.outcome, 'unknown');
		assert.equal(invalidResult.cause?.postconditionVerified, true);
		assert.match(invalidResult.message, /目标身份后置检查通过/);
		assert.doesNotMatch(invalidResult.message, /后置读回失败/);
		assert.equal(JSON.parse(JSON.stringify(invalidResult.cause)).originalError.name, 'Error');
		assert.equal(harness.calls.length, 1);
	}

	for (const invalid of [
		{ ...placeParams, operationId: '' },
		{ ...placeParams, sourceSchematicUuid: '' },
		{ ...placeParams, sourcePcbUuid: '' },
		{ ...placeParams, x: Infinity },
		{ ...placeParams, y: Number.NaN },
		{ ...placeParams, reimportWhenNameRepeated: 1 },
		{ ...placeParams, extra: true },
	]) {
		harness = makeHarness({ reply: success(placeData), initialDocumentUuid: 'target-page-1' });
		await assert.rejects(() => moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(invalid));
		assert.equal(harness.calls.length, 0, 'invalid native placement parameters fail before RPC');
	}

	harness = makeHarness({ reply: success(placeData), initialDocumentUuid: 'wrong-page' });
	const placePrecondition = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('wrong target page must block placement'), error => error);
	assert.equal(placePrecondition.cause?.partial, false);
	assert.equal(placePrecondition.cause?.outcome, 'not_started');
	assert.equal(harness.calls.length, 0);
	harness = makeHarness({ reply: success(placeData), initialDocumentUuid: 'target-page-1', initialDocumentType: 3 });
	await assert.rejects(() => moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams));
	assert.equal(harness.calls.length, 0, 'non-schematic current document blocks native placement');

	const placeRemoteCause = { partial: true, retryable: false, outcome: 'pending-verification', operationId: 'place-1', phase: 'readback-pending-verification' };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'SDK placement returned true; independent readback remains pending', cause: placeRemoteCause } }, initialDocumentUuid: 'target-page-1' });
	const placeRemoteError = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('remote placement pending-verification must reject'), error => error);
	assert.equal(placeRemoteError.cause?.outcome, 'unknown', 'legacy pending result without a confirmed-success response is not treated as success');
	assert.equal(placeRemoteError.cause?.remoteCause, placeRemoteCause);
	assert.equal(harness.calls.length, 1);

	harness = makeHarness({ rpcError: new Error('placement transport disconnected'), initialDocumentUuid: 'target-page-1' });
	const placeTransportError = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('transport rejection must remain unknown'), error => error);
	assert.equal(placeTransportError.cause?.partial, true);
	assert.equal(placeTransportError.cause?.retryable, false);
	assert.equal(placeTransportError.cause?.outcome, 'unknown');
	assert.equal(placeTransportError.cause?.operationId, 'place-1');
	assert.equal(harness.calls.length, 1, 'native placement is not retried after an RPC rejection');
	const transportError = new Error('placement transport disconnected');
	const postProjectError = new Error('post-placement project lookup failed');
	harness = makeHarness({ rpcError: transportError, afterProjectError: postProjectError, initialDocumentUuid: 'target-page-1' });
	const transportAndPostReadError = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('RPC and post-read failures must stay unknown'), error => error);
	assert.notEqual(transportAndPostReadError, postProjectError, 'post-read SDK errors are wrapped instead of thrown raw');
	assert.equal(transportAndPostReadError.cause?.partial, true);
	assert.equal(transportAndPostReadError.cause?.retryable, false);
	assert.equal(transportAndPostReadError.cause?.operationId, 'place-1');
	assert.equal(transportAndPostReadError.cause?.originalError?.message, transportError.message);
	assert.equal(transportAndPostReadError.cause?.postconditionError?.message, postProjectError.message);
	const serializedTransportCause = JSON.parse(JSON.stringify(transportAndPostReadError.cause));
	assert.equal(serializedTransportCause.originalError.name, 'Error');
	assert.equal(serializedTransportCause.originalError.message, transportError.message);
	assert.equal(serializedTransportCause.originalError.stack, transportError.stack);
	assert.equal(serializedTransportCause.postconditionError.message, postProjectError.message);
	harness = makeHarness({
		reply: { protocol: 1, plugin: 'module-reuse', ok: false, error: { message: 'placement readback pending', cause: placeRemoteCause } },
		afterDocumentError: new Error('post-placement document lookup failed'),
		initialDocumentUuid: 'target-page-1',
	});
	const remoteAndPostReadError = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('remote and post-read failures must stay unknown'), error => error);
	const serializedRemoteCause = JSON.parse(JSON.stringify(remoteAndPostReadError.cause));
	assert.equal(serializedRemoteCause.partial, true);
	assert.equal(serializedRemoteCause.retryable, false);
	assert.equal(serializedRemoteCause.originalError.name, 'Error');
	assert.equal(serializedRemoteCause.originalError.cause.phase, placeRemoteCause.phase);
	assert.equal(serializedRemoteCause.postconditionError.message, 'post-placement document lookup failed');
	harness = makeHarness({ reply: { protocol: 2, plugin: 'module-reuse', ok: true, data: placeData }, afterDocumentError: new Error('post-placement document lookup failed'), initialDocumentUuid: 'target-page-1' });
	const protocolAndPostReadError = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams).then(() => assert.fail('protocol and post-read failures must stay unknown'), error => error);
	assert.equal(protocolAndPostReadError.cause?.partial, true);
	assert.equal(protocolAndPostReadError.cause?.retryable, false);
	assert.equal(protocolAndPostReadError.cause?.operationId, 'place-1');
	assert.match(protocolAndPostReadError.cause?.originalError?.message ?? '', /protocol 必须为 1/);
	assert.match(JSON.parse(JSON.stringify(protocolAndPostReadError.cause)).originalError.message, /protocol 必须为 1/);

	harness = makeHarness({ reply: success(placeData), initialDocumentUuid: 'target-page-1', afterDocumentUuid: 'other-page' });
	const placedWithoutPostRead = await moduleReuseCommands.find(command => command.name === 'module.placeSchematicPage').handler(placeParams);
	assert.equal(placedWithoutPostRead.outcome, 'placed', 'verified plugin evidence remains usable without a redundant active-document check');
	assert.deepEqual(harness.events, ['project', 'document', 'rpc']);
	assert.equal(harness.calls.length, 1);

	const alignParams = { operationId: 'align-1', placementOperationId: 'place-1', targetProjectUuid: 'project-1', targetSchematicPageUuid: 'target-page-1', templateSchematicUuid: 'template-sch-1', templatePcbUuid: 'template-pcb-1' };
	const alignHandler = moduleReuseCommands.find(command => command.name === 'module.alignTemplatePcb').handler;
	for (const invalid of [
		{ ...alignParams, placementOperationId: '' },
		{ ...alignParams, templatePcbUuid: '' },
		{ ...alignParams, extra: true },
	]) {
		harness = makeHarness({ reply: success({}) });
		await assert.rejects(() => alignHandler(invalid));
		assert.equal(harness.calls.length, 0, 'invalid alignment parameters fail before RPC');
	}
	const referenceBeforeAfter = [{ componentId: 'component-new-1', beforeValue: 'CBB:Board2', afterValue: 'Board2' }];
	for (const state of [
		{
			outcome: 'reference-aligned',
			phase: 'reference-aligned',
			renamed: false,
			noOp: false,
			templateContentsUnchanged: true,
			geometryUnchanged: true,
			affectedIDs: [{ componentId: 'component-new-1', attributeId: 'attr-1', beforeValue: 'CBB:Board2', afterValue: 'Board2' }],
			referenceBeforeAfter,
		},
		{
			outcome: 'reference-aligned',
			phase: 'already-aligned',
			renamed: false,
			noOp: true,
			templateContentsUnchanged: true,
			geometryUnchanged: true,
			affectedIDs: [],
			referenceBeforeAfter: [{ componentId: 'component-new-1', beforeValue: 'Board2', afterValue: 'Board2' }],
		},
		{ outcome: 'renamed', phase: 'rename-readback-confirmed', renamed: true, noOp: false },
		{ outcome: 'no-op', phase: 'already-named', renamed: false, noOp: true },
	]) {
		const alignData = { operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, ...state, contentsVerified: true };
		harness = makeHarness({ reply: success(alignData), initialDocumentUuid: 'target-page-1', initialDocumentType: 1 });
		assert.deepEqual(await alignHandler(alignParams), alignData);
		assert.deepEqual(harness.calls, [['module-reuse:rpc:v1', { protocol: 1, operation: 'alignTemplatePcb', params: alignParams }]]);
		assert.deepEqual(harness.events, ['project', 'document', 'rpc', 'project', 'document']);
	}

	for (const badAlignData of [
		{ operationId: 'wrong-id', targetProjectUuid: 'project-1', args: alignParams, outcome: 'renamed', phase: 'rename-readback-confirmed', renamed: true, noOp: false, contentsVerified: true },
		{ operationId: 'align-1', targetProjectUuid: 'project-2', args: alignParams, outcome: 'renamed', phase: 'rename-readback-confirmed', renamed: true, noOp: false, contentsVerified: true },
		{ operationId: 'align-1', targetProjectUuid: 'project-1', args: { ...alignParams, templatePcbUuid: 'wrong-pcb' }, outcome: 'renamed', phase: 'rename-readback-confirmed', renamed: true, noOp: false, contentsVerified: true },
		{ operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'changed', phase: 'rename-readback-confirmed', renamed: true, noOp: false, contentsVerified: true },
		{ operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'renamed', phase: 'rename-readback-confirmed', renamed: true, noOp: false, contentsVerified: false },
		{ operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'reference-aligned', phase: 'reference-aligned', renamed: true, noOp: false, contentsVerified: true, templateContentsUnchanged: true, geometryUnchanged: true, affectedIDs: [], referenceBeforeAfter },
		{ operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'reference-aligned', phase: 'reference-aligned', renamed: false, noOp: false, contentsVerified: true, templateContentsUnchanged: false, geometryUnchanged: true, affectedIDs: [{ componentId: 'component-new-1', attributeId: 'attr-1', beforeValue: 'CBB:Board2', afterValue: 'Board2' }], referenceBeforeAfter },
		{ operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'reference-aligned', phase: 'already-aligned', renamed: false, noOp: false, contentsVerified: true, templateContentsUnchanged: true, geometryUnchanged: true, affectedIDs: [], referenceBeforeAfter: [{ componentId: 'component-new-1', beforeValue: 'Board2', afterValue: 'Board2' }] },
	]) {
		harness = makeHarness({ reply: success(badAlignData), initialDocumentUuid: 'target-page-1' });
		const error = await alignHandler(alignParams).then(() => assert.fail('invalid alignment response must reject'), caught => caught);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.outcome, 'unknown');
		assert.equal(error.cause?.operationId, 'align-1');
		assert.equal(harness.calls.length, 1);
	}

	const alignRemoteCause = { partial: true, retryable: false, outcome: 'unknown', operationId: 'align-1', phase: 'modifyPcbName' };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'rename outcome uncertain', cause: alignRemoteCause } }, initialDocumentUuid: 'target-page-1' });
	const alignRemoteError = await alignHandler(alignParams).then(() => assert.fail('remote alignment uncertainty must reject'), error => error);
	assert.deepEqual(alignRemoteError.cause, alignRemoteCause, 'remote alignment cause is preserved');
	assert.equal(harness.calls.length, 1);

	harness = makeHarness({ reply: success({ operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'renamed', phase: 'rename-readback-confirmed', renamed: true, noOp: false, contentsVerified: true }), initialDocumentUuid: 'target-page-1', afterProjectUuid: 'other-project' });
	const alignPostcondition = await alignHandler(alignParams).then(() => assert.fail('alignment target project switch must be unknown'), error => error);
	assert.equal(alignPostcondition.cause?.partial, true);
	assert.equal(alignPostcondition.cause?.outcome, 'unknown');
	assert.equal(harness.calls.length, 1);

	const mapNetsHandler = moduleReuseCommands.find(command => command.name === 'module.mapInstanceNets').handler;
	assert.ok(mapNetsHandler);
	const mapNetsParams = {
		operationId: 'net-map-1',
		placementOperationId: 'place-1',
		targetProjectUuid: 'project-1',
		targetSchematicPageUuid: 'target-page-1',
		netMap: [
			{ sourceNet: 'GND', targetNet: 'GND', kind: 'interface' },
			{ sourceNet: 'VCC', targetNet: 'VDD', kind: 'internal' },
		],
	};
	const mappedNetworkRows = [
		{ ...mapNetsParams.netMap[0], wireIds: ['wire-gnd'], attributeIds: ['attr-gnd'] },
		{ ...mapNetsParams.netMap[1], wireIds: ['wire-vcc'], attributeIds: ['attr-vcc'] },
	];
	const mappedNetsData = {
		operationId: 'net-map-1',
		targetProjectUuid: 'project-1',
		args: mapNetsParams,
		netMap: mapNetsParams.netMap,
		mappedNetworks: mappedNetworkRows,
		bindings: [
			{ ...mapNetsParams.netMap[0], wireId: 'wire-gnd', attributeId: 'attr-gnd', beforeValue: 'GND', afterValue: 'GND' },
			{ ...mapNetsParams.netMap[1], wireId: 'wire-vcc', attributeId: 'attr-vcc', beforeValue: 'VCC', afterValue: 'VDD' },
		],
		confirmedIDs: ['wire-gnd', 'wire-vcc'],
		pendingIDs: [],
		noOp: false,
		outcome: 'mapped',
		phase: 'network-map-readback-confirmed',
		contentsVerified: true,
		geometryUnchanged: true,
		namedSourcesMapped: true,
		netlistVerified: false,
	};
	for (const state of [
		mappedNetsData,
		{ ...mappedNetsData, netMap: [...mapNetsParams.netMap].reverse(), args: { ...mapNetsParams, netMap: [...mapNetsParams.netMap].reverse() } },
	]) {
		const request = state === mappedNetsData ? mapNetsParams : { ...mapNetsParams, netMap: [...mapNetsParams.netMap].reverse() };
		const reorderedData = state === mappedNetsData ? state : { ...state, mappedNetworks: [...mappedNetworkRows].reverse(), bindings: [...mappedNetsData.bindings].reverse() };
		harness = makeHarness({ reply: success(reorderedData), initialDocumentUuid: 'target-page-1', initialDocumentType: 1 });
		assert.deepEqual(await mapNetsHandler(request), reorderedData);
		assert.deepEqual(harness.calls, [['module-reuse:rpc:v1', { protocol: 1, operation: 'mapInstanceNets', params: request }]]);
		assert.deepEqual(harness.events, ['project', 'document', 'rpc', 'project', 'document']);
	}
	const noOpParams = { ...mapNetsParams, operationId: 'net-map-noop', netMap: [{ sourceNet: 'GND', targetNet: 'GND', kind: 'interface' }] };
	const noOpData = {
		...mappedNetsData,
		operationId: noOpParams.operationId,
		args: noOpParams,
		netMap: noOpParams.netMap,
		mappedNetworks: [{ ...noOpParams.netMap[0], wireIds: ['wire-gnd'], attributeIds: ['attr-gnd'] }],
		bindings: [{ ...noOpParams.netMap[0], wireId: 'wire-gnd', attributeId: 'attr-gnd', beforeValue: 'GND', afterValue: 'GND' }],
		confirmedIDs: ['wire-gnd'],
		pendingIDs: [],
		noOp: true,
		phase: 'already-mapped',
	};
	harness = makeHarness({ reply: success(noOpData), initialDocumentUuid: 'target-page-1' });
	assert.deepEqual(await mapNetsHandler(noOpParams), noOpData, 'same-name interface mapping may be a confirmed no-op');
	assert.equal(harness.calls.length, 1);

	for (const invalid of [
		{ ...mapNetsParams, operationId: '' },
		{ ...mapNetsParams, placementOperationId: '' },
		{ ...mapNetsParams, targetSchematicPageUuid: '' },
		{ ...mapNetsParams, extra: true },
		{ ...mapNetsParams, netMap: null },
		{ ...mapNetsParams, netMap: [{ sourceNet: '', targetNet: 'N', kind: 'internal' }] },
		{ ...mapNetsParams, netMap: [{ sourceNet: 'N', targetNet: '', kind: 'internal' }] },
		{ ...mapNetsParams, netMap: [{ sourceNet: 'N', targetNet: 'N', kind: 'other' }] },
		{ ...mapNetsParams, netMap: [{ sourceNet: 'N', targetNet: 'N', kind: 'interface', extra: true }] },
	]) {
		harness = makeHarness({ reply: success(mappedNetsData), initialDocumentUuid: 'target-page-1' });
		await assert.rejects(() => mapNetsHandler(invalid));
		assert.equal(harness.calls.length, 0, 'invalid network mapping parameters fail before RPC');
	}
	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(mappedNetsData), initialDocumentUuid: 'target-page-1' });
	const mapPrecondition = await mapNetsHandler(mapNetsParams).then(() => assert.fail('wrong project blocks mapping'), error => error);
	assert.equal(mapPrecondition.cause?.partial, false);
	assert.equal(mapPrecondition.cause?.outcome, 'not_started');
	assert.equal(harness.calls.length, 0);

	const netMapNotStarted = { partial: false, retryable: false, outcome: 'not_started', operationId: 'net-map-1', phase: 'precondition_target' };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.11', ok: false, error: { message: 'mapping precondition rejected', cause: netMapNotStarted } }, initialDocumentUuid: 'target-page-1' });
	const netMapNotStartedError = await mapNetsHandler(mapNetsParams).then(() => assert.fail('remote not_started cause must reject'), error => error);
	assert.deepEqual(netMapNotStartedError.cause, netMapNotStarted);
	assert.equal(harness.calls.length, 1);
	const netMapUnknown = { partial: true, retryable: false, outcome: 'unknown', operationId: 'net-map-1', phase: 'update_wires', confirmedIDs: ['wire-gnd'], pendingIDs: ['wire-vcc'] };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.11', ok: false, error: { message: 'mapping outcome uncertain', cause: netMapUnknown } }, initialDocumentUuid: 'target-page-1' });
	const netMapUnknownError = await mapNetsHandler(mapNetsParams).then(() => assert.fail('remote unknown cause must reject'), error => error);
	assert.deepEqual(netMapUnknownError.cause, netMapUnknown);
	assert.equal(harness.calls.length, 1, 'network mapping is not retried on unknown outcome');
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.11', ok: false, error: { message: 'mapping outcome uncertain', cause: netMapUnknown } }, initialDocumentUuid: 'target-page-1', afterDocumentUuid: 'other-page' });
	const netMapUnknownWithPageSwitch = await mapNetsHandler(mapNetsParams).then(() => assert.fail('remote unknown metadata survives target readback failure'), error => error);
	assert.deepEqual(netMapUnknownWithPageSwitch.cause, netMapUnknown);
	assert.equal(harness.calls.length, 1);

	for (const badData of [
		{ ...mappedNetsData, operationId: 'wrong-id' },
		{ ...mappedNetsData, args: { ...mapNetsParams, netMap: [...mapNetsParams.netMap].reverse() } },
		{ ...mappedNetsData, netMap: [...mapNetsParams.netMap].reverse() },
		{ ...mappedNetsData, mappedNetworks: [...mappedNetworkRows].reverse() },
		{ ...mappedNetsData, pendingIDs: ['wire-vcc'] },
		{ ...mappedNetsData, geometryUnchanged: false },
		{ ...mappedNetsData, namedSourcesMapped: false },
		{ ...mappedNetsData, netlistVerified: true },
		{ ...mappedNetsData, contentsVerified: false },
		{ ...mappedNetsData, outcome: 'unknown' },
		{ ...mappedNetsData, phase: 'already-mapped', noOp: true },
		{ ...mappedNetsData, bindings: [{ ...mappedNetsData.bindings[0], wireId: 'wire-other' }] },
		{ ...mappedNetsData, bindings: [{ ...mappedNetsData.bindings[0], attributeId: 'attr-other' }] },
		{ ...mappedNetsData, bindings: mappedNetsData.bindings.slice(0, 1) },
		{ ...mappedNetsData, confirmedIDs: ['wire-gnd'] },
	]) {
		harness = makeHarness({ reply: success(badData), initialDocumentUuid: 'target-page-1' });
		const invalidResult = await mapNetsHandler(mapNetsParams).then(() => assert.fail('invalid mapping response must reject'), error => error);
		assert.equal(invalidResult.cause?.partial, true);
		assert.equal(invalidResult.cause?.retryable, false);
		assert.equal(invalidResult.cause?.outcome, 'unknown');
		assert.equal(invalidResult.cause?.operationId, 'net-map-1');
		assert.equal(harness.calls.length, 1);
	}
	harness = makeHarness({ reply: success(mappedNetsData), initialDocumentUuid: 'target-page-1', afterDocumentUuid: 'other-page' });
	const mapPostcondition = await mapNetsHandler(mapNetsParams).then(() => assert.fail('page switch after mapping is unknown'), error => error);
	assert.equal(mapPostcondition.cause?.partial, true);
	assert.equal(mapPostcondition.cause?.outcome, 'unknown');
	assert.equal(harness.calls.length, 1);

	const getPlacementHandler = moduleReuseCommands.find(command => command.name === 'module.getPlacementOperation').handler;
	const placementRecord = { operationId: 'place-1', targetProjectUuid: 'project-1', args: placeParams, outcome: 'placed', phase: 'placement-readback-confirmed', placementVerified: true, targetPageReadback: placeData.targetPageReadback, introducedBoards: placeData.introducedBoards, pairAssociationVerified: false };
	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(placementRecord) });
	assert.deepEqual(await getPlacementHandler({ operationId: 'place-1', targetProjectUuid: 'project-1' }), placementRecord);
	assert.deepEqual(harness.calls, [['module-reuse:rpc:v1', { protocol: 1, operation: 'getPlacementOperation', params: { operationId: 'place-1', targetProjectUuid: 'project-1' } }]]);
	assert.deepEqual(harness.events, ['rpc'], 'placement operation query works outside the active target project without EDA reads');
	for (const badPlacementRecord of [
		{ ...placementRecord, operationId: 'wrong-id' },
		{ ...placementRecord, targetProjectUuid: 'wrong-project' },
		{ ...placementRecord, args: { ...placeParams, targetProjectUuid: 'wrong-project' } },
		{ ...placementRecord, args: undefined },
		{ ...placementRecord, outcome: '' },
	]) {
		harness = makeHarness({ reply: success(badPlacementRecord) });
		await assert.rejects(() => getPlacementHandler({ operationId: 'place-1', targetProjectUuid: 'project-1' }));
		assert.equal(harness.calls.length, 1);
	}
	const alignRecord = { operationId: 'align-1', targetProjectUuid: 'project-1', args: alignParams, outcome: 'no-op', phase: 'already-named' };
	harness = makeHarness({ reply: success(alignRecord) });
	assert.deepEqual(await getPlacementHandler({ operationId: 'align-1', targetProjectUuid: 'project-1' }), alignRecord);
	assert.equal(harness.calls.length, 1, 'alignment operation args are validated without rerunning the write');
	const mapNetsRecord = { operationId: 'net-map-1', targetProjectUuid: 'project-1', args: mapNetsParams, outcome: 'mapped', phase: 'network-map-readback-confirmed', netMap: mappedNetsData.netMap, mappedNetworks: mappedNetsData.mappedNetworks, bindings: mappedNetsData.bindings, confirmedIDs: mappedNetsData.confirmedIDs, pendingIDs: [], netlistVerified: false };
	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(mapNetsRecord) });
	assert.deepEqual(await getPlacementHandler({ operationId: 'net-map-1', targetProjectUuid: 'project-1' }), mapNetsRecord);
	assert.deepEqual(harness.calls, [['module-reuse:rpc:v1', { protocol: 1, operation: 'getPlacementOperation', params: { operationId: 'net-map-1', targetProjectUuid: 'project-1' } }]]);
	assert.deepEqual(harness.events, ['rpc'], 'network-map operation record is queried without an active project read or write replay');
	const badMapNetsRecord = { ...mapNetsRecord, args: { ...mapNetsParams, netMap: [{ ...mapNetsParams.netMap[0], kind: 'unknown' }] } };
	harness = makeHarness({ reply: success(badMapNetsRecord) });
	await assert.rejects(() => getPlacementHandler({ operationId: 'net-map-1', targetProjectUuid: 'project-1' }));
	assert.equal(harness.calls.length, 1, 'persisted network mapping args are validated without replay');

	harness = makeHarness({ rpcError: new Error('query unavailable') });
	await assert.rejects(() => getPlacementHandler({ operationId: 'place-1', targetProjectUuid: 'project-1' }), /query unavailable/);
	assert.deepEqual(harness.events, ['rpc'], 'placement operation query does not read active EDA state even on RPC failure');
	assert.equal(harness.calls.length, 1);

	for (const [badReply, message] of [
		[undefined, /响应必须是对象/],
		[{ protocol: 2, plugin: 'module-reuse', version: '0.1.5', ok: true, data: {} }, /protocol 必须为 1/],
		[{ protocol: 1, plugin: 'other', version: '0.1.5', ok: true, data: {} }, /插件错误/],
		[{ protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: 'yes', data: {} }, /ok 必须是布尔值/],
		[{ protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true }, /成功响应缺少 data/],
		[{ protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true, data: undefined }, /成功响应缺少 data/],
		[{ protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'request denied' } }, /插件拒绝请求：request denied/],
	]) {
		harness = makeHarness({ reply: badReply });
		await assert.rejects(() => getStatus.handler({}), message);
		assert.equal(harness.calls.length, 1, 'a malformed or rejected reply is not retried');
	}

	for (const rpcError of [new Error('public RPC service missing'), new Error('plugin refused request')]) {
		harness = makeHarness({ rpcError });
		await assert.rejects(() => getStatus.handler({}), error => error === rpcError);
		assert.equal(harness.calls.length, 1, 'SDK rejection is preserved and not retried');
	}

	const captureParams = { projectUuid: 'project-1', schematicPageUuid: 'page-1', pcbUuid: 'pcb-1' };
	const captureData = {
		captureId: 'capture-1',
		source: { projectUuid: 'project-1', boardName: 'Board1', schematicUuid: 'schematic-1', schematicPageUuid: 'page-1', pcbUuid: 'pcb-1' },
		documents: {
			schematic: { uuid: 'page-1', docType: 'Schematic Page', validObjectCount: 12 },
			pcb: { uuid: 'pcb-1', docType: 'PCB', validObjectCount: 24 },
		},
	};
	harness = makeHarness({ reply: success(captureData) });
	assert.deepEqual(await capturePair.handler(captureParams), captureData);
	assert.equal(harness.calls.length, 1);
	assert.deepEqual(harness.calls[0], ['module-reuse:rpc:v1', { protocol: 1, operation: 'capturePair', params: captureParams }]);

	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(captureData) });
	await assert.rejects(() => capturePair.handler(captureParams), /capturePair 工程不匹配/);
	assert.equal(harness.calls.length, 0, 'capturePair checks its source project before RPC');

	const probeParams = { operationId: 'operation-1', captureId: 'capture-1', targetProjectUuid: 'project-1', documentType: 'pcb' };
	const probeData = {
		operationId: 'operation-1',
		captureId: 'capture-1',
		targetProjectUuid: 'project-1',
		documentType: 'pcb',
		sourceUuid: 'pcb-1',
		createdUuid: 'pcb-copy-1',
		state: 'copyConfirmed',
		contentMatch: true,
		sourceObjectCount: 24,
		createdObjectCount: 24,
		dependenciesVerified: false,
		persisted: false,
		pairAssociationVerified: false,
	};
	harness = makeHarness({ reply: success(probeData), initialDocumentUuid: 'pcb-copy-1', initialDocumentType: 3 });
	assert.deepEqual(await probeNativeCopy.handler(probeParams), probeData);
	assert.equal(harness.calls.length, 1, 'native copy probe sends exactly one RPC');
	assert.deepEqual(harness.calls[0], ['module-reuse:rpc:v1', { protocol: 1, operation: 'probeNativeCopy', params: probeParams }]);

	for (const invalid of [
		{ ...probeParams, targetProjectUuid: '' },
		{ ...probeParams, documentType: 'other' },
		{ ...probeParams, boardName: 'Board2' },
		{ ...probeParams, targetSchematicUuid: 'page-target' },
		{ operationId: 'operation-1', captureId: 'capture-1', targetProjectUuid: 'project-1', documentType: 'schematic' },
	]) {
		harness = makeHarness({ reply: success(probeData), initialDocumentUuid: 'pcb-copy-1', initialDocumentType: 3 });
		await assert.rejects(() => probeNativeCopy.handler(invalid));
		assert.equal(harness.calls.length, 0, 'invalid probe parameters fail before RPC');
	}

	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(probeData) });
	const preconditionError = await probeNativeCopy.handler(probeParams).then(() => assert.fail('wrong target project must reject'), error => error);
	assert.equal(preconditionError.cause?.partial, false);
	assert.equal(harness.calls.length, 0, 'target project guard runs before copy RPC');

	const remoteNotStarted = { partial: false, retryable: false, outcome: 'not_started', operationId: 'operation-1', phase: 'persist_write_started' };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'precondition rejected', cause: remoteNotStarted } } });
	const remotePreconditionError = await probeNativeCopy.handler(probeParams).then(() => assert.fail('explicit precondition refusal must reject'), error => error);
	assert.deepEqual(remotePreconditionError.cause, remoteNotStarted, 'remote not-started cause is preserved without write protection');

	const remoteUnknown = { partial: true, retryable: false, outcome: 'unknown', operationId: 'operation-1', phase: 'copy_native', createdUuid: 'possible-copy' };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'copy outcome uncertain', cause: remoteUnknown } } });
	const remoteUnknownError = await probeNativeCopy.handler(probeParams).then(() => assert.fail('remote unknown must reject'), error => error);
	assert.deepEqual(remoteUnknownError.cause, remoteUnknown, 'remote partial metadata is preserved exactly');

	const restoreParams = { operationId: 'restore-1', targetProjectUuid: 'project-1', fileName: 'module.epro2', base64: 'ZmlsZQ==' };
	const restoreData = {
		operationId: 'restore-1',
		targetProjectUuid: 'project-1',
		fileName: 'module.epro2',
		fileType: 'JLCEDA Pro',
		state: 'fileImported',
		phase: 'metadata_confirmed',
		importedProjectUuid: 'project-1',
		metadataVerified: true,
		contentVerified: false,
		partial: false,
		retryable: false,
		outcome: 'confirmed',
		treeChanged: true,
	};
	harness = makeHarness({ reply: success(restoreData) });
	assert.deepEqual(await restoreFile.handler(restoreParams), {
		...restoreData,
		dependenciesVerified: false,
		persisted: false,
		pairAssociationVerified: false,
	});
	assert.deepEqual(harness.calls, [[
		'module-reuse:rpc:v1',
		{ protocol: 1, operation: 'restoreFile', params: restoreParams },
	]]);
	assert.deepEqual(harness.events, ['project', 'rpc', 'project'], 'restoreFile checks the requested project both before and after the single RPC');

	for (const invalid of [
		{ ...restoreParams, fileName: 'module.zip' },
		{ ...restoreParams, base64: '' },
		{ ...restoreParams, extra: true },
	]) {
		harness = makeHarness({ reply: success(restoreData) });
		await assert.rejects(() => restoreFile.handler(invalid));
		assert.equal(harness.calls.length, 0, 'invalid file restore parameters fail before RPC');
	}

	harness = makeHarness({ initialProjectUuid: 'other-project', reply: success(restoreData) });
	const restorePreconditionError = await restoreFile.handler(restoreParams).then(() => assert.fail('restore target mismatch must reject before RPC'), error => error);
	assert.equal(restorePreconditionError.cause?.partial, false);
	assert.equal(restorePreconditionError.cause?.outcome, 'not_started');
	assert.equal(restorePreconditionError.cause?.operationId, 'restore-1');
	assert.equal(harness.calls.length, 0);

	harness = makeHarness({ rpcError: new Error('RPC disconnected after request') });
	const restoreRpcError = await restoreFile.handler(restoreParams).then(() => assert.fail('RPC rejection must remain unknown'), error => error);
	assert.equal(restoreRpcError.cause?.partial, true);
	assert.equal(restoreRpcError.cause?.retryable, false);
	assert.equal(restoreRpcError.cause?.outcome, 'unknown');
	assert.equal(restoreRpcError.cause?.operationId, 'restore-1');
	assert.equal(harness.calls.length, 1, 'uncertain restore RPC is never retried');

	const restoreUnknown = { partial: true, retryable: false, outcome: 'unknown', operationId: 'restore-1', phase: 'sdk_import' };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'import outcome uncertain', cause: restoreUnknown } } });
	const remoteRestoreUnknown = await restoreFile.handler(restoreParams).then(() => assert.fail('remote unknown restore must reject'), error => error);
	assert.deepEqual(remoteRestoreUnknown.cause, restoreUnknown, 'remote unknown restore metadata is preserved exactly');
	assert.equal(harness.calls.length, 1);

	harness = makeHarness({ reply: success({ ...restoreData, state: 'unknown', phase: 'sdk_import', partial: true, retryable: false, outcome: 'unknown' }) });
	const replayedUnknown = await restoreFile.handler(restoreParams).then(() => assert.fail('persisted unknown restore record must not be treated as success'), error => error);
	assert.equal(replayedUnknown.cause?.partial, true);
	assert.equal(replayedUnknown.cause?.retryable, false);
	assert.equal(replayedUnknown.cause?.outcome, 'unknown');
	assert.equal(replayedUnknown.cause?.operationId, 'restore-1');
	assert.equal(harness.calls.length, 1, 'an unknown record replay is queried once and never starts another restore');

	harness = makeHarness({ reply: success({ ...restoreData, contentVerified: true }) });
	const badRestoreData = await restoreFile.handler(restoreParams).then(() => assert.fail('restore content must not be claimed verified'), error => error);
	assert.equal(badRestoreData.cause?.partial, true);
	assert.equal(badRestoreData.cause?.outcome, 'unknown');
	assert.equal(badRestoreData.cause?.operationId, 'restore-1');
	assert.equal(harness.calls.length, 1);

	harness = makeHarness({ reply: success(restoreData), afterProjectUuid: 'project-2' });
	const restorePostconditionError = await restoreFile.handler(restoreParams).then(() => assert.fail('restore project switch must report unknown'), error => error);
	assert.equal(restorePostconditionError.cause?.partial, true);
	assert.equal(restorePostconditionError.cause?.outcome, 'unknown');
	assert.equal(restorePostconditionError.cause?.operationId, 'restore-1');
	assert.equal(harness.calls.length, 1);

	const restoreOperation = { operationId: 'restore-1', state: 'fileImported', phase: 'metadata_confirmed', contentVerified: false };
	harness = makeHarness({ reply: success(restoreOperation) });
	assert.deepEqual(await getRestoreOperation.handler({ operationId: 'restore-1' }), restoreOperation);
	assert.deepEqual(harness.calls, [[
		'module-reuse:rpc:v1',
		{ protocol: 1, operation: 'getRestoreOperation', params: { operationId: 'restore-1' } },
	]]);
	assert.deepEqual(harness.events, ['rpc'], 'restore operation status is read without target reads');
	await assert.rejects(() => getRestoreOperation.handler({ operationId: '' }), /operationId 必须是非空字符串/);
	await assert.rejects(() => getRestoreOperation.handler({ operationId: 'restore-1', extra: true }), /仅接受 operationId/);

	harness = makeHarness({ rpcError: new Error('public RPC connection lost') });
	const rpcRejectError = await probeNativeCopy.handler(probeParams).then(() => assert.fail('public RPC rejection must report unknown copy outcome'), error => error);
	assert.equal(rpcRejectError.cause?.partial, true);
	assert.equal(rpcRejectError.cause?.retryable, false);
	assert.equal(rpcRejectError.cause?.outcome, 'unknown');
	assert.equal(rpcRejectError.cause?.operationId, 'operation-1');
	assert.equal(harness.calls.length, 1, 'probeNativeCopy public RPC rejection is not retried');

	for (const response of [
		undefined,
		{ protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: false, error: { message: 'response lost' } },
		{ protocol: 2, plugin: 'module-reuse', version: '0.1.5', ok: true, data: probeData },
		success({ ...probeData, createdUuid: undefined }),
	]) {
		harness = makeHarness({ reply: response });
		const error = await probeNativeCopy.handler(probeParams).then(() => assert.fail('uncertain probe must reject'), caught => caught);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.outcome, 'unknown');
		assert.equal(error.cause?.operationId, 'operation-1');
		if (response?.data?.createdUuid)
			assert.equal(error.cause?.createdUuid, 'pcb-copy-1', 'candidate createdUuid is retained when the reply protocol is invalid');
		assert.equal(harness.calls.length, 1, 'unknown probe result is never retried');
	}

	for (const changed of [
		{ afterProjectUuid: 'other-project', initialDocumentUuid: 'pcb-copy-1', initialDocumentType: 3 },
		{ initialDocumentUuid: 'wrong-document', initialDocumentType: 3 },
		{ initialDocumentUuid: 'pcb-copy-1', initialDocumentType: 1 },
	]) {
		harness = makeHarness({ reply: success(probeData), ...changed });
		const error = await probeNativeCopy.handler(probeParams).then(() => assert.fail('post-copy identity mismatch must reject'), caught => caught);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.outcome, 'unknown');
		assert.equal(error.cause?.createdUuid, 'pcb-copy-1');
		assert.equal(harness.calls.length, 1);
	}

	const operationRecord = { operationId: 'operation-1', captureId: 'capture-1', targetProjectUuid: 'project-1', documentType: 'pcb', sourceUuid: 'pcb-1', state: 'copyConfirmed', phase: 'copy_native', createdUuid: 'pcb-copy-1' };
	harness = makeHarness({ reply: success(operationRecord) });
	assert.deepEqual(await getCopyOperation.handler({ operationId: 'operation-1', extra: 'ignored' }), operationRecord);
	assert.deepEqual(harness.calls, [['module-reuse:rpc:v1', { protocol: 1, operation: 'getCopyOperation', params: { operationId: 'operation-1' } }]]);
	assert.equal(harness.events.length, 1, 'copy operation status is queryable without project identity reads');
	await assert.rejects(() => getCopyOperation.handler({ operationId: '' }), /operationId 必须是非空字符串/);

	const proxySource = await readFile(resolve(ROOT, 'bridge/command-proxy.mjs'), 'utf8');
	const readonlyMatch = proxySource.match(/const READONLY_COMMAND_PATTERNS = \[([\s\S]*?)\r?\n\]\r?\nfunction isReadOnlyCommand\(cmd\) \{([\s\S]*?)\r?\n\}/);
	assert.ok(readonlyMatch, 'proxy read-only classifier source is available');
	const classifierSandbox = {};
	vm.runInNewContext(`const READONLY_COMMAND_PATTERNS = [${readonlyMatch[1]}]; function isReadOnlyCommand(cmd) {${readonlyMatch[2]}}; this.isReadOnlyCommand = isReadOnlyCommand;`, classifierSandbox);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.getCopyOperation'), true);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.getRestoreOperation'), true);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.getPlacementOperation'), true);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.exportTemplateFile'), true);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.mapInstanceNets'), false);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.capturePair'), false);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.probeNativeCopy'), false);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.restoreFile'), false);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.placeSchematicPage'), false);
	assert.equal(classifierSandbox.isReadOnlyCommand('module.alignTemplatePcb'), false);

	for (const invalid of [
		{},
		{ projectUuid: '', documentUuid: 'document-1' },
		{ projectUuid: 'project-1', documentUuid: null },
		{ projectUuid: 9, documentUuid: 'document-1' },
	]) {
		harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true, data: validContext } });
		await assert.rejects(() => getContext.handler(invalid), /必须是非空字符串/);
		assert.equal(harness.calls.length, 0, 'invalid params fail before any RPC');
		assert.deepEqual(harness.events, [], 'invalid params fail before any target reads');
	}

	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true, data: validContext } });
	assert.deepEqual(await getContext.handler({ projectUuid: 'project-1', documentUuid: 'document-1' }), validContext);
	assert.deepEqual(harness.calls, [[
		'module-reuse:rpc:v1',
		{ protocol: 1, operation: 'getContext', params: { projectUuid: 'project-1', documentUuid: 'document-1' } },
	]]);
	assert.deepEqual(harness.events, ['project', 'document', 'rpc', 'project', 'document'], 'target reads bracket the one RPC sequentially');

	harness = makeHarness({
		initialProjectUuid: 'other-project',
		reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true, data: validContext },
	});
	await assert.rejects(() => getContext.handler({ projectUuid: 'project-1', documentUuid: 'document-1' }), /RPC 前工程已切换/);
	assert.equal(harness.calls.length, 0, 'pre-RPC target mismatch is rejected before RPC');

	for (const change of [
		{ afterProjectUuid: 'project-2', error: /RPC 后工程已切换/ },
		{ afterDocumentUuid: 'document-2', error: /RPC 后文档已切换/ },
	]) {
		harness = makeHarness({
			afterProjectUuid: change.afterProjectUuid,
			afterDocumentUuid: change.afterDocumentUuid,
			reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true, data: validContext },
		});
		await assert.rejects(() => getContext.handler({ projectUuid: 'project-1', documentUuid: 'document-1' }), change.error);
		assert.equal(harness.calls.length, 1, 'post-RPC target change does not cause a retry');
	}

	for (const data of [
		{ project: { uuid: 'other-project' }, document: validContext.document },
		{ project: validContext.project, document: { uuid: 'other-document' } },
	]) {
		harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.5', ok: true, data } });
		await assert.rejects(() => getContext.handler({ projectUuid: 'project-1', documentUuid: 'document-1' }), /身份不匹配/);
		assert.equal(harness.calls.length, 1, 'returned identity mismatch is rejected after one RPC');
	}

	const pcbImport = moduleReuseCommands.find(command => command.name === 'module.importPcbInstances');
	const pcbQuery = moduleReuseCommands.find(command => command.name === 'module.getPcbImportOperation');
	const pcbArgs = { operationId: 'pcb-stage', targetProjectUuid: 'project-1', targetSchematicUuid: 'sch', targetSchematicPageUuid: 'page', targetPcbUuid: 'pcb', placementOperationIds: ['placement'] };
	const { operationId: pcbOperationId, ...pcbStoredArgs } = pcbArgs;
	const pcbRecord = { operation: 'importPcbInstances', operationId: pcbOperationId, targetProjectUuid: 'project-1', args: pcbStoredArgs, outcome: 'confirmed', phase: 'completed', stage: 'pcb_component_import_and_footprint_reference', writeAttempted: true, layoutRoutingVerified: false, saveReloadVerified: false };
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.18', ok: true, data: pcbRecord } });
	assert.deepEqual(await pcbImport.handler(pcbArgs), pcbRecord);
	assert.equal(harness.calls.length, 1);
	assert.deepEqual(harness.events, ['project', 'rpc']);
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.18', ok: true, data: { ...pcbRecord, writeAttempted: false } } });
	await assert.rejects(() => pcbImport.handler(pcbArgs), e => e.cause?.partial === true && /记录身份或阶段/.test(e.message));
	assert.equal(harness.calls.length, 1);
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.18', ok: true, data: { ...pcbRecord, args: { ...pcbStoredArgs, targetPcbUuid: 'wrong-pcb' } } } });
	await assert.rejects(() => pcbImport.handler(pcbArgs), /返回参数与请求不一致/);
	assert.equal(harness.calls.length, 1);
	harness = makeHarness({ initialProjectUuid: 'wrong-project' });
	await assert.rejects(() => pcbImport.handler(pcbArgs), /当前工程不一致/);
	assert.equal(harness.calls.length, 0);
	harness = makeHarness();
	await assert.rejects(() => pcbImport.handler({ ...pcbArgs, uidMappings: [] }), /仅接受|只能|参数/);
	assert.equal(harness.calls.length, 0);
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.18', ok: true, data: { ...pcbRecord, outcome: 'unknown', phase: 'force_import_started' } } });
	await assert.rejects(() => pcbImport.handler(pcbArgs), e => e.cause?.partial === true && e.cause?.operationId === 'pcb-stage');
	assert.equal(harness.calls.length, 1);
	harness = makeHarness({ reply: { protocol: 1, plugin: 'module-reuse', version: '0.1.18', ok: true, data: { ...pcbRecord, outcome: 'unknown', phase: 'force_import_started' } }, initialProjectUuid: 'other' });
	const queried = await pcbQuery.handler({ operationId: 'pcb-stage', targetProjectUuid: 'project-1' });
	assert.equal(queried.outcome, 'unknown');
	assert.deepEqual(harness.events, ['rpc']);
	assert.equal(harness.calls.length, 1);
	console.log('module reuse bridge regression: status, protocol, missing/rejected plugin, params, target identity, one-RPC behavior passed');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
