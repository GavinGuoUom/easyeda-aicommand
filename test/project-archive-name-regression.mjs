import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: `import { projectCommands } from '../src/commands/project.ts'; export { projectCommands };`,
		resolveDir: resolve(root, 'test'),
		sourcefile: 'project-archive-name-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { projectCommands } = await import(moduleUrl)
const importFile = projectCommands.find(command => command.name === 'project.importFile')
assert.ok(importFile)

async function archive(entries) {
	const zip = new JSZip()
	for (const [path, value] of Object.entries(entries))
		zip.file(path, typeof value === 'string' ? value : JSON.stringify(value))
	return Buffer.from(await zip.generateAsync({ type: 'uint8array' })).toString('base64')
}

const state = {
	teamUuid: 'team-1',
	existingNames: [],
	listResult: undefined,
	infoFailure: false,
	importResult: { uuid: 'created-1', friendlyName: 'Archive title' },
	expectedFileType: 'JLCEDA Pro',
	expectedFileName: 'misleading-name.epro2',
	calls: { list: 0, info: 0, import: 0, team: 0 },
	lastSaveTo: undefined,
}
globalThis.eda = {
	dmt_Team: { getCurrentTeamInfo: async () => { state.calls.team++; return { uuid: state.teamUuid } } },
	dmt_Project: {
		getCurrentProjectInfo: async () => ({ uuid: 'before-project' }),
		getAllProjectsUuid: async teamUuid => { state.calls.list++; assert.equal(teamUuid, 'team-1'); return state.listResult ?? state.existingNames.map((_, index) => `project-${index}`) },
		getProjectInfo: async uuid => {
			state.calls.info++
			if (state.infoFailure) throw new Error('project details unavailable')
			return { uuid, teamUuid: 'team-1', friendlyName: state.existingNames[Number(uuid.split('-')[1])] }
		},
	},
	sys_FileManager: {
		importProjectByProjectFile: async (file, fileType, _unused, saveTo) => {
			state.calls.import++
			state.lastSaveTo = saveTo
			assert.equal(file.name, state.expectedFileName)
			assert.equal(fileType, state.expectedFileType)
			return state.importResult
		},
	},
}

const valid = await archive({ 'project2.json': { title: 'Archive title', description: 'description' } })
const nestedOnly = await archive({ 'folder/project2.json': { title: 'Nested title' } })
const multiple = await archive({ 'project2.json': { title: 'Archive title' }, 'other/project2.json': { title: 'Other title' } })
const invalidJson = await archive({ 'project2.json': '{invalid json' })
const nonObjectMetadata = await archive({ 'project2.json': [] })
const emptyTitle = await archive({ 'project2.json': { title: '   ' } })
const missingMetadata = await archive({ 'README.txt': 'no project metadata' })

assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64: valid })).uuid, 'created-1')
assert.equal(state.lastSaveTo.newProjectFriendlyName, 'Archive title', 'the metadata title wins over the misleading filename')
assert.equal(state.lastSaveTo.newProjectDescription, 'description', 'metadata description is part of the same New Project request')
assert.equal(state.calls.import, 1)

for (const base64 of [nestedOnly, multiple, invalidJson, nonObjectMetadata, emptyTitle, missingMetadata, 'YQ==']) {
	const before = state.calls.import
	const error = await importFile.handler({ fileName: 'misleading-name.epro2', base64 }).catch(reason => reason)
	assert.match(error.message, /请显式传 newProjectName/)
	assert.equal(state.calls.import, before, 'invalid or ambiguous metadata is rejected before SDK import')
}

state.existingNames = ['Archive title']
await assert.rejects(() => importFile.handler({ fileName: 'misleading-name.epro2', base64: valid }), /已有同名工程/)
assert.equal(state.calls.import, 1, 'derived-name collision is rejected before import')
state.existingNames = []

state.existingNames = ['Existing title']
state.infoFailure = true
await assert.rejects(() => importFile.handler({ fileName: 'misleading-name.epro2', base64: valid }), /project details unavailable/)
assert.equal(state.calls.import, 1, 'failed conflict read cannot bypass collision checks')
state.infoFailure = false
state.existingNames = []

state.listResult = { invalid: true }
await assert.rejects(() => importFile.handler({ fileName: 'misleading-name.epro2', base64: valid }), /无法读取当前团队工程列表/)
assert.equal(state.calls.import, 1)
state.listResult = undefined

state.teamUuid = 123
await assert.rejects(() => importFile.handler({ fileName: 'misleading-name.epro2', base64: valid }), /拿不到当前团队 uuid/)
assert.equal(state.calls.import, 1)
state.teamUuid = 'team-1'

state.existingNames = ['Archive title']
assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64: valid, newProjectName: 'Manual name' })).uuid, 'created-1')
assert.equal(state.lastSaveTo.newProjectFriendlyName, 'Manual name', 'explicit name overrides metadata and retains the existing SDK mapping')
assert.equal(state.calls.import, 2)
state.existingNames = []

// Explicit names override the title while preserving an exact optional description.
const explicitDescription = ' \n中文\t原样保留  '
const explicitMetadata = await archive({ 'project2.json': { title: 'Archive title', description: explicitDescription } })
assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64: explicitMetadata, newProjectName: 'Manual name' })).uuid, 'created-1')
assert.equal(state.lastSaveTo.newProjectFriendlyName, 'Manual name')
assert.equal(state.lastSaveTo.newProjectDescription, explicitDescription)

const missingTitle = await archive({ 'project2.json': { description: 'description without title' } })
assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64: missingTitle, newProjectName: 'Manual name without title' })).uuid, 'created-1')
assert.equal(state.lastSaveTo.newProjectFriendlyName, 'Manual name without title')
assert.equal(state.lastSaveTo.newProjectDescription, 'description without title')

const emptyDescription = await archive({ 'project2.json': { title: 'Archive title', description: '' } })
assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64: emptyDescription, newProjectName: 'Manual empty description' })).uuid, 'created-1')
assert.equal(Object.hasOwn(state.lastSaveTo, 'newProjectDescription'), true)
assert.equal(state.lastSaveTo.newProjectDescription, '')

const nonStringDescription = await archive({ 'project2.json': { title: 'Archive title', description: { text: 'do not stringify' } } })
assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64: nonStringDescription, newProjectName: 'Manual nonstring description' })).uuid, 'created-1')
assert.equal(Object.hasOwn(state.lastSaveTo, 'newProjectDescription'), false, 'non-string description is omitted without coercion')

// Malformed or ambiguous metadata remains optional for explicit names.
for (const base64 of [nestedOnly, multiple, invalidJson, nonObjectMetadata, emptyTitle, missingMetadata, 'YQ==']) {
	const before = state.calls.import
	assert.equal((await importFile.handler({ fileName: 'misleading-name.epro2', base64, newProjectName: 'Manual malformed archive' })).uuid, 'created-1')
	assert.equal(state.calls.import, before + 1, 'each explicit-name import makes one SDK call')
	assert.equal(Object.hasOwn(state.lastSaveTo, 'newProjectDescription'), false, 'unreliable metadata is not attached')
}

state.expectedFileType = 'KiCad'
state.expectedFileName = 'board.zip'
assert.equal((await importFile.handler({ fileName: 'board.zip', fileType: 'KiCad', base64: 'YQ==', newProjectName: 'KiCad project' })).uuid, 'created-1')
assert.equal(Object.hasOwn(state.lastSaveTo, 'newProjectDescription'), false, 'other formats do not parse project2.json')
state.expectedFileType = 'JLCEDA Pro'
state.expectedFileName = 'misleading-name.epro2'

const importCallsBeforeTimeout = state.calls.import
const realDateNow = Date.now
let fakeNow = realDateNow()
let dateCalls = 0
Date.now = () => ++dateCalls < 4 ? fakeNow : fakeNow + 1001
try {
	const timeout = await importFile.handler({ fileName: 'misleading-name.epro2', base64: valid, newProjectName: 'Timed metadata', _timeoutMs: 1000 }).catch(error => error)
	assert.match(timeout.message, /超过 1000ms 操作期限/)
}
finally {
	Date.now = realDateNow
}
assert.equal(state.calls.import, importCallsBeforeTimeout, 'metadata parse timeout is not swallowed and prevents SDK import')

state.calls.team = 0
state.calls.list = 0
const offline = await importFile.handler({ fileName: 'misleading-name.epro2', base64: 'YQ==', saveToFolderPath: 'C:/offline/imports' })
assert.equal(offline.uuid, 'created-1')
assert.deepEqual(state.lastSaveTo, { operation: 'Offline Client Local Path', folderPath: 'C:/offline/imports' })
assert.equal(state.calls.team, 0, 'offline save path keeps the existing local-save behavior')
assert.equal(state.calls.list, 0)
assert.equal(Object.hasOwn(state.lastSaveTo, 'newProjectDescription'), false)

console.log('project-archive-name-regression: metadata derivation, ambiguity, collision preflight, explicit override, offline path passed')
