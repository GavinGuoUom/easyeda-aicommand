import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: "export { schematicCommands } from '../src/commands/schematic.ts'",
		resolveDir: resolve(root, 'test'),
		sourcefile: 'schematic-a-boolean-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const { schematicCommands } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const command = name => schematicCommands.find(item => item.name === name).handler

const listNets = command('schematic.listNets')
const repairNet = command('schematic.repairNet')
const pruneFloatingLabels = command('schematic.pruneFloatingLabels')
let apiCalls = 0
globalThis.eda = new Proxy({}, {
	get: () => {
		apiCalls++
		return new Proxy(() => {}, { get: () => { apiCalls++; return () => { apiCalls++ } } })
	},
})

for (const detail of ['true', null, 0])
	await assert.rejects(() => listNets({ detail }), /detail 必须是布尔值/)
for (const allowSourceRewrite of ['true', null, 0])
	await assert.rejects(() => pruneFloatingLabels({ allowSourceRewrite }), /allowSourceRewrite 必须是布尔值/)
for (const dryRun of ['true', null, 0])
	await assert.rejects(() => repairNet({ net: 'VOUT', dryRun }), /dryRun 必须是布尔值/)
assert.equal(apiCalls, 0, 'invalid booleans must be rejected before any EDA API access')

const netNames = ['GND', 'VOUT']
const netDetails = [{ name: 'GND' }, { name: 'VOUT' }]
const listCalls = []
globalThis.eda = {
	sys_Environment: {
		getEditorCurrentVersion: () => '4.2.0',
		isEditorCurrentVersionLessThanOrEqual: () => true,
	},
	sch_Net: {
		getAllNetsName: async () => { listCalls.push('names'); return netNames },
		getAllNets: async () => { listCalls.push('details'); return netDetails },
	},
	sys_FileManager: { getDocumentSource: async () => 'schematic-source-with-no-floating-labels' },
	sch_ManufactureData: { getNetlistFile: async () => null },
	sch_Netlist: { getNetlist: async () => '*SIGNAL* VOUT\nU1.1\n' },
	sch_PrimitiveWire: { getAll: async () => [] },
	sch_PrimitiveAttribute: { getAll: async () => [] },
}
assert.equal(await listNets({}), netNames, 'omitted detail preserves the default name-only path')
assert.equal(await listNets({ detail: false }), netNames)
assert.equal(await listNets({ detail: true }), netDetails)
assert.deepEqual(listCalls, ['names', 'names', 'details'], 'default, false, and true preserve listNets read paths')

const repairDry = await repairNet({ net: 'VOUT', dryRun: true })
assert.equal(repairDry.dryRun, true)
assert.equal(repairDry.before.count, 1)
const repairLive = await repairNet({ net: 'VOUT' })
assert.equal(repairLive.dryRun, false)
assert.equal(repairLive.after.count, 1)

const pruneDry = await pruneFloatingLabels({ dryRun: true, allowSourceRewrite: false })
assert.equal(pruneDry.dryRun, true)
assert.deepEqual(pruneDry.floating, [])
const pruneDefault = await pruneFloatingLabels({})
assert.equal(pruneDefault.dryRun, false)
assert.deepEqual(pruneDefault.floating, [])
const pruneNoop = await pruneFloatingLabels({ dryRun: false, allowSourceRewrite: true })
assert.equal(pruneNoop.dryRun, false)
assert.deepEqual(pruneNoop.floating, [])
console.log('PASS schematic A boolean inputs reject invalid types before API access and preserve valid paths')
