import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: `export { schematicCommands } from '../src/commands/schematic.ts'; export { pcbCommands } from '../src/commands/pcb.ts'; export { isEda42OrNewer, requireEda42 } from '../src/engine/edaVersion.ts'`,
		resolveDir: resolve(root, 'test'),
		sourcefile: 'eda-41-compat-entry.ts',
	},
	bundle: true, platform: 'node', format: 'esm', write: false, target: 'node24',
})
const { schematicCommands, pcbCommands, isEda42OrNewer, requireEda42 } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const command = (all, name) => all.find(item => item.name === name).handler
assert.match(schematicCommands.find(item => item.name === 'schematic.listNets').summary, /EDA 4\.1/)
for (const name of ['pcb.getCurrentLayer', 'pcb.getStackingConfig', 'pcb.getRealTimeDrcStatus'])
	assert.match(pcbCommands.find(item => item.name === name).summary, /EDA 4\.2/)
let newApiCalls = 0
let editorVersion = '4.1.78'
const compare = (a, b) => {
	const av = a.split('.').map(Number), bv = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (av[i] ?? 0) - (bv[i] ?? 0)
	return 0
}
globalThis.eda = {
	sys_Environment: {
		getEditorCurrentVersion: () => editorVersion,
		isEditorCurrentVersionGreaterThanOrEqual: requested => compare(requested, editorVersion) >= 0,
		isEditorCurrentVersionLessThanOrEqual: requested => compare(requested, editorVersion) <= 0,
	},
	sch_Net: {
		getAllNetsName: () => { newApiCalls++; return [] },
		getAllNets: () => { newApiCalls++; return [] },
	},
	sch_Netlist: {
		getNetlist: async () => '*PADS-PCB*\n*SIGNAL* $1N1\nR1.2 R2.1\n*SIGNAL* ACE_IN_A\nR1.1\n*END*',
	},
	sch_PrimitiveWire: {
		getAll: async () => [
			{ getState_PrimitiveId: () => 'auto', getState_Net: () => '' },
			{ getState_PrimitiveId: () => 'aux', getState_Net: () => 'ACE_AUX' },
		],
	},
	pcb_Layer: { getCurrentLayer: () => { newApiCalls++; return null }, getAllPhysicalStackingConfigurations: () => { newApiCalls++; return [] } },
	pcb_Drc: { getRealTimeDrcStatus: () => { newApiCalls++; return false } },
	sch_Document: { getPrimitiveAtPoint: () => { newApiCalls++; return null } },
	sch_PrimitiveText: { modify: () => { newApiCalls++; throw new Error('unexpected text write') } },
}
const names = await command(schematicCommands, 'schematic.listNets')({})
assert.deepEqual(names, ['$1N1', 'ACE_AUX', 'ACE_IN_A'])
const details = await command(schematicCommands, 'schematic.listNets')({ detail: true })
assert.equal(details.find(item => item.net === '$1N1').wires.length, 0)
assert.match(details.find(item => item.net === '$1N1').note, /未计入/)
assert.equal(details.find(item => item.net === 'ACE_AUX').wires.length, 1)
for (const [all, name, params] of [
	[schematicCommands, 'schematic.getPrimitiveAtPoint', { x: 0, y: 0 }],
	[schematicCommands, 'schematic.modifyText', { primitiveId: 'text-1', content: 'updated' }],
	[pcbCommands, 'pcb.getCurrentLayer', {}],
	[pcbCommands, 'pcb.listStackingConfigs', {}],
	[pcbCommands, 'pcb.getRealTimeDrcStatus', {}],
]) await assert.rejects(command(all, name)(params), /需要 EDA 4\.2/)
assert.equal(newApiCalls, 0)
for (const version of ['4.2.0', '4.2.1', '4.3.0']) {
	editorVersion = version
	assert.equal(isEda42OrNewer(), true)
	assert.doesNotThrow(() => requireEda42('test'))
}
editorVersion = 'unknown'
assert.throws(() => isEda42OrNewer(), /无法确认/)
assert.throws(() => requireEda42('test'), /无法确认/)
console.log('PASS EDA 4.1 net fallback and 4.2-only API guards')
