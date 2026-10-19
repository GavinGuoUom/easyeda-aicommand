import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: {
		contents: "export { createSesRouteApplyContext } from '../src/engine/sesRouteApply.ts'; export { withDocumentRecovery } from '../src/engine/documentRecovery.ts'; export { readRouteSnapshot } from '../src/engine/autoRouteSesHost.ts'; export { planSesImport } from '../src/engine/autoRouteSes.ts'",
		resolveDir: resolve(root, 'test'),
		sourcefile: 'ses-route-apply-regression-entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	target: 'node24',
})
const { createSesRouteApplyContext, withDocumentRecovery, readRouteSnapshot, planSesImport } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

const boardUuid = 'pcb-ses-test'
const snapshot = { documentUuid: boardUuid, documentType: 3, command: 'test.ses', source: '', storageKey: 'unused' }
const getters = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [`getState_${key}`, () => value]))
const sourceText = state => {
	const records = [
		{ type: 'DOCHEAD', ticket: 1, data: { docType: 'PCB', uuid: boardUuid, updateTime: 1 } },
		{ type: 'POURED', id: 'pour-real', ticket: 2 },
		...state.lines.map((line, index) => ({ type: 'LINE', id: line.id, ticket: index + 3 })),
		...state.vias.map((via, index) => ({ type: 'VIA', id: via.id, ticket: index + 20 })),
		...state.arcs.map((arc, index) => ({ type: 'ARC', id: arc.id, ticket: index + 40 })),
	]
	return records.map(record => `${JSON.stringify(record)}||${JSON.stringify(record.data ?? { keep: true })}`).join('|\n')
}
const routeObj = (type, item) => {
	if (type === 'LINE') return { ...getters({ PrimitiveId: item.id, Net: item.net, Layer: item.layer, LineWidth: item.widthMil, StartX: item.a.x, StartY: item.a.y, EndX: item.b.x, EndY: item.b.y, PrimitiveLock: Boolean(item.locked) }) }
	if (type === 'VIA') return { ...getters({ PrimitiveId: item.id, Net: item.net, X: item.x, Y: item.y, Diameter: item.diameterMil, HoleDiameter: item.holeDiameterMil, ViaType: item.viaType ?? 0, PrimitiveLock: Boolean(item.locked) }) }
	return { ...getters({ PrimitiveId: item.id, Net: item.net, Layer: item.layer, LineWidth: item.widthMil, StartX: item.start.x, StartY: item.start.y, EndX: item.end.x, EndY: item.end.y, ArcAngle: item.angle, PrimitiveLock: Boolean(item.locked) }) }
}

function makeBoard({ shortLineMissing = false, nativeVia = false, oldLine = false, deleteFails = false, compensationDeleteFails = false, createThrows = false, createHangs = false, unknownExtra = false, oldDriftAfterCreate = false } = {}) {
	const state = {
		lines: oldLine ? [{ id: 'line-old', net: 'OLD', layer: 1, widthMil: 8, a: { x: 10, y: 0 }, b: { x: 20, y: 0 }, locked: false }] : [],
		vias: [],
		arcs: [],
		lineCounter: 0,
		createLineCalls: 0,
		deleteLineCalls: [],
		deleteViaCalls: [],
		deleteArcCalls: [],
		sourceWrites: 0,
		nativeImportCalls: 0,
		events: [],
		focusWrongNext: false,
	}
	const api = {
		dmt_SelectControl: { getCurrentDocumentInfo: async () => {
			if (state.focusWrongNext) { state.focusWrongNext = false; return { documentType: 3, uuid: 'pcb-other' } }
			return { documentType: 3, uuid: boardUuid }
		} },
		sys_FileManager: { getDocumentSource: async () => sourceText(state), setDocumentSource: async () => { state.sourceWrites++; return true } },
		pcb_Layer: { getAllLayers: async () => [{ id: 1, name: 'TopLayer', type: 'SIGNAL' }] },
		pcb_PrimitiveLine: {
			getAll: async () => state.lines.map(item => routeObj('LINE', item)),
			getAllPrimitiveId: async () => state.lines.map(item => item.id),
			get: async id => state.lines.some(item => item.id === id) ? routeObj('LINE', state.lines.find(item => item.id === id)) : undefined,
			create: async (net, layer, x1, y1, x2, y2, width) => {
				state.createLineCalls++
				state.events.push('create-line')
				if (createHangs) return await new Promise(() => {})
				if (createThrows) throw new Error('mock create rejected')
				const id = `line-new-${state.createLineCalls}`
				if (!(shortLineMissing && Math.abs(x2 - x1) < 0.041)) state.lines.push({ id, net, layer, widthMil: width, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, locked: false })
				if (unknownExtra) state.lines.push({ id: 'line-unknown', net: 'OTHER', layer, widthMil: width, a: { x: 0, y: 50 }, b: { x: 30, y: 50 }, locked: false })
				if (oldDriftAfterCreate) state.lines.find(item => item.id === 'line-old').b.x += 1
				return { getState_PrimitiveId: () => id }
			},
			delete: async ids => { state.events.push('delete-line'); state.deleteLineCalls.push([...ids]); if (deleteFails || (compensationDeleteFails && ids.every(id => id.startsWith('line-new-')))) return false; state.lines = state.lines.filter(item => !ids.includes(item.id)); return true },
		},
		pcb_PrimitiveVia: {
			getAll: async () => state.vias.map(item => routeObj('VIA', item)),
			getAllPrimitiveId: async () => state.vias.map(item => item.id),
			get: async id => state.vias.some(item => item.id === id) ? routeObj('VIA', state.vias.find(item => item.id === id)) : undefined,
			create: async (net, x, y, holeDiameterMil, diameterMil) => { const item = { id: 'via-new-1', net, x, y, holeDiameterMil, diameterMil, viaType: 0, locked: false }; state.vias.push(item); return { getState_PrimitiveId: () => item.id } },
			delete: async ids => { state.deleteViaCalls.push([...ids]); state.vias = state.vias.filter(item => !ids.includes(item.id)); return true },
		},
		pcb_PrimitiveArc: { getAll: async () => state.arcs.map(item => routeObj('ARC', item)), delete: async ids => { state.deleteArcCalls.push([...ids]); return true } },
		pcb_Document: { importAutoRouteSesFile: async () => {
			state.nativeImportCalls++
			if (nativeVia) state.vias.push({ id: 'via-native-1', net: 'NATIVE', x: 50, y: 60, diameterMil: 24, holeDiameterMil: undefined, viaType: 0, locked: false })
			return true
		} },
	}
	return { api, state }
}

async function prepare(board, expectedLines, expectedVias = [], mode = 'append') {
	const before = await readRouteSnapshot(board.api, async () => {})
	const sesBefore = { documentUuid: boardUuid, lines: before.lines, vias: before.vias, source: before.source }
	const expected = { lines: expectedLines, vias: expectedVias, coordinateMapping: 'easyeda-pro-4.1.78-direct-xy', toleranceMil: 0.001, toleranceScope: 'current mil/1000 fixture', holeDiameterStatus: 'not-specified-by-ses' }
	const plan = planSesImport(expected, sesBefore, mode)
	const snap = { ...snapshot, source: before.source }
	return { before, plan, snapshot: snap }
}
const line = (x1, x2, net = 'N1', widthMil = 10.05) => ({ net, layer: 1, widthMil, a: { x: x1, y: 0 }, b: { x: x2, y: 0 } })
const makeContext = (board, prepared, options = {}) => createSesRouteApplyContext({ api: board.api, snapshot: prepared.snapshot, before: prepared.before, plan: prepared.plan, deletedArcIds: [], file: new File(['(session)'], 'route.ses'), timeoutMs: 2000, ...options })
const guardedWrite = context => async action => { await context.focusGuard(); const result = await action(); await context.focusGuard(); return result }

const originalStructuredClone = globalThis.structuredClone
globalThis.structuredClone = undefined
try {
// Append imports a long line, then the known 0.04 mil negative fixture returns an ID but has no geometry.
const partialBoard = makeBoard({ shortLineMissing: true })
const partialPrepared = await prepare(partialBoard, [line(0, 100), line(100, 100.04)])
const partialContext = makeContext(partialBoard, partialPrepared)
assert.equal(partialContext.backend, 'direct-primitives')
let partialError
try {
	await withDocumentRecovery(partialPrepared.snapshot, w => partialContext.apply(w), { recoveryHook: partialContext.recover, focusGuard: partialContext.focusGuard })
}
catch (error) { partialError = error }
assert.ok(partialError, 'second line readback failure is reported')
assert.equal(partialError.cause.restored, true)
assert.equal(partialError.cause.contentRestored, true)
assert.equal(partialError.cause.retryable, true)
assert.equal(partialError.cause.compensation, 'exact-new-route-primitives-deleted')
assert.equal(partialError.cause.noRecoveryWriteNeeded, false)
assert.deepEqual(partialError.cause.compensatedIds, ['line-new-1'])
assert.equal(partialError.cause.sourceRestoreCalls, 0)
assert.equal(partialBoard.state.createLineCalls, 2)
assert.deepEqual(partialBoard.state.deleteLineCalls, [['line-new-1']], 'only the first confirmed candidate line is compensated')
assert.equal(partialBoard.state.sourceWrites, 0, 'custom recovery never restores whole source')
assert.deepEqual(partialBoard.state.lines, [])
assert.equal(await partialBoard.api.sys_FileManager.getDocumentSource(), partialPrepared.snapshot.source, 'full baseline source including POURED remains unchanged after exact primitive compensation')
assert.ok(partialContext.journal.writes[0].confirmed, 'journal proves first line was freshly verified')
assert.equal(partialContext.journal.writes[1].settlement, 'returned', 'journal distinguishes normal short-line return from thrown/unsettled calls')
const recoveryJournalSnapshot = JSON.stringify(partialError.cause.journal)
partialContext.journal.writes[0].expectedGeometry.a.x = 999
assert.equal(JSON.stringify(partialError.cause.journal), recoveryJournalSnapshot, 'recovery diagnostics are detached from later journal mutation')

// A lost focus is latched even if the next focus query would see the original board again.
const focusLostBoard = makeBoard()
const focusLostPrepared = await prepare(focusLostBoard, [line(0, 100), line(110, 120)])
let createStages = 0
const focusLostContext = makeContext(focusLostBoard, focusLostPrepared, { onStage: stage => {
	if (stage === 'create-line' && ++createStages === 2) focusLostBoard.state.focusWrongNext = true
} })
await assert.rejects(() => withDocumentRecovery(focusLostPrepared.snapshot, w => focusLostContext.apply(w), { recoveryHook: focusLostContext.recover, focusGuard: focusLostContext.focusGuard }), error => {
	assert.equal(error.cause.partial, true)
	assert.equal(error.cause.restored, false)
	assert.equal(error.cause.focusLost, true)
	assert.equal(error.cause.compensation, 'skipped-focus-lost')
	return true
})
assert.equal(focusLostBoard.state.deleteLineCalls.length, 0, 'latched focus loss blocks compensation after mock focus returns')
assert.equal(focusLostBoard.state.sourceWrites, 0)

const focusReadErrorBoard = makeBoard()
const focusReadErrorPrepared = await prepare(focusReadErrorBoard, [line(0, 100), line(110, 120)])
let focusErrorStages = 0
const focusReadErrorContext = makeContext(focusReadErrorBoard, focusReadErrorPrepared, { onStage: stage => {
	if (stage === 'create-line' && ++focusErrorStages === 2)
		focusReadErrorBoard.api.dmt_SelectControl.getCurrentDocumentInfo = async () => { throw new Error('focus API unavailable') }
} })
await assert.rejects(() => withDocumentRecovery(focusReadErrorPrepared.snapshot, w => focusReadErrorContext.apply(w), { recoveryHook: focusReadErrorContext.recover, focusGuard: focusReadErrorContext.focusGuard }), error => error.cause.partial === true && error.cause.restored === false && error.cause.focusLost === true)
assert.equal(focusReadErrorBoard.state.deleteLineCalls.length, 0, 'focus API errors also latch compensation lockout')
assert.equal(focusReadErrorBoard.state.sourceWrites, 0)

// A returned create with no source or geometry change is confirmed as no-op without recovery writes.
const noChangeBoard = makeBoard({ shortLineMissing: true })
const noChangePrepared = await prepare(noChangeBoard, [line(0, 0.04)])
const noChangeContext = makeContext(noChangeBoard, noChangePrepared)
await assert.rejects(() => withDocumentRecovery(noChangePrepared.snapshot, w => noChangeContext.apply(w), { recoveryHook: noChangeContext.recover, focusGuard: noChangeContext.focusGuard }), error => {
	assert.equal(error.cause.restored, true)
	assert.equal(error.cause.noRecoveryWriteNeeded, true)
	assert.equal(error.cause.compensation, 'no-change-confirmed')
	return true
})
assert.equal(noChangeBoard.state.deleteLineCalls.length, 0)
assert.equal(noChangeBoard.state.sourceWrites, 0)

// Existing route drift blocks compensation even when the new candidate itself was verified.
const driftBoard = makeBoard({ oldLine: true, oldDriftAfterCreate: true })
const driftPrepared = await prepare(driftBoard, [line(30, 80)])
const driftContext = makeContext(driftBoard, driftPrepared)
await assert.rejects(() => withDocumentRecovery(driftPrepared.snapshot, w => driftContext.apply(w), { recoveryHook: driftContext.recover, focusGuard: driftContext.focusGuard }), error => error.cause.partial === true && error.cause.restored === false)
assert.equal(driftBoard.state.deleteLineCalls.length, 0, 'old route drift prevents compensation')
assert.equal(driftBoard.state.sourceWrites, 0)

// Unexpected route IDs block compensation even when there is a confirmed candidate.
const unknownBoard = makeBoard({ unknownExtra: true })
const unknownPrepared = await prepare(unknownBoard, [line(0, 100)])
const unknownContext = makeContext(unknownBoard, unknownPrepared)
await assert.rejects(() => withDocumentRecovery(unknownPrepared.snapshot, w => unknownContext.apply(w), { recoveryHook: unknownContext.recover, focusGuard: unknownContext.focusGuard }), error => {
	assert.equal(error.cause.partial, true)
	assert.equal(error.cause.restored, false)
	return true
})
assert.deepEqual(unknownBoard.state.deleteLineCalls, [], 'unknown newly-added geometry is not deleted')
assert.equal(unknownBoard.state.sourceWrites, 0)

// A thrown create is settled-threw, so it cannot be treated as safe compensation evidence.
const thrownBoard = makeBoard({ oldLine: true, createThrows: true })
const thrownPrepared = await prepare(thrownBoard, [line(0, 100)], [], 'replace-unlocked')
const thrownContext = makeContext(thrownBoard, thrownPrepared)
await assert.rejects(() => withDocumentRecovery(thrownPrepared.snapshot, w => thrownContext.apply(w), { recoveryHook: thrownContext.recover, focusGuard: thrownContext.focusGuard }), /专用恢复未能确认/)
assert.equal(thrownBoard.state.deleteLineCalls.length, 0, 'A15 never deletes old routes when adding fails')
assert.equal(thrownBoard.state.sourceWrites, 0)

// The replace flow deletes only after additions are verified; a failed delete never triggers source restore.
const deleteBoard = makeBoard({ oldLine: true, deleteFails: true })
const deletePrepared = await prepare(deleteBoard, [line(30, 80)], [], 'replace-unlocked')
const deleteContext = makeContext(deleteBoard, deletePrepared)
await assert.rejects(() => withDocumentRecovery(deletePrepared.snapshot, w => deleteContext.apply(w), { recoveryHook: deleteContext.recover, focusGuard: deleteContext.focusGuard }), /专用恢复未能确认/)
assert.equal(deleteBoard.state.sourceWrites, 0, 'delete failure cannot fall back to setDocumentSource')
assert.deepEqual(deleteBoard.state.deleteLineCalls, [['line-old']])

const replaceBoard = makeBoard({ oldLine: true })
const replacePrepared = await prepare(replaceBoard, [line(30, 80)], [], 'replace-unlocked')
const replaceContext = makeContext(replaceBoard, replacePrepared)
const replaceResult = await replaceContext.apply(guardedWrite(replaceContext))
assert.equal(replaceResult.result.verified, true)
assert.deepEqual(replaceBoard.state.events, ['create-line', 'delete-line'], 'A15 adds and verifies replacement geometry before deleting old routes')
assert.deepEqual(replaceBoard.state.lines.map(item => item.id), ['line-new-1'])

// A hung create is unsettled and cannot trigger cleanup based on a stale snapshot.
const hungBoard = makeBoard({ createHangs: true })
const hungPrepared = await prepare(hungBoard, [line(0, 100)])
const hungContext = makeContext(hungBoard, hungPrepared, { timeoutMs: 300 })
await assert.rejects(() => withDocumentRecovery(hungPrepared.snapshot, w => hungContext.apply(w), { recoveryHook: hungContext.recover, focusGuard: hungContext.focusGuard }), error => error.cause.partial === true && error.cause.restored === false)
assert.equal(hungBoard.state.deleteLineCalls.length, 0, 'unsettled create cannot be compensated')
assert.equal(hungBoard.state.sourceWrites, 0)

// Compensation returning false ends recovery without a source restore or further write.
const compFailBoard = makeBoard({ shortLineMissing: true, compensationDeleteFails: true })
const compFailPrepared = await prepare(compFailBoard, [line(0, 100), line(100, 100.04)])
const compFailContext = makeContext(compFailBoard, compFailPrepared)
await assert.rejects(() => withDocumentRecovery(compFailPrepared.snapshot, w => compFailContext.apply(w), { recoveryHook: compFailContext.recover, focusGuard: compFailContext.focusGuard }), error => error.cause.partial === true && error.cause.restored === false)
assert.deepEqual(compFailBoard.state.deleteLineCalls, [['line-new-1']])
assert.equal(compFailBoard.state.sourceWrites, 0)

// Unknown-hole vias select native SES; already-present routes produce no writes.
const nativeBoard = makeBoard({ nativeVia: true })
const nativeVia = { net: 'NATIVE', x: 50, y: 60, diameterMil: 24, viaType: undefined }
const nativePrepared = await prepare(nativeBoard, [], [nativeVia])
const nativeContext = makeContext(nativeBoard, nativePrepared)
assert.equal(nativeContext.backend, 'native-ses')
const nativeResult = await nativeContext.apply(guardedWrite(nativeContext))
assert.equal(nativeBoard.state.nativeImportCalls, 1)
assert.equal(nativeResult.result.verified, true)
assert.equal(nativeBoard.state.sourceWrites, 0)

const alreadyBoard = makeBoard()
alreadyBoard.state.vias.push({ id: 'via-existing', net: 'NATIVE', x: 50, y: 60, diameterMil: 24, holeDiameterMil: undefined, viaType: 0, locked: false })
const alreadyPrepared = await prepare(alreadyBoard, [], [nativeVia])
assert.equal(alreadyPrepared.plan.alreadyPresent, true)
const alreadyContext = makeContext(alreadyBoard, alreadyPrepared)
await alreadyContext.apply(guardedWrite(alreadyContext))
assert.equal(alreadyBoard.state.nativeImportCalls, 0)
assert.equal(alreadyBoard.state.createLineCalls, 0)
assert.equal(alreadyBoard.state.vias.length, 1, 'already-present native geometry causes zero writes')

// A focus hang before the first guarded write does not invoke the action.
const preFocusBoard = makeBoard()
const preFocusPrepared = await prepare(preFocusBoard, [line(0, 100)])
const preFocusContext = makeContext(preFocusBoard, preFocusPrepared, { timeoutMs: 60 })
preFocusBoard.api.dmt_SelectControl.getCurrentDocumentInfo = () => new Promise(() => {})
await assert.rejects(() => withDocumentRecovery(preFocusPrepared.snapshot, w => preFocusContext.apply(w), { recoveryHook: preFocusContext.recover, focusGuard: preFocusContext.focusGuard }))
assert.equal(preFocusBoard.state.createLineCalls, 0, 'first focus timeout blocks write action')

// A final focus hang prevents operation success from reaching its caller.
const finalFocusBoard = makeBoard()
const finalFocusPrepared = await prepare(finalFocusBoard, [line(0, 100)])
const finalFocusContext = makeContext(finalFocusBoard, finalFocusPrepared, { timeoutMs: 200 })
await assert.rejects(() => withDocumentRecovery(finalFocusPrepared.snapshot, async w => {
	await finalFocusContext.apply(w)
	finalFocusBoard.api.dmt_SelectControl.getCurrentDocumentInfo = () => new Promise(() => {})
	return { consumed: true }
}, { recoveryHook: finalFocusContext.recover, focusGuard: finalFocusContext.focusGuard }), error => error.cause?.partial === true)
assert.equal(finalFocusBoard.state.createLineCalls, 1)
assert.equal(finalFocusBoard.state.deleteLineCalls.length, 0, 'focus uncertainty during final guard blocks further recovery writes')
assert.equal(finalFocusBoard.state.sourceWrites, 0)

// Recovery wrapper owns its status fields even if a hook supplies conflicting diagnostics.
await assert.rejects(() => withDocumentRecovery(snapshot, writeAction => writeAction(async () => { throw new Error('force specialized hook') }), {
	focusGuard: async () => {},
	recoveryHook: async () => ({ restored: true, cause: { partial: true, restored: false, contentRestored: false, retryable: false, recovery: 'spoofed' } }),
}), error => {
	assert.equal(error.cause.partial, false)
	assert.equal(error.cause.restored, true)
	assert.equal(error.cause.contentRestored, true)
	assert.equal(error.cause.retryable, true)
	assert.notEqual(error.cause.recovery, 'spoofed')
	return true
})

console.log('PASS SES route apply, ordered replacement, bounded recovery, and exact candidate compensation')
}
finally {
	globalThis.structuredClone = originalStructuredClone
}
