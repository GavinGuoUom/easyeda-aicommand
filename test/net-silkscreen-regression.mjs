import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

async function main() {
	const root = resolve(import.meta.dirname, '..');
	const built = await build({
		stdin: {
			contents: 'import { netSilkscreenCommands } from \'../src/commands/netSilkscreen.ts\'; export { netSilkscreenCommands }',
			resolveDir: resolve(root, 'test'),
			sourcefile: 'net-silkscreen-regression-entry.ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		target: 'node24',
	});
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
	const { netSilkscreenCommands } = await import(moduleUrl);
	const command = name => netSilkscreenCommands.find(item => item.name === name);
	const docHead = uuid => `${JSON.stringify({ type: 'DOCHEAD', ticket: 0 })}||${JSON.stringify({ docType: 'PCB', uuid, client: 'net-silkscreen-test' })}|`;
	const rules = { config: { spacingMil: 8 }, name: 'test' };

	function pad(id, options = {}) {
		const net = Object.hasOwn(options, 'net') ? options.net : 'N1';
		const { parent = undefined, padNumber = '1', rotation = 0 } = options;
		return {
			getState_PrimitiveId: () => id,
			getState_Net: () => net,
			getState_ParentComponentPrimitiveId: () => parent,
			getState_PadNumber: () => padNumber,
			getState_Rotation: () => rotation,
		};
	}
	function component(id, pins) {
		return { getState_PrimitiveId: () => id, getAllPins: async () => pins };
	}
	function stringObject(id, values) {
		return {
			getState_PrimitiveId: () => id,
			getState_Layer: () => values.layer,
			getState_X: () => values.x,
			getState_Y: () => values.y,
			getState_Text: () => values.text,
			getState_FontFamily: () => values.fontFamily,
			getState_FontSize: () => values.fontSize,
			getState_LineWidth: () => values.lineWidth,
			getState_AlignMode: () => values.alignMode,
			getState_Rotation: () => values.rotation,
			getState_Reverse: () => values.reverse,
			getState_Expansion: () => values.expansion,
			getState_Mirror: () => values.mirror,
			getState_PrimitiveLock: () => values.primitiveLock,
		};
	}
	function install({ pads = [pad('P1')], components = [], bounds = new Map([['P1', { minX: 90, minY: 180, maxX: 130, maxY: 220 }]]), existingStrings = [], createMode, mutateReadback, focusAfterCreate = false } = {}) {
		const state = { source: docHead('pcb-A'), rules, writes: [], createArgs: [], components, pads, bounds, strings: new Map(existingStrings.map(item => [item.getState_PrimitiveId(), item])), nextId: 1, createMode, mutateReadback, focusAfterCreate, focusSwitched: false };
		const sdk = {
			dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ uuid: state.focusSwitched ? 'pcb-B' : 'pcb-A', documentType: 3 }) },
			sys_FileManager: { getDocumentSource: async () => state.source },
			pcb_Drc: { getCurrentRuleConfiguration: async () => state.rules },
			pcb_PrimitiveComponent: { getAll: async () => [...state.components] },
			pcb_PrimitivePad: { get: async ids => ids.map(id => state.pads.find(item => item.getState_PrimitiveId() === id)).filter(Boolean) },
			pcb_Primitive: { getPrimitivesBBox: async ids => state.bounds.get(typeof ids[0] === 'string' ? ids[0] : ids[0].getState_PrimitiveId()) },
			pcb_PrimitiveString: {
				getAll: async () => [...state.strings.values()],
				create: async (...args) => {
					state.writes.push('create');
					state.createArgs.push(args);
					if (state.createMode === 'false')
						return false;
					if (state.createMode === 'existing')
						return stringObject('OLD', { layer: args[0], x: args[1], y: args[2], text: args[3], fontFamily: args[4], fontSize: args[5], lineWidth: args[6], alignMode: args[7], rotation: args[8], mirror: args[11] });
					const id = `STR-${state.nextId++}`;
					const values = { layer: args[0], x: args[1], y: args[2], text: args[3], fontFamily: args[4], fontSize: args[5], lineWidth: args[6], alignMode: args[7], rotation: args[8], reverse: args[9], expansion: args[10], mirror: args[11], primitiveLock: args[12] };
					state.strings.set(id, stringObject(id, values));
					if (state.focusAfterCreate)
						state.focusSwitched = true;
					return stringObject(id, values);
				},
				get: async (id) => {
					const value = state.strings.get(id);
					if (!value || !state.mutateReadback)
						return value;
					const values = Object.fromEntries(['Layer', 'X', 'Y', 'Text', 'FontFamily', 'FontSize', 'LineWidth', 'AlignMode', 'Rotation', 'Reverse', 'Expansion', 'Mirror', 'PrimitiveLock'].map(key => [key[0].toLowerCase() + key.slice(1), value[`getState_${key}`]()]));
					values[state.mutateReadback] = values[state.mutateReadback] === 'bad' ? 'good' : values[state.mutateReadback] + 1;
					return stringObject(id, values);
				},
			},
		};
		globalThis.eda = sdk;
		return { state, sdk };
	}
	const baseParams = (extra = {}) => ({ __docUuid: 'pcb-A', targetIds: ['P1'], layer: 'top-silk', position: 'right', offset: 10, ...extra });
	const makePlan = request => command('pcb.getNetSilkscreenPlan').handler(request);
	const execute = plan => command('pcb.generateNetSilkscreen').handler({ __docUuid: 'pcb-A', plan: JSON.parse(JSON.stringify(plan)) });
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

	await test('exports exactly the two plan and generate commands', () => {
		assert.deepEqual(netSilkscreenCommands.map(item => item.name), ['pcb.getNetSilkscreenPlan', 'pcb.generateNetSilkscreen']);
	});
	await test('JSON round trip, Unicode nets and two GND pads stay separate', async () => {
		const f = install({
			pads: [pad('P1', { net: '地线🌱' }), pad('P2', { net: 'GND' }), pad('P3', { net: 'GND' })],
			bounds: new Map([
				['P1', { minX: 10, minY: 20, maxX: 30, maxY: 50 }],
				['P2', { minX: 100, minY: 200, maxX: 120, maxY: 230 }],
				['P3', { minX: 300, minY: 400, maxX: 320, maxY: 430 }],
			]),
		});
		const plan = await makePlan(baseParams({ targetIds: ['P1', 'P2', 'P3', 'P2'], fontFamily: 'Arial', fontSize: 37, lineWidth: 5, rotation: 15, mirror: true }));
		const roundTripped = JSON.parse(JSON.stringify(plan));
		assert.equal(roundTripped.executable, true);
		assert.deepEqual(roundTripped.plannedStrings.map(item => [item.padId, item.text]), [['P1', '地线🌱'], ['P2', 'GND'], ['P3', 'GND']]);
		assert.deepEqual(roundTripped.plannedStrings.map(item => [item.x, item.y, item.alignMode]), [[40, 35, 2], [130, 215, 2], [330, 415, 2]]);
		assert.equal(f.state.writes.length, 0);
		assert.equal(f.state.source, docHead('pcb-A'));
		assert.equal(f.state.pads[0].getState_Net(), '地线🌱');
	});
	await test('bottom silk is explicit and relative position uses the SDK rotated pad bounding box', async () => {
		install({ pads: [pad('P1', { rotation: 90 })], bounds: new Map([['P1', { minX: -35, minY: -10, maxX: 35, maxY: 10 }]]) });
		const plan = await makePlan(baseParams({ layer: 'bottom-silk', position: 'top', offset: 12, rotation: 90 }));
		assert.deepEqual([plan.plannedStrings[0].layer, plan.plannedStrings[0].x, plan.plannedStrings[0].y, plan.plannedStrings[0].alignMode], [4, 0, 22, 6]);
		assert.equal(plan.plannedStrings[0].mirror, false);
	});
	await test('all four relative sides use the expected SDK anchor points', async () => {
		const expected = { top: [20, 53, 6], bottom: [20, 17, 4], left: [7, 35, 8], right: [33, 35, 2] };
		for (const [position, values] of Object.entries(expected)) {
			install({ bounds: new Map([['P1', { minX: 10, minY: 20, maxX: 30, maxY: 50 }]]) });
			const plan = await makePlan(baseParams({ position, offset: 3 }));
			assert.deepEqual([plan.plannedStrings[0].x, plan.plannedStrings[0].y, plan.plannedStrings[0].alignMode], values);
		}
	});
	await test('explicit placements use padId anchors and SDK alignment constants', async () => {
		const p1 = pad('P1', { net: 'N1', parent: 'U1' });
		const p2 = pad('P2', { net: 'N2', parent: 'U1' });
		const p3 = pad('P3', { net: 'N3', parent: 'U1' });
		const f = install({ components: [component('U1', [p1, p2, p3])], pads: [], bounds: new Map([['P1', { minX: 0, minY: 0, maxX: 20, maxY: 10 }], ['P2', { minX: 30, minY: 30, maxX: 60, maxY: 60 }], ['P3', { minX: 80, minY: 80, maxX: 90, maxY: 90 }]]) });
		const plan = await makePlan(baseParams({ targetIds: ['U1'], placements: [{ padId: 'P1', x: 11, y: 12, align: 'left' }, { padId: 'P2', x: -3, y: 7, align: 'center' }, { padId: 'P3', x: 8, y: 9, align: 'right' }], position: undefined, offset: undefined }));
		assert.deepEqual(plan.plannedStrings.map(item => [item.padId, item.x, item.y, item.alignMode]), [['P1', 11, 12, 2], ['P2', -3, 7, 5], ['P3', 8, 9, 8]]);
		assert.equal(f.state.writes.length, 0);
	});
	await test('empty nets are explicit exclusions and all-empty plan is non-executable', async () => {
		const f = install({ pads: [pad('P1', { net: '' })], bounds: new Map() });
		const plan = await makePlan(baseParams());
		assert.equal(plan.executable, false);
		assert.deepEqual(plan.plannedStrings, []);
		assert.equal(plan.excludedTargets[0].id, 'P1');
		assert.match(plan.excludedTargets[0].reason, /没有网络名/);
		await assert.rejects(() => execute(plan), /不可执行/);
		assert.equal(f.state.writes.length, 0);
	});
	await test('undefined SDK net is excluded while named nets in the same plan remain executable', async () => {
		const f = install({ pads: [pad('P1', { net: undefined }), pad('P2', { net: 'POWER' })], bounds: new Map([['P2', { minX: 5, minY: 10, maxX: 15, maxY: 20 }]]) });
		const plan = await makePlan(baseParams({ targetIds: ['P1', 'P2'] }));
		assert.equal(plan.executable, true);
		assert.deepEqual(plan.plannedStrings.map(item => item.padId), ['P2']);
		assert.deepEqual(plan.excludedTargets.map(item => [item.id, item.net]), [['P1', '']]);
		assert.equal(f.state.writes.length, 0);
	});
	await test('all required inputs and complete source geometry fail explicitly', async () => {
		for (const bad of [{ targetIds: [] }, { layer: 'bottom' }, { position: undefined, offset: undefined }, { fontSize: 0 }, { mirror: 'auto' }])
			await assert.rejects(() => makePlan(baseParams(bad)));
		const f = install({ bounds: new Map() });
		await assert.rejects(() => makePlan(baseParams()), /bounding box|返回空值/);
		assert.equal(f.state.writes.length, 0);
	});
	await test('plan execution creates editable strings and verifies all SDK properties by ID', async () => {
		const f = install();
		const plan = await makePlan(baseParams({ fontSize: 44, lineWidth: 6, rotation: 27, mirror: true }));
		const result = await execute(plan);
		assert.equal(result.created.length, 1);
		assert.equal(result.created[0].text, 'N1');
		assert.deepEqual(result.verifiedIds, ['STR-1']);
		assert.equal(result.saved, false);
		assert.equal(f.state.createArgs[0].length, 13);
		assert.equal(f.state.createArgs[0][0], 3);
		assert.equal(f.state.createArgs[0][11], true);
		assert.equal(f.state.source, docHead('pcb-A'));
	});
	await test('stale baseline and tampered plans are rejected before writes', async () => {
		let f = install();
		let plan = await makePlan(baseParams());
		plan.plannedStrings[0].text = 'CHANGED';
		await assert.rejects(() => execute(plan));
		assert.equal(f.state.writes.length, 0);
		f = install();
		plan = await makePlan(baseParams());
		f.state.rules = { config: { spacingMil: 9 }, name: 'test' };
		await assert.rejects(() => execute(plan), /基线已变化/);
		assert.equal(f.state.writes.length, 0);
	});
	await test('missing or non-array plannedStrings fail safely before any write', async () => {
		const f = install();
		const plan = await makePlan(baseParams());
		const without = { ...plan };
		delete without.plannedStrings;
		await assert.rejects(() => execute(without), /plannedStrings 必须是完整数组/);
		await assert.rejects(() => execute({ ...plan, plannedStrings: { 0: plan.plannedStrings[0] } }), /plannedStrings 必须是完整数组/);
		await assert.rejects(() => execute({ ...plan, plannedStrings: [null] }), /plan\.plannedStrings 与当前 PCB 重新规划结果不一致/);
		assert.equal(f.state.writes.length, 0);
	});
	await test('SDK false stops at first create and reports partial state without retry', async () => {
		const f = install({ pads: [pad('P1'), pad('P2')], bounds: new Map([['P1', { minX: 0, minY: 0, maxX: 10, maxY: 10 }], ['P2', { minX: 20, minY: 20, maxX: 30, maxY: 30 }]]), createMode: 'false' });
		const plan = await makePlan(baseParams({ targetIds: ['P1', 'P2'] }));
		const error = await execute(plan).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(f.state.writes.length, 1);
		assert.equal(error.cause?.partial, true);
		assert.deepEqual(error.cause?.createdIds, []);
		assert.deepEqual(error.cause?.verifiedIds, []);
	});
	await test('post-create focus change preserves created ID and stops remaining writes', async () => {
		const f = install({ pads: [pad('P1'), pad('P2')], bounds: new Map([['P1', { minX: 0, minY: 0, maxX: 10, maxY: 10 }], ['P2', { minX: 20, minY: 20, maxX: 30, maxY: 30 }]]), focusAfterCreate: true });
		const plan = await makePlan(baseParams({ targetIds: ['P1', 'P2'] }));
		const error = await execute(plan).catch(reason => reason);
		assert.ok(error instanceof Error);
		assert.equal(f.state.writes.length, 1);
		assert.deepEqual(error.cause?.createdIds, ['STR-1']);
		assert.deepEqual(error.cause?.verifiedIds, []);
		assert.ok(f.state.strings.has('STR-1'));
	});
	await test('an old ID returned by create is not reported as newly created', async () => {
		const old = stringObject('OLD', { layer: 3, x: 0, y: 0, text: 'OLD', fontFamily: 'Arial', fontSize: 50, lineWidth: 8, alignMode: 5, rotation: 0, reverse: false, expansion: 0, mirror: false, primitiveLock: false });
		const f = install({ existingStrings: [old], createMode: 'existing' });
		const plan = await makePlan(baseParams());
		const error = await execute(plan).catch(reason => reason);
		assert.match(error.message, /執行前已存在|执行前已存在/);
		assert.deepEqual(error.cause?.createdIds, []);
		assert.equal(f.state.writes.length, 1);
	});
	await test('readback mismatch in requested or fixed SDK properties stops remaining strings', async () => {
		for (const property of ['fontSize', 'reverse', 'expansion', 'primitiveLock']) {
			const f = install({ pads: [pad('P1'), pad('P2')], bounds: new Map([['P1', { minX: 0, minY: 0, maxX: 10, maxY: 10 }], ['P2', { minX: 20, minY: 20, maxX: 30, maxY: 30 }]]), mutateReadback: property });
			const plan = await makePlan(baseParams({ targetIds: ['P1', 'P2'] }));
			const error = await execute(plan).catch(reason => reason);
			assert.ok(error instanceof Error);
			assert.equal(f.state.writes.length, 1);
			assert.deepEqual(error.cause?.createdIds, ['STR-1']);
			assert.deepEqual(error.cause?.verifiedIds, []);
		}
	});
	await test('unknown targets fail; duplicate source IDs and source objects are untouched', async () => {
		const original = pad('P1', { net: 'UNCHANGED' });
		const f = install({ pads: [original] });
		await assert.rejects(() => makePlan(baseParams({ targetIds: ['missing'] })), /不是当前 PCB/);
		const plan = await makePlan(baseParams({ targetIds: ['P1', 'P1'] }));
		assert.equal(plan.targets.length, 1);
		assert.equal(f.state.writes.length, 0);
		assert.equal(original.getState_Net(), 'UNCHANGED');
		assert.equal(f.state.source, docHead('pcb-A'));
	});
	await test('complete plans require their bound document UUID before any write', async () => {
		for (const documentUuid of [undefined, '', '   ']) {
			const f = install({ pads: [pad('P1')] });
			const plan = await makePlan(baseParams());
			plan.documentUuid = documentUuid;
			await assert.rejects(() => execute(plan), /documentUuid/);
			assert.equal(f.state.writes.length, 0);
		}
	});
	console.log(`${passed} network silkscreen regression cases passed`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
