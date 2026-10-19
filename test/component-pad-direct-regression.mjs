import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: "import { pcbCommands } from '../src/commands/pcb.ts'; export { pcbCommands }",
		resolveDir: resolve(root, 'test'),
		sourcefile: 'component-pad-direct-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { pcbCommands } = await import(moduleUrl)
const command = pcbCommands.find(item => item.name === 'pcb.connectComponentPadDirect')
assert.ok(command, 'legacy command name remains registered while the write is disabled')
assert.deepEqual(command.params.map(param => param.name), ['documentUuid', 'componentId', 'padNumber', 'padId', '_timeoutMs'], 'legacy parameter surface remains compatible')
assert.match(command.summary, /暂时停用/)
assert.match(command.returns, /writeAttempted:false/)

let sdkPropertyReads = 0
let sdkMethodCalls = 0
const sdk = new Proxy({}, {
	get(_target, property) {
		sdkPropertyReads++
		return (..._args) => { sdkMethodCalls++; throw new Error(`unexpected SDK call ${String(property)}`) }
	},
})
globalThis.eda = sdk

const cases = [
	['normal valid-looking request', { documentUuid: 'pcb-1', componentId: 'cmp-1', padNumber: '1' }],
	['already-direct same-value request', { documentUuid: 'pcb-1', componentId: 'cmp-1', padNumber: '1', padId: 'pad-1' }],
	['invalid empty params', {}],
	['invalid values', { documentUuid: '', componentId: null, padNumber: 1, padId: '' }],
	['hostile params proxy', new Proxy({}, { get() { throw new Error('params must not be inspected') } })],
]

for (const [label, params] of cases) {
	let caught
	try { await command.handler(params) }
	catch (error) { caught = error }
	assert.ok(caught instanceof Error, `${label}: disabled command throws an Error`)
	assert.match(caught.message, /pcb\.connectComponentPadDirect 暂时停用/)
	assert.deepEqual(caught.cause, { disabled: true, retryable: false, writeAttempted: false })
	assert.equal(caught.cause.partial, undefined, 'zero-write refusal is not described as partial')
	assert.equal(sdkPropertyReads, 0, `${label}: no SDK properties are read`)
	assert.equal(sdkMethodCalls, 0, `${label}: no SDK methods are called`)
}

assert.equal(sdkPropertyReads, 0, 'no focus, source, primitive, save, rebuild, or recovery API is accessed')
assert.equal(sdkMethodCalls, 0, 'no toAsync, setter, done, save, rebuild, or recovery API is called')
console.log('PASS pcb.connectComponentPadDirect is deterministically disabled without inspecting params or touching the SDK')
