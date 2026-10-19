import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: `
import { resolveRefs } from '../src/engine/registry.ts'
import { pcbCommands } from '../src/commands/pcb.ts'
export { resolveRefs, pcbCommands }
`,
		resolveDir: resolve(root, 'test'),
		sourcefile: 'pcb-net-and-pnp-unit-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { resolveRefs, pcbCommands } = await import(moduleUrl)

const getComponentPads = pcbCommands.find(command => command.name === 'pcb.getComponentPads').handler
let padWriteCalls = 0
let configToJSONCalls = 0
let invalidObjectToJSONCalls = 0
const hostileFieldReadCounts = { connectionMethod: 0, divergenceSpacing: 0, divergenceLineWidth: 0, divergenceAngle: 0 }
const pad = (id, heatWelding = 'missing') => {
	const item = {
		getState_PadNumber: () => id,
		getState_Net: () => `NET_${id}`,
		getState_X: () => 10,
		getState_Y: () => 20,
		getState_Layer: () => 1,
		getState_Rotation: () => 90,
		getState_Pad: () => ['RECT', 80, 40],
		setState_HeatWelding: () => { padWriteCalls++ },
		toAsync: () => { padWriteCalls++; return { done: async () => { padWriteCalls++ } } },
	}
	if (heatWelding === 'missing') return item
	if (heatWelding === 'notCallable') {
		item.getState_HeatWelding = 'not a function'
		return item
	}
	if (heatWelding === 'throwGetter') {
		Object.defineProperty(item, 'getState_HeatWelding', { get() { throw new Error('heat method lookup failed') } })
		return item
	}
	item.getState_HeatWelding = typeof heatWelding === 'function' ? heatWelding : () => heatWelding
	return item
}
const optionalConfig = {
	connectionMethod: 'Divergent',
	divergenceSpacing: 0,
	divergenceAngle: 45,
	unrelated: { shouldNotLeak: true },
	toJSON() { configToJSONCalls++; throw new Error('config toJSON must not run') },
}
const heatPads = [
	pad('null', null),
	pad('config', optionalConfig),
	pad('missing'),
	pad('not-function', 'notCallable'),
	pad('throws', () => { throw new Error('heat getter failed') }),
	pad('getter-throws', 'throwGetter'),
	pad('undefined', () => undefined),
	pad('wrong-type', () => 'bad'),
	pad('unknown-enum', () => ({ connectionMethod: 'Unknown-mode' })),
	pad('bad-number', () => ({ connectionMethod: 'Direct-connected', divergenceSpacing: Infinity })),
	pad('bad-null', () => ({ connectionMethod: null, divergenceSpacing: null })),
	pad('bad-numeric-method', () => ({ connectionMethod: 17 })),
	pad('bad-boolean-method', () => ({ connectionMethod: false })),
	pad('bad-object-method', () => ({ connectionMethod: { toJSON() { invalidObjectToJSONCalls++; throw new Error('must not run') } } })),
	pad('hostile-field-getter', () => {
		const value = { divergenceLineWidth: 22, divergenceAngle: false }
		Object.defineProperty(value, 'connectionMethod', { get() { hostileFieldReadCounts.connectionMethod++; return 'Unknown-mode' } })
		Object.defineProperty(value, 'divergenceSpacing', { get() { hostileFieldReadCounts.divergenceSpacing++; throw { get message() { throw new Error('message access must be guarded') }, toString() { throw new Error('toString must not run') }, toJSON() { throw new Error('toJSON must not run') } } } })
		Object.defineProperty(value, 'divergenceLineWidth', { get() { hostileFieldReadCounts.divergenceLineWidth++; return 22 } })
		Object.defineProperty(value, 'divergenceAngle', { get() { hostileFieldReadCounts.divergenceAngle++; return false } })
		return value
	}),
]
globalThis.eda = {
	pcb_PrimitiveComponent: { getAllPinsByPrimitiveId: async primitiveId => { assert.equal(primitiveId, 'component-heat'); return heatPads } },
	pcb_PrimitivePad: {
		modify: async () => { padWriteCalls++ },
		create: async () => { padWriteCalls++ },
		rebuildCopperRegions: async () => { padWriteCalls++ },
	},
}
const padResults = await getComponentPads({ primitiveId: 'component-heat' })
assert.deepEqual(padResults[0], {
	padNumber: 'null', net: 'NET_null', x: 10, y: 20, layer: 1, rotation: 90, shape: ['RECT', 80, 40],
	heatWelding: { status: 'null', value: null },
}, 'existing pad fields are preserved while null heat-welding is explicit')
assert.deepEqual(padResults[1].heatWelding, { status: 'config', value: { connectionMethod: 'Divergent', divergenceSpacing: 0, divergenceAngle: 45 } })
assert.deepEqual(padResults[2].heatWelding, { status: 'unavailable' })
assert.deepEqual(padResults[3].heatWelding, { status: 'unavailable' })
assert.deepEqual(padResults[4].heatWelding, { status: 'exception', error: { message: 'heat getter failed' } })
assert.deepEqual(padResults[5].heatWelding, { status: 'exception', error: { message: 'heat method lookup failed' } })
const invalidUndefined = padResults[6].heatWelding
assert.deepEqual(invalidUndefined, {
	status: 'invalid', returnedType: 'undefined', reason: '读取接口返回 undefined',
	rawFields: {
		connectionMethod: { status: 'undefined', type: 'undefined' },
		divergenceSpacing: { status: 'undefined', type: 'undefined' },
		divergenceLineWidth: { status: 'undefined', type: 'undefined' },
		divergenceAngle: { status: 'undefined', type: 'undefined' },
	},
})
assert.equal(padResults[7].heatWelding.status, 'invalid')
assert.equal(padResults[7].heatWelding.returnedType, 'string')
assert.equal(padResults[7].heatWelding.reason, '读取接口应返回 null 或配置对象')
assert.equal(padResults[7].heatWelding.rawFields.connectionMethod.status, 'undefined')
assert.equal(padResults[8].heatWelding.rawFields.connectionMethod.value, 'Unknown-mode')
assert.equal(padResults[9].heatWelding.rawFields.divergenceSpacing.type, 'number')
assert.equal(padResults[9].heatWelding.rawFields.divergenceSpacing.finite, false)
assert.deepEqual(padResults[10].heatWelding.rawFields.divergenceSpacing, { status: 'value', type: 'object', value: null })
assert.deepEqual(padResults[10].heatWelding.rawFields.connectionMethod, { status: 'value', type: 'object', value: null })
assert.deepEqual(padResults[11].heatWelding.rawFields.connectionMethod, { status: 'value', type: 'number', value: 17 })
assert.deepEqual(padResults[12].heatWelding.rawFields.connectionMethod, { status: 'value', type: 'boolean', value: false })
assert.deepEqual(padResults[13].heatWelding.rawFields.connectionMethod, { status: 'value', type: 'object' })
assert.equal(padResults[14].heatWelding.rawFields.connectionMethod.value, 'Unknown-mode')
assert.deepEqual(padResults[14].heatWelding.rawFields.divergenceSpacing, {
	status: 'exception', type: 'exception', error: { message: '读取异常' },
}, 'one hostile property getter is isolated while other raw fields remain available')
assert.deepEqual(padResults[14].heatWelding.rawFields.divergenceLineWidth, { status: 'value', type: 'number', value: 22 })
assert.deepEqual(padResults[14].heatWelding.rawFields.divergenceAngle, { status: 'value', type: 'boolean', value: false })
assert.deepEqual(hostileFieldReadCounts, { connectionMethod: 1, divergenceSpacing: 1, divergenceLineWidth: 1, divergenceAngle: 1 }, 'each declared raw field getter is read at most once')
assert.equal(configToJSONCalls, 0, 'the SDK config is projected without serialization')
assert.equal(invalidObjectToJSONCalls, 0, 'invalid raw object toJSON is not invoked')
assert.equal(padWriteCalls, 0, 'pad inspection does not call setters, modify, create, async done, or rebuild')
console.log('PASS getComponentPads reports safe heatWelding states without writes')

assert.deepEqual(resolveRefs({ net: '$1N1', names: ['$1N4', '$$literal'] }, { vars: {} }), {
	net: '$1N1', names: ['$1N4', '$literal'],
})
assert.deepEqual(resolveRefs({ id: '$step.id' }, { vars: { step: { id: 'abc' } } }), { id: 'abc' })
assert.throws(() => resolveRefs('$missing.id', { vars: {} }), /变量 \$missing 不存在/)
console.log('PASS automatic PCB net names remain literal, escaped dollars and macro references work')

const exportPickPlace = pcbCommands.find(command => command.name === 'pcb.exportPickPlace').handler
const passedUnits = []
const passedDsnNames = []
globalThis.eda = {
	pcb_ManufactureData: {
		getPickAndPlaceFile: async (_name, _type, unit) => {
			passedUnits.push(unit)
			return new File(['Designator\tMid X\nR1\t400mil\n'], 'pnp.csv', { type: 'text/csv' })
		},
		getDsnFile: async name => {
			passedDsnNames.push(name)
			return new File(['(PCB "PCB1")'], name, { type: 'application/octet-stream' })
		},
	},
}
for (const unit of ['mm', 'mil', undefined])
	await exportPickPlace({ unit, fileType: 'csv' }, { vars: {} })
assert.deepEqual(passedUnits, ['mm', 'mil', 'mm'])
console.log('PASS pick-and-place passes the SDK unit enum values')

const exportDsn = pcbCommands.find(command => command.name === 'pcb.exportDsn').handler
await exportDsn({}, { vars: {} })
await exportDsn({ fileName: 'route-test' }, { vars: {} })
assert.deepEqual(passedDsnNames, ['board', 'route-test'])
console.log('PASS DSN export passes a real default file name to the SDK')
