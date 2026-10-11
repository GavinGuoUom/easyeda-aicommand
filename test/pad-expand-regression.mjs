import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

async function main() {
	const root = resolve(import.meta.dirname, '..');
	const built = await build({
		stdin: {
			contents: 'import { padExpansionCommands } from \'../src/commands/padExpand.ts\'; import { polygonSourcesEqual, splitAnnulus } from \'../src/pcb/padExpand/geometry.ts\'; export { padExpansionCommands, polygonSourcesEqual, splitAnnulus }',
			resolveDir: resolve(root, 'test'),
			sourcefile: 'pad-expand-regression-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
	const { padExpansionCommands, polygonSourcesEqual, splitAnnulus } = await import(moduleUrl);
	const command = name => padExpansionCommands.find(item => item.name === name);
	const docHead = uuid => `${JSON.stringify({ type: 'DOCHEAD', ticket: 0 })}||${JSON.stringify({ docType: 'PCB', uuid, client: 'pad-expand-test' })}|`;
	const rules = { config: { spacingMil: 8 } };

	function pad(id, { x = 500, y = 500, layer = 1, shape = ['ELLIPSE', 40, 40], rotation = 0, parent = undefined, source = undefined } = {}) {
		return {
			getState_PrimitiveId: () => id,
			getState_Layer: () => layer,
			getState_Pad: () => shape,
			getState_X: () => x,
			getState_Y: () => y,
			getState_Rotation: () => rotation,
			getState_SpecialPad: () => [],
			getState_PadNumber: () => '1',
			getState_Net: () => 'N1',
			...(parent ? { getState_ParentComponentPrimitiveId: () => parent } : {}),
			...(source ? { getState_ComplexPolygon: () => ({ getSource: () => source }) } : {}),
		};
	}
	function component(id, pins) {
		return {
			getState_PrimitiveId: () => id,
			getAllPins: async () => pins,
		};
	}
	function install({ pads = [], components = [], standalone = [], regionCreate = undefined, fillCreate = undefined, readbackPolygon = undefined, sourceReadbackPolygon = undefined, readbackId = undefined, readbackLineWidth = undefined, sourceLineWidth = undefined, sourceNetName = undefined, sourceNetNameMissing = false, actualFillNet = undefined, missingFillNetGetter = false, swapFocusOnNextCreate = false, source = docHead('pcb-A'), existingRegions = [], existingFills = [] } = {}) {
		const state = { writes: [], pads, components, standalone: new Map(standalone.map(item => [item.getState_PrimitiveId(), item])), regions: new Map(existingRegions.map(item => [item.getState_PrimitiveId(), item])), fills: new Map(existingFills.map(item => [item.getState_PrimitiveId(), item])), source, sourceReadbackPolygon, sourceLineWidth, sourceNetName, sourceNetNameMissing, actualFillNet, missingFillNetGetter, readbackPolygon, readbackId, readbackLineWidth, nextId: 1, nextTicket: 1, swapFocusAfterCreate: false, swapFocusOnNextCreate };
		const makePolygon = sources => ({ getSource: () => sources });
		const appendSource = (type, id, data) => {
			state.source += `\n${JSON.stringify({ type, id, ticket: state.nextTicket++ })}||${JSON.stringify(data)}|`;
		};
		const sdk = {
			dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ uuid: state.swapFocusAfterCreate ? 'pcb-B' : 'pcb-A', documentType: 3 }) },
			sys_FileManager: { getDocumentSource: async () => state.source },
			pcb_Drc: { getCurrentRuleConfiguration: async () => rules },
			pcb_MathPolygon: { createPolygon: source => makePolygon(source), createComplexPolygon: sources => makePolygon(sources) },
			pcb_PrimitiveComponent: { getAll: async () => [...state.components] },
			pcb_PrimitivePad: {
				get: async ids => ids.map(id => state.standalone.get(id)).filter(Boolean),
			},
			pcb_PrimitiveRegion: {
				getAll: async () => [...state.regions.values()],
				create: async (layer, polygon, ruleType, name, lineWidth, lock) => {
					state.writes.push('region.create');
					if (regionCreate === 'throw')
						throw new Error('mock region failure');
					const id = `REGION-${state.nextId++}`;
					const geometry = state.readbackPolygon ?? polygon.getSource();
					const prohibitType = ruleType.includes(7) ? ['COPPER'] : ['FILL'];
					const value = {
						getState_PrimitiveId: () => id,
						getState_PrimitiveType: () => 'Region',
						getState_Layer: () => layer,
						getState_RuleType: () => ruleType,
						getState_LineWidth: () => lineWidth,
						getState_PrimitiveLock: () => lock,
						getState_ComplexPolygon: () => makePolygon(geometry),
					};
					state.regions.set(id, value);
					appendSource('REGION', id, { path: state.sourceReadbackPolygon ?? polygon.getSource(), layerId: layer, width: state.sourceLineWidth ?? lineWidth, prohibitType, name: name ?? 'PROHIBIT', regionType: 'PROHIBIT', locked: lock });
					if (state.swapFocusOnNextCreate) {
						state.swapFocusAfterCreate = true;
						state.swapFocusOnNextCreate = false;
					}
					return value;
				},
				get: async (id) => {
					const value = state.regions.get(id);
					if (!value)
						return value;
					const copy = Object.create(value);
					if (state.readbackId !== undefined)
						copy.getState_PrimitiveId = () => state.readbackId;
					if (state.readbackLineWidth !== undefined)
						copy.getState_LineWidth = () => state.readbackLineWidth;
					return copy;
				},
			},
			pcb_PrimitiveFill: {
				getAll: async () => [...state.fills.values()],
				create: async (layer, polygon, net = '', fillMode = 0, lineWidth = 0, lock = false) => {
					state.writes.push('fill.create');
					if (fillCreate === 'throw')
						throw new Error('mock fill failure');
					const id = `FILL-${state.nextId++}`;
					const geometry = state.readbackPolygon ?? [polygon.getSource()[0]];
					const persistedGeometry = state.sourceReadbackPolygon ?? polygon.getSource();
					const value = {
						getState_PrimitiveId: () => id,
						getState_PrimitiveType: () => 'Fill',
						getState_Layer: () => layer,
						getState_ComplexPolygon: () => makePolygon(geometry),
						...(state.missingFillNetGetter ? {} : { getState_Net: () => state.actualFillNet === undefined ? net : state.actualFillNet }),
						getState_FillMode: () => fillMode,
						getState_LineWidth: () => state.readbackLineWidth ?? lineWidth,
						getState_PrimitiveLock: () => lock,
					};
					state.fills.set(id, value);
					const sourceData = { path: persistedGeometry, layerId: layer, width: state.sourceLineWidth ?? lineWidth, fillStyle: 'SOLID', netName: state.sourceNetName === undefined ? net : state.sourceNetName, locked: lock };
					if (state.sourceNetNameMissing)
						delete sourceData.netName;
					appendSource('FILL', id, sourceData);
					if (state.swapFocusOnNextCreate) {
						state.swapFocusAfterCreate = true;
						state.swapFocusOnNextCreate = false;
					}
					return value;
				},
				get: async (id) => {
					const value = state.fills.get(id);
					if (!value)
						return value;
					const copy = Object.create(value);
					if (state.readbackId !== undefined)
						copy.getState_PrimitiveId = () => state.readbackId;
					if (state.readbackLineWidth !== undefined)
						copy.getState_LineWidth = () => state.readbackLineWidth;
					return copy;
				},
			},
		};
		globalThis.eda = sdk;
		return { state, sdk };
	}
	const params = (extra = {}) => ({ __docUuid: 'pcb-A', targetIds: ['PAD-A'], expansion: 5, generationType: 'noPours', ...extra });
	const plan = request => command('pcb.getPadExpansionPlan').handler(request);
	const execute = value => command('pcb.expandPads').handler({ __docUuid: 'pcb-A', plan: JSON.parse(JSON.stringify(value)) });
	let passed = 0;
	async function test(name, fn) {
		try {
			await fn();
			console.log(`PASS ${name}`);
			passed++;
		}
		catch (error) {
			console.error(`FAIL ${name}: ${error?.message ?? error}`);
			process.exitCode = 1;
		}
	}

	await test('registers the two structured commands', () => {
		assert.deepEqual(padExpansionCommands.map(item => item.name), ['pcb.getPadExpansionPlan', 'pcb.expandPads']);
	});
	await test('polygon readback preserves hole winding and allows a global winding reversal', () => {
		const outer = [0, 0, 'L', 20, 0, 20, 20, 0, 20, 0, 0];
		const hole = [5, 5, 'L', 5, 15, 15, 15, 15, 5, 5, 5];
		const reversedOuter = [0, 20, 'L', 20, 20, 20, 0, 0, 0, 0, 20];
		const reversedHole = [5, 5, 'L', 15, 5, 15, 15, 5, 15, 5, 5];
		assert.equal(polygonSourcesEqual([outer, hole], [hole, outer]), true);
		assert.equal(polygonSourcesEqual([outer, hole], [reversedOuter, reversedHole]), true);
		assert.equal(polygonSourcesEqual([outer, hole], [outer, reversedHole]), false);
		assert.equal(polygonSourcesEqual([outer, hole], [outer]), false);
	});
	await test('floating point geometry allows 1e-4 mil serialization tolerance and rejects larger drift', () => {
		const outer = [0.123456, 0.987654, 'L', 20.222222, 0.987654, 20.222222, 20.111111, 0.123456, 20.111111, 0.123456, 0.987654];
		const rounded = [0.1235, 0.9877, 'L', 20.2222, 0.9877, 20.2222, 20.1111, 0.1235, 20.1111, 0.1235, 0.9877];
		const drifted = [0.1238, 0.9877, 'L', 20.2222, 0.9877, 20.2222, 20.1111, 0.1235, 20.1111, 0.1238, 0.9877];
		assert.equal(polygonSourcesEqual([outer], [rounded]), true);
		assert.equal(polygonSourcesEqual([outer], [drifted]), false);
	});
	await test('circle, rotated rect, rounded rect, rotated ellipse, and rotated oval split into two equivalent C-shaped region pieces', async () => {
		const cases = [
			[['ELLIPSE', 40, 40], 0],
			[['RECT', 40, 24, 0], 37],
			[['RECT', 40, 24, 4], 31],
			[['ELLIPSE', 40, 24], 63],
			[['OVAL', 40, 24], 42],
		];
		for (const [shape, rotation] of cases) {
			const kind = shape[0];
			const source = pad('PAD-A', { shape, rotation });
			const f = install({ standalone: [source] });
			const result = await plan(params());
			assert.equal(result.executable, true, JSON.stringify(result.warnings));
			assert.equal(result.plannedPrimitives.length, 2, `${kind} must be split into two regions`);
			assert.ok(result.plannedPrimitives.every(item => item.polygonSources.length === 1), `${kind} pieces must not have holes`);
			assert.ok(result.plannedPrimitives.every(item => item.annulusSources.length === 2), `${kind} source ring must preserve the inner boundary`);
			assert.equal(f.state.writes.length, 0);
		}
		for (const shape of [['NGON', 40, 6], ['POLYGON', [0, 0, 'L', 40, 0, 40, 24, 0, 24, 0, 0]]]) {
			const f = install({ standalone: [pad('PAD-A', { shape })] });
			const result = await plan(params());
			assert.equal(result.executable, false);
			assert.equal(result.targets[0].supported, false);
			assert.equal(f.state.writes.length, 0);
		}
	});
	await test('split annulus validates a two-piece union without crossing the center pad opening', () => {
		const points = [[10, -12], [28, -20], [46, -12], [54, 6], [46, 24], [28, 32], [10, 24], [2, 6], [10, -12]];
		const result = splitAnnulus(points, 5);
		assert.equal(result.annulusSources.length, 2);
		assert.equal(result.pieces.length, 2);
		assert.ok(result.pieces.every(piece => piece.length === 1));
		assert.ok(result.pieces.every(piece => polygonSourcesEqual(piece, piece)));
	});
	await test('top, bottom, and multilayer pads map to correct outputs', async () => {
		for (const [layer, expected] of [[1, [[1, 'top']]], [2, [[2, 'bottom']]], [12, [[1, 'top'], [2, 'bottom']]]]) {
			const source = pad('PAD-A', { layer });
			install({ standalone: [source] });
			const result = await plan(params({ generationType: 'noFills' }));
			assert.equal(result.executable, true);
			assert.deepEqual([...new Map(result.plannedPrimitives.map(item => [`${item.output.layer}:${item.side}`, [item.output.layer, item.side]])).values()], expected);
		}
		const throughHole = pad('PTH-A', { layer: 12 });
		const f = install({ standalone: [throughHole] });
		const result = await plan(params({ targetIds: ['PTH-A'], generationType: 'solderMask' }));
		assert.equal(result.plannedPrimitives.length, 2);
		assert.deepEqual(result.plannedPrimitives.map(item => item.output.layer), [5, 6]);
		assert.equal(f.state.writes.length, 0);
	});
	await test('mixed component and pad targets expand once with duplicate IDs deduplicated', async () => {
		const componentPad = pad('CPAD-A', { parent: 'COMP-A' });
		const f = install({ components: [component('COMP-A', [componentPad])], standalone: [pad('PAD-B')] });
		const result = await plan(params({ targetIds: ['COMP-A', 'CPAD-A', 'PAD-B', 'PAD-B'] }));
		assert.equal(result.executable, true);
		assert.deepEqual(result.targets.map(item => item.id), ['CPAD-A', 'PAD-B']);
		assert.equal(result.plannedPrimitives.length, 4);
		assert.equal(f.state.writes.length, 0);
	});
	await test('inner layer and special pad geometry are explicitly unsupported and never write', async () => {
		for (const source of [pad('PAD-A', { layer: 15 }), { ...pad('PAD-A'), getState_SpecialPad: () => [[1, 2, ['ELLIPSE', 20, 20]]] }]) {
			const f = install({ standalone: [source] });
			const result = await plan(params());
			assert.equal(result.executable, false);
			assert.equal(result.targets[0].supported, false);
			assert.equal(f.state.writes.length, 0);
		}
	});
	await test('invalid inputs and stale or tampered plans cannot write', async () => {
		for (const bad of [{ expansion: 0 }, { expansion: Number.NaN }, { generationType: 'unknown' }, { targetIds: [] }])
			await assert.rejects(() => plan(params(bad)));
		let f = install({ standalone: [pad('PAD-A')] });
		let value = await plan(params());
		value.plannedPrimitives[0].output.layer = 2;
		let error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(f.state.writes.length, 0);
		f = install({ standalone: [pad('PAD-A')] });
		value = await plan(params());
		f.state.source += '\nchanged';
		error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(f.state.writes.length, 0);
	});
	await test('solder mask and both direct-region rule semantics execute and read back at explicit 0.2 line width', async () => {
		for (const [generationType, expectedLayer, expectedRule] of [['noPours', 1, 7], ['noFills', 1, 6], ['solderMask', 5, undefined]]) {
			const f = install({ standalone: [pad('PAD-A')] });
			const value = await plan(params({ generationType }));
			const result = await execute(value);
			assert.equal(result.created.length, generationType === 'solderMask' ? 1 : 2);
			assert.equal(result.created[0].layer, expectedLayer);
			assert.equal(result.created[0].lineWidth, 0.2);
			if (generationType === 'solderMask') {
				assert.equal(result.created[0].sourceReadback.pathMatches, true);
				assert.equal(result.created[0].polygonSources.length, 1);
			}
			if (expectedRule !== undefined)
				assert.deepEqual(result.created[0].ruleType, [expectedRule]);
			assert.equal(f.state.writes.length, generationType === 'solderMask' ? 1 : 2);
			if (generationType !== 'solderMask')
				assert.deepEqual(f.state.writes, ['region.create', 'region.create']);
		}
	});
	await test('create failure stops after first object and reports partial without retry', async () => {
		const first = pad('PAD-A');
		const second = pad('PAD-B', { x: 600 });
		const f = install({ standalone: [first, second], regionCreate: 'throw' });
		const value = await plan(params({ targetIds: ['PAD-A', 'PAD-B'] }));
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(f.state.writes.length, 1);
		assert.equal(error.cause?.partial, true);
		assert.deepEqual(error.cause?.createdIds, []);
	});
	await test('independent geometry readback mismatch stops remaining objects', async () => {
		const first = pad('PAD-A');
		const second = pad('PAD-B', { x: 600 });
		const f = install({ standalone: [first, second] });
		const value = await plan(params({ targetIds: ['PAD-A', 'PAD-B'] }));
		f.state.readbackPolygon = [[0, 0, 'L', 1, 0, 1, 1, 0, 1, 0, 0]];
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(f.state.writes.length, 1);
		assert.equal(error.cause?.partial, true);
		assert.deepEqual(error.cause?.createdIds, ['REGION-1']);
	});
	await test('readback must return the requested primitive ID and 0.2 line width', async () => {
		for (const override of [{ readbackId: 'WRONG-ID' }, { readbackLineWidth: 0.1 }]) {
			const f = install({ standalone: [pad('PAD-A')], ...override });
			const value = await plan(params({ generationType: 'solderMask' }));
			const error = await execute(value).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(error.cause?.partial, true);
			assert.equal(f.state.writes.length, 1);
		}
		const f = install({ standalone: [pad('PAD-A')], readbackId: 'WRONG-ID' });
		const value = await plan(params({ generationType: 'noFills' }));
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.padExpansionReadback?.actualId, 'WRONG-ID');
		assert.equal(f.state.writes.length, 1);
	});
	await test('fill SDK outer ring is backed by the full two-ring current source; a missing source hole is rejected', async () => {
		let f = install({ standalone: [pad('PAD-A')] });
		let value = await plan(params({ generationType: 'solderMask' }));
		const result = await execute(value);
		assert.equal(result.created[0].polygonSources.length, 1);
		assert.equal(result.created[0].sourceReadback.pathMatches, true);
		f = install({ standalone: [pad('PAD-A')] });
		value = await plan(params({ generationType: 'solderMask' }));
		f.state.sourceReadbackPolygon = [value.plannedPrimitives[0].polygonSources[0]];
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.padExpansionSourceReadback?.pathMatches, false);
		assert.equal(f.state.writes.length, 1);
	});
	await test('source readback rejects nonempty SDK fill net and any non-0.2 line width', async () => {
		for (const override of [{ actualFillNet: 'N1' }, { sourceLineWidth: 0.3 }, { readbackLineWidth: 0.3 }]) {
			const f = install({ standalone: [pad('PAD-A')], ...override });
			const value = await plan(params({ generationType: 'solderMask' }));
			const error = await execute(value).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(error.cause?.partial, true);
			assert.equal(f.state.writes.length, 1);
		}
		const f = install({ standalone: [pad('PAD-A')], missingFillNetGetter: true });
		const value = await plan(params({ generationType: 'solderMask' }));
		const result = await execute(value);
		assert.equal(result.created[0].sourceReadback.net, '');
		assert.equal(result.created[0].sourceReadback.sdkNetKind, 'undefined');
		assert.equal(f.state.writes.length, 1);
	});
	await test('SDK null fill net is accepted only with an explicitly empty current-source net name', async () => {
		let f = install({ standalone: [pad('PAD-A')], actualFillNet: null });
		let value = await plan(params({ generationType: 'solderMask' }));
		const result = await execute(value);
		assert.equal(result.created[0].sourceReadback.net, '');
		assert.equal(result.created[0].sourceReadback.sdkNetKind, 'null');
		assert.equal(f.state.writes.length, 1);

		for (const override of [{ sourceNetName: 'N3' }, { sourceNetName: null }, { sourceNetNameMissing: true }]) {
			f = install({ standalone: [pad('PAD-A')], actualFillNet: null, ...override });
			value = await plan(params({ generationType: 'solderMask' }));
			const error = await execute(value).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(error.cause?.padExpansionSourceReadback?.sdkNetKind, 'null');
			assert.equal(error.cause?.padExpansionSourceReadback?.netMatches, false);
			assert.equal(error.cause?.partial, true);
			assert.equal(f.state.writes.length, 1);
		}
	});
	await test('SDK fill net rejects NaN, Infinity, objects, and nonempty strings', async () => {
		for (const actualFillNet of [Number.NaN, Number.POSITIVE_INFINITY, {}, 'N4']) {
			const f = install({ standalone: [pad('PAD-A')], actualFillNet });
			const value = await plan(params({ generationType: 'solderMask' }));
			const error = await execute(value).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(error.cause?.padExpansionReadback?.modeMatches, false);
			assert.equal(error.cause?.padExpansionReadback?.sdkNetKind, typeof actualFillNet);
			assert.equal(f.state.writes.length, 1);
		}
	});
	await test('current source nonempty fill net is rejected when the SDK net getter is empty or missing', async () => {
		for (const override of [{ sourceNetName: 'N2' }, { sourceNetName: 'N2', missingFillNetGetter: true }]) {
			const f = install({ standalone: [pad('PAD-A')], ...override });
			const value = await plan(params({ generationType: 'solderMask' }));
			const error = await execute(value).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(error.cause?.padExpansionSourceReadback?.actualNet, 'N2');
			assert.equal(error.cause?.padExpansionSourceReadback?.netMatches, false);
			assert.equal(error.cause?.partial, true);
			assert.equal(f.state.writes.length, 1);
		}
	});
	await test('current source inner ring cannot reverse independently when SDK reports only the outer ring', async () => {
		const f = install({ standalone: [pad('PAD-A')] });
		const value = await plan(params({ generationType: 'solderMask' }));
		const [outer, inner] = value.plannedPrimitives[0].polygonSources;
		const vertices = [];
		for (let index = 0; index < inner.length;) {
			if (inner[index] === 'L') {
				index++;
				continue;
			}
			vertices.push([inner[index], inner[index + 1]]);
			index += 2;
		}
		const reversedVertices = vertices.slice(0, -1).reverse();
		const reversedInner = [reversedVertices[0][0], reversedVertices[0][1], 'L', ...reversedVertices.slice(1).flat(), ...reversedVertices[0]];
		f.state.sourceReadbackPolygon = [outer, reversedInner];
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(error.cause?.padExpansionSourceReadback?.pathMatches, false);
		assert.equal(f.state.writes.length, 1);
	});
	await test('focus swap immediately after region creation records the ID before stopping', async () => {
		const f = install({ standalone: [pad('PAD-A')], swapFocusOnNextCreate: true });
		const value = await plan(params());
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.match(error.message, /焦点已离开/);
		assert.deepEqual(error.cause?.createdIds, ['REGION-1']);
		assert.equal(f.state.writes.length, 1);
	});
	await test('an ID already present before create is never accepted as a new object', async () => {
		const oldRegion = { getState_PrimitiveId: () => 'REGION-1' };
		const f = install({ standalone: [pad('PAD-A')], existingRegions: [oldRegion] });
		const value = await plan(params());
		const error = await execute(value).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.match(error.message, /执行前已存在/);
		assert.equal(f.state.writes.length, 1);
	});
	await test('floating-point rings retain geometry across cyclic and reversed readback', async () => {
		const points = Array.from({ length: 7 }, (_, index) => [3 * 13.72 + (20 + index) * Math.cos(index * 2 * Math.PI / 7), 3 * 9.345 + (20 + index) * Math.sin(index * 2 * Math.PI / 7)]);
		const encode = vertices => [vertices[0][0], vertices[0][1], 'L', ...vertices.slice(1).flat(), ...vertices[0]];
		const reordered = [...points.slice(2), ...points.slice(0, 2)].reverse();
		assert.equal(polygonSourcesEqual([encode(points)], [encode(reordered)]), true);
		const degenerate = [0, 0, 'L', 1, 1, 2, 2, 0, 0];
		assert.equal(polygonSourcesEqual([degenerate], [degenerate]), false);
	});
	await test('complete plans require a document UUID and a matching executable value', async () => {
		for (const documentUuid of [undefined, '', '   ']) {
			const f = install({ standalone: [pad('PAD-A')] });
			const value = await plan(params());
			value.documentUuid = documentUuid;
			await assert.rejects(() => execute(value), /documentUuid/);
			assert.equal(f.state.writes.length, 0);
		}
		const f = install({ standalone: [pad('PAD-A')] });
		const value = await plan(params());
		value.executable = 'true';
		await assert.rejects(() => execute(value), /executable/);
		assert.equal(f.state.writes.length, 0);
	});
	console.log(`Passed ${passed} pad expansion regression checks`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
