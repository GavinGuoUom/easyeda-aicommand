import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: `
import { pcbCommands } from '../src/commands/pcb.ts'
import { executeCommand, registerCommand } from '../src/engine/registry.ts'
export { pcbCommands, executeCommand, registerCommand }
`,
		resolveDir: resolve(root, 'test'),
		sourcefile: 'pcb-delete-outcome-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { pcbCommands, executeCommand, registerCommand } = await import(moduleUrl)
for (const command of pcbCommands) registerCommand(command)
const command = pcbCommands.find(item => item.name === 'pcb.delete')
const otherCollectionNames = [
	'pcb_PrimitiveComponent', 'pcb_PrimitiveVia', 'pcb_PrimitivePour', 'pcb_PrimitivePolyline',
	'pcb_PrimitiveString', 'pcb_PrimitiveRegion', 'pcb_PrimitiveFill', 'pcb_PrimitiveArc',
]

function mockEda(initialIds, { failLineReadAfterDeleteId } = {}) {
	const ids = new Set(initialIds)
	const deleteCalls = []
	let failureEnabled = false
	let focusReads = 0
	const emptyCollection = { getAllPrimitiveId: async () => [], delete: async () => true }
	const lineCollection = {
		getAllPrimitiveId: async () => {
			if (failureEnabled) throw new Error('injected line list readback failure')
			return [...ids]
		},
		delete: async ([id]) => {
			deleteCalls.push(id)
			if (id === failLineReadAfterDeleteId) {
				failureEnabled = true
				return true
			}
			if (id === 'present') return false
			ids.delete(id)
			return true
		},
	}
	globalThis.eda = Object.fromEntries(otherCollectionNames.map(name => [name, emptyCollection]))
	globalThis.eda.pcb_PrimitiveLine = lineCollection
	globalThis.eda.dmt_SelectControl = { getCurrentDocumentInfo: async () => ({ documentType: ++focusReads === 1 ? 3 : 1 }) }
	return { deleteCalls, command }
}

const originalSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, ms, ...args) => ms <= 1500 ? setImmediate(callback, ...args) : 0
try {
	{
		const { deleteCalls } = mockEda(['present', 'delete-ok'])
		const result = await executeCommand({ cmd: 'pcb.delete', params: { primitiveIds: ['present', 'delete-ok'], batchSize: 1 } })
		assert.equal(result.ok, true, JSON.stringify(result))
		assert.deepEqual(result.data.deleted, ['delete-ok'])
		assert.deepEqual(result.data.failed, ['present'])
		assert.deepEqual(deleteCalls, ['present', 'delete-ok'], 'confirmed still-present failure must not stop the next ID')
	}
	{
		const { deleteCalls } = mockEda(['deleted-first', 'unknown-second', 'unprocessed-third'], { failLineReadAfterDeleteId: 'unknown-second' })
		const result = await executeCommand({ cmd: 'pcb.delete', params: { primitiveIds: ['deleted-first', 'unknown-second', 'unprocessed-third'], batchSize: 1 } })
		assert.equal(result.ok, true, JSON.stringify(result))
		assert.deepEqual(result.data.deleted, ['deleted-first'])
		assert.deepEqual(result.data.failed, ['unknown-second'])
		assert.deepEqual(result.data.unprocessed, ['unprocessed-third'])
		assert.deepEqual(deleteCalls, ['deleted-first', 'unknown-second'], 'unknown post-delete readback must stop later writes')
	}
	console.log('pcb-delete-outcome-regression: 2 checks passed')
}
finally {
	globalThis.setTimeout = originalSetTimeout
}
