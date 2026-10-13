import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import JSZip from 'jszip';

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

	const fixturePath = resolve(root, 'test/fixtures/netlist-import-193-203.json');
	const fixture = JSON.parse((await readFile(fixturePath, 'utf8')).replace(/^\uFEFF/, ''));
	const pcbUuid = 'pcb-test-document';
	const schematicUuid = 'sch-main';
	const footprintResourceUuid = 'f8df6f1a8162dfdb';
	const libraryFootprintUuid = 'verified-library-footprint';
	const source = fixture.pcbSource.join('\n');
	const pcbOnlyLine = (ticket, x) => `{"type":"COMPONENT","ticket":${ticket},"id":"pcb-only-1"}||{"partitionId":"","groupId":"1","layerId":1,"x":${x},"y":2,"angle":0,"attrs":{},"locked":false}|`;
	const extraManagedComponentLine = `{"type":"COMPONENT","ticket":999,"id":"extra-managed"}||{"partitionId":"","groupId":"1","layerId":1,"x":0,"y":0,"angle":0,"attrs":{"Unique ID":"extraManaged","Channel ID":"$extra","Designator":"TP4","Footprint":"${fixture.netlist.components.gge1.props.Footprint}"},"locked":false}|`;
	const padNetLine = (ticket, componentId, physicalId, net) => `{"type":"PAD_NET","ticket":${ticket},"id":${JSON.stringify(JSON.stringify(['PAD_NET', componentId, '1', physicalId]))}}||{"partitionId":"","padNet":${JSON.stringify(net)},"padLen":null,"propagationDelay":null,"attrsMap":{}}|`;
	const file = text => new Blob([text], { type: 'application/octet-stream' });

	function makeEnvironment(options = {}) {
		let focus = { documentType: 3, uuid: pcbUuid };
		let importCalls = 0;
		let pageNetlistCalls = 0;
		let sourceReads = 0;
		let pcbSource = options.pcbOnly ? `${source}\n${pcbOnlyLine(200, 1)}` : source;
		if (options.extraManagedSource)
			pcbSource += `\n${extraManagedComponentLine}`;
		if (options.duplicatePads === 'all-match')
			pcbSource += `\n${padNetLine(201, '3fa65b9cbdc2714b', 'e3', '')}`;
		if (options.duplicatePads === 'conflict-before-match')
			pcbSource += `\n${padNetLine(201, '3fa65b9cbdc2714b', 'e3', 'WRONG')}\n${padNetLine(202, '3fa65b9cbdc2714b', 'e4', '')}`;
		if (options.channelInIndependentAttr) {
			const replaced = pcbSource.replace('"Channel ID":"$1I2"', '"Channel ID":""');
			assert.notEqual(replaced, pcbSource, 'the fixture must clear the embedded Channel ID');
			assert.ok(replaced.includes('"Channel ID":"","Unique ID":"gge1"'), 'the gge1 embedded Channel ID must be empty');
			pcbSource = replaced + `\n{"type":"ATTR","ticket":203,"id":"3fa65b9cbdc2714bee2"}||{"partitionId":"","parentId":"3fa65b9cbdc2714b","key":"Channel ID","value":"$1I2"}|`;
		}
		const activated = [];
		const components = Object.entries(fixture.netlist.components).map(([key, netComponent], index) => {
			const props = netComponent.props;
			const primitiveId = `primitive-${index}`;
			const pins = Object.values(netComponent.pinInfoMap).map((pin, pinIndex) => ({
				getState_PadNumber: () => pin.number,
				getState_Net: () => options.wrongNet && index === 0 ? 'WRONG' : pin.net,
				getState_PrimitiveId: () => `pad-${index}-${pinIndex}`,
			}));
			return {
				getState_UniqueId: () => props['Unique ID'] ?? key,
				getState_Designator: () => props.Designator,
				getState_Footprint: () => ({ uuid: libraryFootprintUuid, libraryUuid: 'library-uuid' }),
				getState_PrimitiveId: () => primitiveId,
				getState_OtherProperty: () => options.channelInIndependentAttr && index === 0 ? {} : ({ 'Channel ID': props['Channel ID'] }),
				pins,
			};
		});
		globalThis.eda = {
			dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ ...focus }) },
			dmt_Board: { getCurrentBoardInfo: async () => ({
				parentProjectUuid: 'project-A',
				pcb: { uuid: pcbUuid },
				schematic: { uuid: schematicUuid },
			}) },
			dmt_Schematic: {
			getAllSchematicsInfo: async () => [
				{ uuid: schematicUuid, parentProjectUuid: 'project-A' },
				...(options.alternateSchematic ? [{ uuid: 'sch-alt', parentProjectUuid: 'project-A' }] : []),
			],
				getAllSchematicPagesInfo: async () => [
					{ uuid: 'page-1', parentSchematicUuid: schematicUuid },
					{ uuid: 'page-2', parentSchematicUuid: schematicUuid },
				...(options.alternateSchematic ? [{ uuid: 'page-alt', parentSchematicUuid: 'sch-alt' }] : []),
				],
			},
			dmt_EditorControl: { activateDocument: async uuid => {
				activated.push(uuid);
				const documentUuid = uuid.split('@')[0];
				focus = documentUuid.includes('page') ? { documentType: 1, uuid: documentUuid } : { documentType: 3, uuid: documentUuid };
				return true;
			}, openDocument: async uuid => {
				focus = uuid.includes('page') ? { documentType: 1, uuid } : { documentType: 3, uuid };
				return `${uuid}@project-A`;
			} },
			sch_ManufactureData: { getNetlistFile: async () => {
				pageNetlistCalls++;
				const netlist = options.conflictPage && pageNetlistCalls > 1 ? options.conflictPage() : fixture.netlist;
				if (options.switchFocusAfterExport)
					focus = { documentType: 3, uuid: 'user-selected-other-pcb' };
				return file(JSON.stringify(netlist));
			} },
			sys_FileManager: {
				getDocumentSource: async () => {
					sourceReads++;
					if (options.changePcbOnlyAfter && sourceReads > 1)
						return `${source}\n${pcbOnlyLine(200, 1)}\n${pcbOnlyLine(201, 99)}`;
					return pcbSource;
				},
				getProjectFile: async () => {
					const zip = new JSZip();
					zip.file(`FOOTPRINT/${footprintResourceUuid}.efoo`, [
						JSON.stringify(['DOCTYPE', 'FOOTPRINT', '1.8']),
						JSON.stringify(['HEAD', { uuid: footprintResourceUuid, source: `${libraryFootprintUuid}|library-uuid` }]),
						JSON.stringify(['PAD', 'pad-source-1', null, null, null, '1']),
					].join('\n'));
					return new File([await zip.generateAsync({ type: 'nodebuffer' })], 'project.epro');
				},
			},
			pcb_PrimitiveComponent: {
				getAll: async () => components,
				getAllPinsByPrimitiveId: async primitiveId => components.find(component => component.getState_PrimitiveId() === primitiveId)?.pins ?? [],
			},
			pcb_Document: { importChanges: async uuid => {
				importCalls++;
				assert.equal(uuid, options.schematicUuid ?? schematicUuid);
				return options.sdkResult === undefined ? true : options.sdkResult;
			} },
		};
		return { activated, get importCalls() { return importCalls; } };
	}

	await check('schematic and PCB netlist exporters accept nonempty blobs and reject missing, empty, or rejected results', async () => {
		for (const [apiName, command] of [
			['sch_ManufactureData', schematic('schematic.exportNetlist')],
			['pcb_ManufactureData', pcb('pcb.exportNetlist')],
		]) {
			globalThis.eda = { [apiName]: { getNetlistFile: async () => file('netlist') } };
			const result = await command.handler({}, {});
			assert.ok(result.size > 0);
			assert.ok(result.base64.length > 0);
			for (const resultValue of [undefined, new Blob([])]) {
				globalThis.eda = { [apiName]: { getNetlistFile: async () => resultValue } };
				await assert.rejects(() => command.handler({}, {}), /网表导出失败/);
			}
			globalThis.eda = { [apiName]: { getNetlistFile: async () => { throw new Error('sdk export failed'); } } };
			await assert.rejects(() => command.handler({}, {}), /sdk export failed/);
		}
	});

	await check('193/203 fixture verifies three managed components across every schematic page and preserves empty nets', async () => {
		const env = makeEnvironment();
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.deepEqual(env.activated, [`page-1@project-A`, `page-2@project-A`, `${pcbUuid}@project-A`]);
		assert.equal(env.importCalls, 1);
		assert.equal(result.contentsVerified, true);
		assert.equal(result.completionVerified, true);
		assert.equal(result.persistenceVerified, false);
		assert.equal(result.managedComponents, 3);
		assert.equal(result.checkedComponents, 3);
		assert.deepEqual(result.differences, []);
	});

	await check('identical duplicate identities across pages merge; a conflicting identity rejects before import', async () => {
		const same = makeEnvironment();
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.managedComponents, 3);
		const conflict = makeEnvironment({ conflictPage: () => {
			const changed = structuredClone(fixture.netlist);
			changed.components.gge1.pinInfoMap['1'].net = 'CONFLICT';
			return changed;
		} });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, undefined);
		assert.equal(conflict.importCalls, 0);
		assert.ok(same.activated.includes(`${pcbUuid}@project-A`));
	});

	await check('matching current contents succeed even when SDK reports false; a pad-net mismatch is partial and nonretryable', async () => {
		makeEnvironment({ sdkResult: false });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.imported, false);
		assert.equal(result.sdkResult, false);
		assert.equal(result.outcome, 'contents-verified');
		assert.equal(result.contentsVerified, true);
		const env = makeEnvironment({ wrongNet: true });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.verification?.ok, false);
		assert.equal(env.importCalls, 1);
	});

	await check('all same-number physical PAD_NET records must match expected network', async () => {
		const matching = makeEnvironment({ duplicatePads: 'all-match' });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.contentsVerified, true);
		assert.equal(matching.importCalls, 1);
		makeEnvironment({ duplicatePads: 'conflict-before-match' });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.ok(error.cause?.verification?.differences.some(item => item.includes('有效 PAD_NET 源码网络')));
	});

	await check('valid independent Channel ID ATTR is used when embedded attrs and SDK other properties omit it', async () => {
		const env = makeEnvironment({ channelInIndependentAttr: true });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.contentsVerified, true);
		assert.equal(result.checkedComponents, 3);
		assert.equal(env.importCalls, 1);
	});

	await check('source-only managed component mismatch is partial and prevents later macro writes', async () => {
		let markerWrites = 0;
		registerCommand(pcb('pcb.importChanges'));
		registerCommand({ name: 'test.importMarker', summary: 'marker', params: [], returns: '{}', handler: async () => { markerWrites++; return {}; } });
		const env = makeEnvironment({ extraManagedSource: true });
		const result = await executeCommand({ cmd: 'macro', params: { stopOnError: false, steps: [
			{ cmd: 'pcb.importChanges', params: {} },
			{ cmd: 'test.importMarker', params: {} },
		] } });
		assert.equal(result.ok, false);
		assert.equal(result.data.stoppedReason, 'partial');
		assert.equal(result.data.steps[0].error.cause.partial, true);
		assert.equal(result.data.unexecutedSteps, 1);
		assert.equal(markerWrites, 0);
		assert.equal(env.importCalls, 1);
	});

	await check('PCB-only source state is checked before and after import', async () => {
		const env = makeEnvironment({ pcbOnly: true });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.pcbOnlyPreserved, true);
		assert.equal(env.importCalls, 1);
		makeEnvironment({ pcbOnly: true, changePcbOnlyAfter: true });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.verification?.pcbOnlyPreserved, false);
	});

	await check('explicit schematic wins and a focus change during export stops before import', async () => {
		const env = makeEnvironment({ alternateSchematic: true, schematicUuid: 'sch-alt' });
		const result = await pcb('pcb.importChanges').handler({ schematicUuid: 'sch-alt' }, {});
		assert.equal(result.schematicUuid, 'sch-alt');
		assert.deepEqual(env.activated, ['page-alt@project-A', `${pcbUuid}@project-A`]);
		const interrupted = makeEnvironment({ switchFocusAfterExport: true });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, undefined);
		assert.equal(interrupted.importCalls, 0);
	});

	await check('SDK false with unresolved content is partial and stops later macro writes', async () => {
		let markerWrites = 0;
		registerCommand(pcb('pcb.importChanges'));
		registerCommand({ name: 'test.importMarker', summary: 'marker', params: [], returns: '{}', handler: async () => { markerWrites++; return {}; } });
		makeEnvironment({ wrongNet: true, sdkResult: false });
		const result = await executeCommand({ cmd: 'macro', params: { stopOnError: false, steps: [
			{ cmd: 'pcb.importChanges', params: {} },
			{ cmd: 'test.importMarker', params: {} },
		] } });
		assert.equal(result.ok, false);
		assert.equal(result.data.stoppedReason, 'partial');
		assert.equal(result.data.steps[0].error.cause.partial, true);
		assert.equal(result.data.unexecutedSteps, 1);
		assert.equal(markerWrites, 0);
	});

	console.log(`PASS ${checks} netlist/import outcome checks`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
