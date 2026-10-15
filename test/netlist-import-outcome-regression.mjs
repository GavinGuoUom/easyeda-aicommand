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
		let focus = { documentType: 3, uuid: pcbUuid, parentProjectUuid: 'project-A' };
		let importCalls = 0;
		let pageNetlistCalls = 0;
		let sourceReads = 0;
		let pcbSource = options.pcbOnly ? `${source}\n${pcbOnlyLine(200, 1)}` : source;
		const footprintAttrLines = [
			['3fa65b9cbdc2714b', 'gge1'],
			['f631a0e5d0e4ac5f', 'test94-tp2'],
			['f5f9acd53a741c2a', 'test96-tp3'],
		].map(([parentId, uniqueId], index) => {
			const netComponent = Object.values(fixture.netlist.components).find(item => item.props['Unique ID'] === uniqueId);
			const footprint = options.sourceFootprintOverride && index === 0 ? options.sourceFootprintOverride : netComponent.props.Footprint;
			if (options.missingFootprintAttr && index === 0)
				return '';
			return `{"type":"ATTR","ticket":${210 + index},"id":"footprint-attr-${index}"}||{"parentId":"${parentId}","key":"Footprint","value":${JSON.stringify(footprint)}}|`;
		}).join('\n');
		const delayedFootprintLine = `{"type":"ATTR","ticket":210,"id":"footprint-attr-0"}||{"parentId":"3fa65b9cbdc2714b","key":"Footprint","value":"old-project-footprint"}|`;
		const footprintLine = value => `{"type":"ATTR","ticket":210,"id":"footprint-attr-0"}||{"parentId":"3fa65b9cbdc2714b","key":"Footprint","value":${JSON.stringify(value)}}|`;
		pcbSource += `\n${footprintAttrLines}`;
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
			pcbSource = `${replaced}\n{"type":"ATTR","ticket":203,"id":"3fa65b9cbdc2714bee2"}||{"partitionId":"","parentId":"3fa65b9cbdc2714b","key":"Channel ID","value":"$1I2"}|`;
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
				getState_Footprint: () => options.sdkFootprint ?? ({ uuid: libraryFootprintUuid, libraryUuid: 'library-uuid' }),
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
			dmt_EditorControl: { activateDocument: async (uuid) => {
				activated.push(uuid);
				const documentUuid = uuid.split('@')[0];
				focus = documentUuid.includes('page') ? { documentType: 1, uuid: documentUuid, parentProjectUuid: 'project-A' } : { documentType: 3, uuid: documentUuid, parentProjectUuid: 'project-A' };
				return true;
			}, openDocument: async (uuid) => {
				focus = uuid.includes('page') ? { documentType: 1, uuid, parentProjectUuid: 'project-A' } : { documentType: 3, uuid, parentProjectUuid: 'project-A' };
				return `${uuid}@project-A`;
			} },
			sch_ManufactureData: { getNetlistFile: async () => {
				pageNetlistCalls++;
				const netlist = options.conflictPage && pageNetlistCalls > 1 ? options.conflictPage() : fixture.netlist;
				if (options.switchFocusAfterExport)
					focus = { documentType: 3, uuid: 'user-selected-other-pcb', parentProjectUuid: 'project-A' };
				return file(JSON.stringify(netlist));
			} },
			sys_FileManager: {
				getDocumentSource: async () => {
					sourceReads++;
					if (options.delayedObservationReadMs && importCalls > 0 && sourceReads > 1)
						await new Promise(resolve => setTimeout(resolve, options.delayedObservationReadMs));
					if (options.changePcbOnlyAfter && sourceReads > 1)
						return `${source}\n${footprintAttrLines}\n${pcbOnlyLine(200, 1)}\n${pcbOnlyLine(201, 99)}`;
					if (options.footprintReadSequence?.[sourceReads - 1] === 'target')
						return pcbSource.replace(footprintAttrLines.split('\n')[0], footprintLine(fixture.netlist.components.gge1.props.Footprint));
					if (options.footprintReadSequence?.[sourceReads - 1] === 'old')
						return pcbSource.replace(footprintAttrLines.split('\n')[0], delayedFootprintLine);
					if (options.delayedFootprintApplyAfter && sourceReads < options.delayedFootprintApplyAfter)
						return pcbSource.replace(footprintAttrLines.split('\n')[0], delayedFootprintLine);
					return pcbSource;
				},
				getProjectFile: async () => {
					const zip = new JSZip();
					if (!options.missingFootprintResource) {
						zip.file(`FOOTPRINT/${footprintResourceUuid}.efoo`, [
							JSON.stringify(['DOCTYPE', 'FOOTPRINT', '1.8']),
							JSON.stringify(['HEAD', options.missingSourceOnReferencedResource ? { uuid: footprintResourceUuid } : { uuid: footprintResourceUuid, source: `${libraryFootprintUuid}|library-uuid` }]),
							JSON.stringify(['PAD', 'pad-source-1', null, null, null, '1']),
						].join('\n'));
					}
					if (options.unrelatedMissingSourceResource) {
						zip.file('FOOTPRINT/unrelated-footprint.efoo', [
							JSON.stringify(['DOCTYPE', 'FOOTPRINT', '1.8']),
							JSON.stringify(['HEAD', { uuid: 'unrelated-footprint' }]),
						].join('\n'));
					}
					return new File([await zip.generateAsync({ type: 'nodebuffer' })], 'project.epro');
				},
			},
			pcb_PrimitiveComponent: {
				getAll: async () => components,
				getAllPinsByPrimitiveId: async primitiveId => components.find(component => component.getState_PrimitiveId() === primitiveId)?.pins ?? [],
			},
			pcb_Document: { importChanges: async (uuid) => {
				importCalls++;
				assert.equal(uuid, options.schematicUuid ?? schematicUuid);
				if (options.switchProjectAfterImport)
					focus = { documentType: 3, uuid: pcbUuid, parentProjectUuid: 'other-project' };
				else if (options.switchFocusAfterImport)
					focus = { documentType: 3, uuid: 'other-pcb', parentProjectUuid: 'project-A' };
				return options.sdkResult === undefined ? true : options.sdkResult;
			} },
		};
		return {
			activated,
			get importCalls() {
				return importCalls;
			},
			get sourceReads() {
				return sourceReads;
			},
		};
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
			globalThis.eda = { [apiName]: { getNetlistFile: async () => {
				throw new Error('sdk export failed');
			} } };
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

	await check('unrelated epro resources without HEAD.source do not block verified imports', async () => {
		const env = makeEnvironment({ unrelatedMissingSourceResource: true });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.contentsVerified, true);
		assert.equal(env.importCalls, 1);
	});

	await check('project HEAD UUID/current project pair and exact source UUID/library pair both pass', async () => {
		const sourcePairEnv = makeEnvironment();
		const sourcePairResult = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(sourcePairResult.contentsVerified, true);
		assert.equal(sourcePairEnv.importCalls, 1);
		const projectPairEnv = makeEnvironment({ sdkFootprint: { uuid: footprintResourceUuid, libraryUuid: 'project-A' } });
		const projectPairResult = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(projectPairResult.contentsVerified, true);
		assert.equal(projectPairEnv.importCalls, 1);
	});

	await check('binding rejects wrong library/project, ATTR conflict, and missing resource with UUID evidence', async () => {
		const cases = [
			['wrong source library', { sdkFootprint: { uuid: libraryFootprintUuid, libraryUuid: 'wrong-library' } }, /期望 ATTR\/project UUID=.*实际 SDK/],
			['SDK/ATTR UUID conflict', { sdkFootprint: { uuid: 'different-footprint', libraryUuid: 'library-uuid' } }, /SDK \(different-footprint, library-uuid\)/],
			['same source in wrong project', { sdkFootprint: { uuid: footprintResourceUuid, libraryUuid: 'other-project' } }, /期望 ATTR\/project UUID=.*当前工程=project-A/],
			['ATTR conflict', { sourceFootprintOverride: 'different-footprint' }, /PCB ATTR Footprint 与 JLCEDA 网表不一致/],
			['missing ATTR', { missingFootprintAttr: true }, /PCB ATTR Footprint 与 JLCEDA 网表不一致.*实际 ATTR=缺失/],
			['missing resource', { missingFootprintResource: true }, /缺少与 PCB ATTR Footprint 对应的封装资源/],
			['referenced resource without HEAD.source', { missingSourceOnReferencedResource: true }, /缺少与 PCB ATTR Footprint 对应的封装资源/],
		];
		for (const [label, options, evidence] of cases) {
			const env = makeEnvironment(options);
			const error = await pcb('pcb.importChanges').handler({ _timeoutMs: 3000 }, {}).catch(reason => reason);
			assert.ok(error instanceof Error, `${label}: returns an error`);
			assert.equal(error.cause?.partial, true, `${label}: import already ran`);
			assert.equal(error.cause?.retryable, false, `${label}: no automatic retry`);
			if (label === 'ATTR conflict' || label === 'missing ATTR') {
				assert.equal(error.cause?.applicationState, 'unconfirmed', `${label}: target Footprint has not appeared by the bounded observation deadline`);
				assert.equal(error.cause?.reason, 'verification-deadline');
				assert.ok(error.cause?.lastDifferences.some(item => item.includes('等待 PCB Footprint ATTR=')), `${label}: includes the last target SOURCE difference`);
			}
			else {
				assert.ok(error.cause?.verification?.differences.some(item => evidence.test(item)), `${label}: includes expected/actual binding evidence: ${JSON.stringify(error.cause?.verification?.differences)}`);
			}
			assert.equal(env.importCalls, 1, `${label}: import runs once`);
		}
	});

	await check('focus project UUID must match the Board project before import', async () => {
		const env = makeEnvironment();
		const original = globalThis.eda.dmt_SelectControl.getCurrentDocumentInfo;
		globalThis.eda.dmt_SelectControl.getCurrentDocumentInfo = async () => ({ documentType: 3, uuid: pcbUuid, parentProjectUuid: 'other-project' });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, undefined);
		assert.match(error.message, /期望 projectUuid=project-A; 实际 projectUuid=other-project/);
		globalThis.eda.dmt_SelectControl.getCurrentDocumentInfo = original;
		assert.equal(env.importCalls, 0);
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

	await check('SDK true waits for delayed footprint SOURCE application, requires two stable target reads, and imports only once', async () => {
		const env = makeEnvironment({ delayedFootprintApplyAfter: 4 });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.contentsVerified, true);
		assert.equal(result.sdkResult, true);
		assert.equal(env.importCalls, 1);
		assert.equal(env.sourceReads, 6, 'one pre-import snapshot, two unsettled observations, two stable observations, and one full verification read');
	});

	await check('an unstable target observation resets stability and waits for a fresh consecutive match', async () => {
		const env = makeEnvironment({ footprintReadSequence: ['old', 'target', 'old', 'target', 'target', 'target'] });
		const result = await pcb('pcb.importChanges').handler({}, {});
		assert.equal(result.contentsVerified, true);
		assert.equal(env.importCalls, 1);
		assert.equal(env.sourceReads, 6, 'the old snapshot between matching observations must reset the stability pair');
	});

	await check('SDK true with no applied target returns bounded unconfirmed partial evidence', async () => {
		const env = makeEnvironment({ sourceFootprintOverride: 'old-project-footprint' });
		const error = await pcb('pcb.importChanges').handler({ _timeoutMs: 3000 }, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.sdkResult, true);
		assert.equal(error.cause?.applicationState, 'unconfirmed');
		assert.equal(error.cause?.reason, 'verification-deadline');
		assert.ok(Array.isArray(error.cause?.lastDifferences));
		assert.ok(error.cause?.observedMs > 0);
		assert.equal(env.importCalls, 1);
	});

	await check('focus or project change after import stops observation immediately', async () => {
		const env = makeEnvironment({ delayedFootprintApplyAfter: 10, switchFocusAfterImport: true });
		const error = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.match(error.message, /焦点身份不符/);
		assert.equal(env.importCalls, 1);
		const projectEnv = makeEnvironment({ delayedFootprintApplyAfter: 10, switchProjectAfterImport: true });
		const projectError = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(projectError instanceof Error);
		assert.equal(projectError.cause?.partial, true);
		assert.equal(projectError.cause?.retryable, false);
		assert.match(projectError.message, /工程身份不符/);
		assert.equal(projectEnv.importCalls, 1);
	});

	await check('an observation read resolving after its deadline cannot start verification or another SDK read/import', async () => {
		const env = makeEnvironment({ delayedFootprintApplyAfter: 100, delayedObservationReadMs: 1800 });
		const started = performance.now();
		const error = await pcb('pcb.importChanges').handler({ _timeoutMs: 1400 }, {}).catch(reason => reason);
		const elapsedMs = performance.now() - started;
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.partial, true);
		assert.equal(error.cause?.retryable, false);
		assert.equal(error.cause?.applicationState, 'unconfirmed');
		assert.equal(error.cause?.reason, 'verification-deadline');
		assert.ok(elapsedMs < 1300, `returns before the late source read resolves (elapsed ${elapsedMs}ms)`);
		assert.equal(env.importCalls, 1);
		assert.equal(env.sourceReads, 2, 'only the initial snapshot and one timed-out observation were started');
		await new Promise(resolve => setTimeout(resolve, 1900));
		assert.equal(env.sourceReads, 2, 'late source resolution must not trigger another read or full verification');
		assert.equal(env.importCalls, 1, 'late source resolution must not trigger another import');
	});

	await check('stable target footprint still runs full network and PCB-only verification', async () => {
		const wrongNet = makeEnvironment({ delayedFootprintApplyAfter: 4, wrongNet: true });
		const networkError = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(networkError instanceof Error);
		assert.equal(networkError.cause?.partial, true);
		assert.ok(networkError.cause?.verification?.differences.some(item => item.includes('期望网络')));
		assert.equal(wrongNet.importCalls, 1);
		const pcbOnly = makeEnvironment({ delayedFootprintApplyAfter: 4, changePcbOnlyAfter: true });
		const pcbOnlyError = await pcb('pcb.importChanges').handler({}, {}).catch(reason => reason);
		assert.ok(pcbOnlyError instanceof Error);
		assert.equal(pcbOnlyError.cause?.partial, true);
		assert.equal(pcbOnlyError.cause?.verification?.pcbOnlyPreserved, false);
		assert.equal(pcbOnly.importCalls, 1);
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
		registerCommand({ name: 'test.importMarker', summary: 'marker', params: [], returns: '{}', handler: async () => {
			markerWrites++;
			return {};
		} });
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
		registerCommand({ name: 'test.importMarker', summary: 'marker', params: [], returns: '{}', handler: async () => {
			markerWrites++;
			return {};
		} });
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
