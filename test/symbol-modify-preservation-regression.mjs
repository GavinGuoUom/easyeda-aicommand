import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: "export { libCommands } from '../src/commands/lib.ts'; export { executeCommand, registerCommand } from '../src/engine/registry.ts'",
		resolveDir: resolve(root, 'test'),
		sourcefile: 'symbol-modify-preservation-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const { libCommands, executeCommand, registerCommand } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
for (const command of libCommands)
	registerCommand(command)
const modifySymbol = libCommands.find(command => command.name === 'lib.symbolModify').handler

const libraryUuid = 'lib-a'
const initialSymbol = () => ({
	uuid: 'symbol-a',
	libraryUuid,
	name: 'ACE_MiXeD_Case',
	libraryType: '2',
	cbbUuid: 'cbb-a',
	classification: ['cat-a'],
	type: 2,
	description: 'before description',
	subPartNames: ['ACE_MiXeD_Case.1'],
	otherProperty: { 'Add into BOM': 'yes', ACE_KEEP: 'keep', ACE_CLEAR: 'remove-me' },
})

function installSdk(options = {}) {
	let state = structuredClone(options.symbol ?? initialSymbol())
	const calls = { get: [], modify: [], search: [] }
	globalThis.eda = {
		lib_LibrariesList: { getPersonalLibraryUuid: async () => libraryUuid },
		lib_Symbol: {
			get: async (uuid, library) => {
				calls.get.push([uuid, library])
				if (options.preGetFailure && calls.get.length === 1)
					throw new Error('pre-get failed')
				if (library !== state.libraryUuid || uuid !== state.uuid)
					return undefined
				return structuredClone(state)
			},
			modify: async (...args) => {
				calls.modify.push(args)
				const [, library, name, classification, description, otherProperty] = args
				assert.equal(library, libraryUuid)
				if (name !== undefined)
					state.name = name
				if (classification !== undefined)
					state.classification = structuredClone(classification)
				if (description !== undefined) {
					if (description === null)
						delete state.description
					else
						state.description = description
				}
			if (otherProperty !== undefined) {
				state.otherProperty ??= {}
				for (const [key, value] of Object.entries(otherProperty)) {
					if (value === null)
						delete state.otherProperty[key]
					else if (value !== undefined)
						state.otherProperty[key] = value
				}
			}
			if (options.mutateAfterModify)
				options.mutateAfterModify(state)
			return true
			},
			search: async (name, library, _classification, _type, pageSize, page) => {
				calls.search.push([name, library, pageSize, page])
				const rows = (options.searchRows ?? [{ uuid: state.uuid, libraryUuid: state.libraryUuid, name: state.name }])
				return rows.slice((page - 1) * pageSize, page * pageSize)
			},
		},
	}
	return { calls, read: () => structuredClone(state) }
}

const descriptionOnly = installSdk()
const descriptionResult = await modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, description: 'after description' })
assert.equal(descriptionOnly.calls.modify.length, 1, 'one SDK write is issued')
assert.equal(descriptionOnly.calls.modify[0][2], 'ACE_MiXeD_Case', 'omitted name is explicitly preserved with exact casing')
assert.deepEqual(descriptionResult, { modified: true, uuid: 'symbol-a', uuidChanged: false, verify: 'get' })
assert.equal(descriptionOnly.read().name, 'ACE_MiXeD_Case')
assert.deepEqual(descriptionOnly.read().subPartNames, ['ACE_MiXeD_Case.1'])

const explicitRename = installSdk()
const renameResult = await modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, name: 'ACE_Explicit_Rename' })
assert.equal(explicitRename.calls.modify[0][2], 'ACE_Explicit_Rename')
assert.equal(renameResult.verify, 'get')
assert.equal(explicitRename.read().name, 'ACE_Explicit_Rename')
assert.deepEqual(explicitRename.read().subPartNames, ['ACE_MiXeD_Case.1'], 'explicit rename preserves host subPartNames exactly')

const propertyPatch = installSdk()
const patchResult = await modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, description: null, otherProperty: { ACE_NEW: 'new', ACE_CLEAR: null } })
assert.equal(patchResult.verify, 'get')
assert.deepEqual(propertyPatch.read().otherProperty, { 'Add into BOM': 'yes', ACE_KEEP: 'keep', ACE_NEW: 'new' }, 'otherProperty applies per-key updates and null clears without replacing unrelated keys')
assert.equal(Object.hasOwn(propertyPatch.read(), 'description'), false, 'description null clears the requested field')

const staleClassification = installSdk({ mutateAfterModify: symbol => { symbol.classification = ['unexpected'] } })
const staleResult = await executeCommand({ cmd: 'lib.symbolModify', params: { symbolUuid: 'symbol-a', libraryUuid, description: 'after description' } })
assert.equal(staleResult.ok, false, 'post-write readback drift is an outer command failure')
assert.equal(staleClassification.calls.modify.length, 1, 'verification failure does not retry the write')
assert.equal(staleResult.error.cause.partial, true)
assert.equal(staleResult.error.cause.retryable, false)
assert.equal(staleResult.error.cause.sdkModified, true)
assert.equal(staleResult.error.cause.differences.some(difference => difference.field === 'classification'), true, 'unrequested classification drift is reported')
assert.equal(staleResult.error.cause.before.name, 'ACE_MiXeD_Case')
assert.equal(staleResult.error.cause.after.classification[0], 'unexpected')
assert.equal(staleResult.error.cause.candidateUuid, null)
assert.equal(staleResult.error.cause.uuid, 'symbol-a')
assert.equal(staleResult.error.cause.verify, 'get')

for (const field of ['libraryType', 'cbbUuid']) {
	const drift = installSdk({ mutateAfterModify: symbol => { symbol[field] = 'unexpected' } })
	const result = await executeCommand({ cmd: 'lib.symbolModify', params: { symbolUuid: 'symbol-a', libraryUuid, description: 'after description' } })
	assert.equal(result.ok, false, `${field} readback drift fails the command`)
	assert.equal(result.error.cause.differences.some(difference => difference.field === field), true, `${field} is included in preservation verification`)
	assert.equal(drift.calls.modify.length, 1)
}

const ignoredRequestedValue = installSdk({ mutateAfterModify: symbol => { symbol.description = 'SDK ignored requested value' } })
const ignoredResult = await executeCommand({ cmd: 'lib.symbolModify', params: { symbolUuid: 'symbol-a', libraryUuid, description: 'after description' } })
assert.equal(ignoredResult.ok, false)
assert.equal(ignoredResult.error.cause.differences.some(difference => difference.field === 'description'), true, 'requested property drift is reported')

const macroPartial = installSdk({ mutateAfterModify: symbol => { symbol.classification = ['unexpected'] } })
const macroResult = await executeCommand({ cmd: 'macro', params: { stopOnError: false, steps: [
	{ cmd: 'lib.symbolModify', params: { symbolUuid: 'symbol-a', libraryUuid, description: 'after description' } },
	{ cmd: 'lib.symbolModify', params: { symbolUuid: 'symbol-a', libraryUuid, description: 'must not run' } },
] } })
assert.equal(macroResult.ok, false, 'macro propagates readback drift as failure')
assert.equal(macroResult.data.stoppedReason, 'partial', 'partial mutation stops the macro even with stopOnError=false')
assert.equal(macroResult.error.cause.partial, true)
assert.equal(macroResult.error.cause.sdkModified, true)
assert.equal(macroPartial.calls.modify.length, 1, 'macro does not execute a later write after partial readback')

const uuidChanged = installSdk({ mutateAfterModify: symbol => { symbol.uuid = 'symbol-b' } })
const uuidChangedResult = await modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, description: 'after description' })
assert.deepEqual(uuidChangedResult, { modified: true, uuid: 'symbol-b', uuidChanged: true, verify: 'search' }, 'UUID change succeeds only after exact same-library candidate get and property verification')
assert.deepEqual(uuidChanged.calls.search[0].slice(0, 2), ['ACE_MiXeD_Case', libraryUuid])
assert.deepEqual(uuidChanged.calls.get.at(-1), ['symbol-b', libraryUuid])

const ambiguousUuid = installSdk({
	mutateAfterModify: symbol => { symbol.uuid = 'symbol-b' },
	searchRows: [
		{ uuid: 'symbol-b', libraryUuid, name: 'ACE_MiXeD_Case' },
		{ uuid: 'symbol-c', libraryUuid, name: 'ACE_MiXeD_Case' },
	],
})
await assert.rejects(
	() => modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, description: 'after description' }),
	error => {
		assert.equal(error.cause.partial, true, 'multiple exact-name candidates cannot be claimed as verified')
		assert.equal(error.cause.retryable, false)
		assert.equal(error.cause.candidateUuid, null)
		return true
	},
)
assert.equal(ambiguousUuid.calls.modify.length, 1)

const failedPreflight = installSdk({ preGetFailure: true })
await assert.rejects(() => modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, description: 'after description' }), /修改符号前无法读取并确认身份/)
assert.equal(failedPreflight.calls.modify.length, 0, 'failed pre-write identity read blocks all SDK writes')

const wrongLibrary = installSdk({ symbol: { ...initialSymbol(), libraryUuid: 'lib-other' } })
await assert.rejects(() => modifySymbol({ symbolUuid: 'symbol-a', libraryUuid, description: 'after description' }), /未调用修改/)
assert.equal(wrongLibrary.calls.modify.length, 0, 'pre-write library mismatch blocks the SDK write')

console.log('PASS symbolModify preserves symbol identity and unrequested properties with verified single-write recovery')
