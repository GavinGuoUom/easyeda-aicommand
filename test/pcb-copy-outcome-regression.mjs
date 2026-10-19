import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: `
import { projectCommands } from '../src/commands/project.ts'
import { executeCommand, registerCommand } from '../src/engine/registry.ts'
export { projectCommands, executeCommand, registerCommand }
`,
		resolveDir: resolve(root, 'test'),
		sourcefile: 'pcb-copy-outcome-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { projectCommands, executeCommand, registerCommand } = await import(moduleUrl)
for (const command of projectCommands) registerCommand(command)
const copyPcb = projectCommands.find(command => command.name === 'project.copyPcb')
assert.ok(copyPcb)

function makeProjectTree() {
	return {
		uuid: 'project-1',
		teamUuid: 'team-1',
		data: [
			{ itemType: 'Board', name: 'Board1', parentProjectUuid: 'project-1', schematic: null, pcb: { itemType: 'PCB', uuid: 'source-pcb', name: 'PCB1', parentProjectUuid: 'project-1', parentBoardName: 'Board1' } },
			{ itemType: 'Board', name: 'Board1_1', parentProjectUuid: 'project-1', schematic: null, pcb: null },
		],
	}
}

function copyIntoTree(tree, uuid, boardName) {
	const pcb = { itemType: 'PCB', uuid, name: uuid, parentProjectUuid: tree.uuid, ...(boardName ? { parentBoardName: boardName } : {}) }
	if (boardName)
		tree.data.find(node => node.itemType === 'Board' && node.name === boardName).pcb = pcb
	else
		tree.data.push(pcb)
}

let markerWrites = 0
registerCommand({
	name: 'test.markerWrite', summary: 'marker', params: [], returns: '{}',
	handler: async () => { markerWrites++; return { written: true } },
})

async function rejectsUnknown(params, configureSdk, label, expectedBoardName) {
	let copies = 0
	let treeReads = 0
	const project = makeProjectTree()
	let copySideEffects = 0
	globalThis.eda = {
		dmt_Pcb: {
			copyPcb: async (...args) => {
				copies++
				assert.deepEqual(args, ['source-pcb', expectedBoardName])
				return configureSdk(() => { copySideEffects++; copyIntoTree(project, 'side-effect-copy', expectedBoardName) })
			},
		},
		dmt_Project: { getCurrentProjectInfo: async () => { treeReads++; return structuredClone(project) } },
	}
	await assert.rejects(copyPcb.handler(params), error => {
		assert.equal(error.cause?.partial, true, label)
		assert.equal(error.cause?.retryable, false, label)
		assert.equal(error.cause?.result?.sourcePcbUuid, 'source-pcb', label)
		assert.equal(error.cause?.result?.requestedBoardName, expectedBoardName ?? null, label)
		assert.equal(error.cause?.result?.pcbUuid, 'unknown', label)
		assert.match(error.message, /结果未知/)
		assert.match(error.message, /project\.getInfo \/ project\.listPcbs/)
		assert.match(error.message, /不要自动重试/)
		if (label === 'SDK throw' || label === 'SDK throw after write')
			assert.match(error.message, /SDK copy rejected|SDK threw after creating copy/, label)
		else
			assert.equal(error.cause?.operationError, 'SDK 返回空值', label)
		return true
	})
	assert.equal(copies, 1, `${label}: SDK copy called once`)
	assert.equal(treeReads, 2, `${label}: complete tree is rechecked immediately before the one SDK write; unknown SDK outcome is not retried or read back`)
	assert.equal(copySideEffects, label === 'SDK throw after write' ? 1 : 0, `${label}: simulated SDK side effect is tracked independently from calls`)
}

{
	let copies = 0
	let treeReads = 0
	let writes = 0
	const project = makeProjectTree()
	globalThis.eda = {
		dmt_Pcb: {
			copyPcb: async (...args) => { copies++; assert.deepEqual(args, ['source-pcb', 'Board1_1']); writes++; copyIntoTree(project, 'copy-pcb', 'Board1_1'); return 'copy-pcb' },
		},
		dmt_Project: { getCurrentProjectInfo: async () => { treeReads++; return structuredClone(project) } },
	}
	assert.deepEqual(await copyPcb.handler({ pcbUuid: 'source-pcb', boardName: 'Board1_1' }), { pcbUuid: 'copy-pcb' })
	assert.equal(copies, 1)
	assert.equal(treeReads, 3, 'complete tree read in preflight, immediately before the single copy, and after it')
	assert.equal(writes, 1, 'only copyPcb is a write')
	assert.equal(project.data.find(node => node.name === 'Board1').pcb.uuid, 'source-pcb', 'source PCB remains unchanged')
	assert.equal(project.data.find(node => node.name === 'Board1_1').pcb.uuid, 'copy-pcb', 'new PCB belongs to the real empty Board')
}

{
	let copies = 0
	let treeReads = 0
	const project = makeProjectTree()
	globalThis.eda = {
		dmt_Pcb: {
			copyPcb: async (...args) => { copies++; assert.deepEqual(args, ['source-pcb', undefined]); copyIntoTree(project, 'loose-copy'); return 'loose-copy' },
		},
		dmt_Project: { getCurrentProjectInfo: async () => { treeReads++; return structuredClone(project) } },
	}
	assert.deepEqual(await copyPcb.handler({ pcbUuid: 'source-pcb' }), { pcbUuid: 'loose-copy' })
	assert.equal(copies, 1)
	assert.equal(treeReads, 3)
	assert.equal(project.data.at(-1).uuid, 'loose-copy', 'omitted target keeps the unlinked copy path')
}

await rejectsUnknown({ pcbUuid: 'source-pcb', boardName: 'Board1_1' }, () => undefined, 'empty SDK return', 'Board1_1')
await rejectsUnknown({ pcbUuid: 'source-pcb' }, () => { throw new Error('SDK copy rejected') }, 'SDK throw', undefined)
await rejectsUnknown({ pcbUuid: 'source-pcb', boardName: 'Board1_1' }, recordWrite => {
	recordWrite()
	throw new Error('SDK threw after creating copy')
}, 'SDK throw after write', 'Board1_1')


async function checkMacroStopsAfterUnknown(configureSdk, label) {
	let copies = 0
	let markerWrites = 0
	let treeReads = 0
	const project = makeProjectTree()
	globalThis.eda = {
		dmt_Pcb: {
			copyPcb: async () => { copies++; return configureSdk() },
		},
		dmt_Project: { getCurrentProjectInfo: async () => { treeReads++; return structuredClone(project) } },
	}
	registerCommand({
		name: 'test.markerWrite', summary: 'marker', params: [], returns: '{}',
		handler: async () => { markerWrites++; return { written: true } },
	})
	const result = await executeCommand({ cmd: 'macro', params: {
		stopOnError: false,
		steps: [{ cmd: 'project.copyPcb', params: { pcbUuid: 'source-pcb' } }, { cmd: 'test.markerWrite' }],
	} })
	assert.equal(result.ok, false, `${label}: macro reports the failed copy`)
	assert.equal(result.data.steps[0].error.cause.partial, true, `${label}: partial error reaches registry result`)
	if (label === 'SDK throw')
		assert.equal(result.data.steps[0].error.cause.operationError, 'SDK copy rejected')
	assert.equal(markerWrites, 0, `${label}: partial copy result blocks dependent macro write`)
	assert.equal(copies, 1, `${label}: copy is invoked once`)
	assert.equal(treeReads, 2, `${label}: preflight and immediate pre-write checks occur before the unknown write outcome`)
}

await checkMacroStopsAfterUnknown(() => undefined, 'empty SDK result')
await checkMacroStopsAfterUnknown(() => { throw new Error('SDK copy rejected') }, 'SDK throw')

{
	let copies = 0
	let treeReads = 0
	const project = makeProjectTree()
	globalThis.eda = {
		dmt_Pcb: {
			copyPcb: async () => { copies++; return undefined },
		},
		dmt_Project: { getCurrentProjectInfo: async () => { treeReads++; return structuredClone(project) } },
	}
	await assert.rejects(copyPcb.handler({ pcbUuid: 'source-pcb' }), /结果未知.*SDK 返回空值/)
	assert.equal(copies, 1)
	assert.equal(treeReads, 2)
}

console.log('pcb-copy-outcome-regression: 7 scenarios passed')
