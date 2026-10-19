import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: "export { libCommands } from '../src/commands/lib.ts'",
		resolveDir: resolve(root, 'test'),
		sourcefile: 'lib-open-result-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { libCommands } = await import(moduleUrl)

for (const [name, mount, idKey] of [
	['lib.symbolOpenInEditor', 'lib_Symbol', 'symbolUuid'],
	['lib.footprintOpenInEditor', 'lib_Footprint', 'footprintUuid'],
]) {
	const handler = libCommands.find(command => command.name === name).handler
	const params = { [idKey]: 'resource-id', libraryUuid: 'library-id' }
	for (const bad of [false, undefined, null, '', 0]) {
		globalThis.eda = { [mount]: { openInEditor: async () => bad } }
		await assert.rejects(() => handler(params, { vars: {} }), /未返回有效页签 ID/)
	}
	globalThis.eda = { [mount]: { openInEditor: async () => 'resource-id@library-id' } }
	assert.deepEqual(await handler(params, { vars: {} }), { tabId: 'resource-id@library-id' })
	const opaqueError = new Error('[object Object]')
	globalThis.eda = { [mount]: { openInEditor: async () => { throw opaqueError } } }
	await assert.rejects(
		() => handler(params, { vars: {} }),
		error => error.message.includes('不可读错误')
			&& error.message.includes(params[idKey])
			&& error.message.includes(params.libraryUuid)
			&& error.cause === opaqueError,
	)
	const ordinaryError = new Error('SDK transport failed')
	globalThis.eda = { [mount]: { openInEditor: async () => { throw ordinaryError } } }
	await assert.rejects(() => handler(params, { vars: {} }), error => error === ordinaryError)
	console.log(`PASS ${name} rejects invalid SDK tab IDs and accepts a valid tab ID`)
}
