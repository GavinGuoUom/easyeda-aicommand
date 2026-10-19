import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const built = await build({
	stdin: { contents: `import { pcbCommands } from '../src/commands/pcb.ts'; import { parseAutoRouteSes, mapSesRoutes, serializeSesSubset } from '../src/engine/autoRouteSes.ts'; export { pcbCommands, parseAutoRouteSes, mapSesRoutes, serializeSesSubset }`, resolveDir: resolve(root, 'test'), sourcefile: 'ses-route-command-regression-entry.ts' },
	bundle: true, platform: 'node', format: 'esm', write: false, target: 'node24',
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
const { pcbCommands, parseAutoRouteSes, mapSesRoutes, serializeSesSubset } = await import(moduleUrl)
const command = name => pcbCommands.find(item => item.name === name)
const rawSes = readFileSync(resolve(root, 'test/fixtures/auto-route-real-v223.ses'), 'utf8')
const layers = [{ id: 1, name: 'TopLayer', type: 'SIGNAL' }, { id: 2, name: 'BottomLayer', type: 'SIGNAL' }]
const expected = mapSesRoutes(parseAutoRouteSes(rawSes), layers)
const validLines = expected.lines.filter(line => Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) >= 1)
const lineOnlySes = serializeSesSubset(rawSes, { lines: validLines, vias: [] })
const fullSesBase64 = Buffer.from(serializeSesSubset(rawSes, { lines: validLines, vias: expected.vias }), 'utf8').toString('base64')
const encode = value => Buffer.from(value, 'utf8').toString('base64')
let uuid = 'ses-direct-test'
let focusUuid = uuid
let rows = []
let failFreshGet = false
let nativeCalls = 0
let drcCalls = 0
let skipCreateAt = 0
let nextId = 0
let routeJobCounter = 0
let outputCalls = 0
let sourceReads = 0
let lineEnumerations = 0
let focusReads = 0
const stateItem = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [`getState_${key}`, () => value]))
const lineItem = line => stateItem({ PrimitiveId: line.id, Net: line.net, Layer: line.layer, LineWidth: line.widthMil, StartX: line.a.x, StartY: line.a.y, EndX: line.b.x, EndY: line.b.y, PrimitiveLock: line.locked ?? false })
const sourceRecord = (type, id, data) => `${JSON.stringify({ type, id })}||${JSON.stringify(data)}`
const source = () => [
	`${JSON.stringify({ type: 'DOCHEAD' })}||${JSON.stringify({ docType: 'PCB', uuid })}`,
	...rows.map(line => sourceRecord('LINE', line.id, { net: line.net, layer: line.layer, width: line.widthMil, a: line.a, b: line.b })),
].join('|\n') + '|'
const storage = new Map()
globalThis.eda = {
	dmt_SelectControl: { getCurrentDocumentInfo: async () => { focusReads++; return { documentType: 3, uuid: focusUuid } } },
	sys_FileManager: { getDocumentSource: async () => { sourceReads++; return source() } },
	sys_Storage: { setExtensionUserConfig: async (key, value) => { storage.set(key, value); return true }, getExtensionUserConfig: key => storage.get(key) },
	pcb_Layer: { getAllLayers: async () => layers },
	pcb_PrimitiveLine: {
		getAll: async () => { lineEnumerations++; return rows.map(lineItem) },
		getAllPrimitiveId: async () => { lineEnumerations++; return rows.map(line => line.id) },
		get: async id => failFreshGet ? undefined : (rows.find(line => line.id === id) ? lineItem(rows.find(line => line.id === id)) : undefined),
		create: async (net, layer, x1, y1, x2, y2, widthMil) => {
			const id = `direct-${++nextId}`
			const line = { id, net, layer, widthMil, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } }
			if (nextId !== skipCreateAt) rows.push(line)
			return stateItem({ PrimitiveId: id })
		},
		delete: async ids => { rows = rows.filter(line => !ids.includes(line.id)); return true },
	},
	pcb_PrimitiveVia: { getAll: async () => [], getAllPrimitiveId: async () => [], get: async () => undefined, create: async () => { throw new Error('unexpected via create') }, delete: async () => true },
	pcb_PrimitiveArc: { getAll: async () => [], getAllPrimitiveId: async () => [], delete: async () => true },
	pcb_Document: { importAutoRouteSesFile: async () => { nativeCalls++; return true } },
	pcb_ManufactureData: { getDsnFile: async () => { const file = new Blob(['dsn']); Object.defineProperty(file, 'name', { value: 'direct.dsn' }); return file } },
	pcb_Drc: { check: async () => { drcCalls++; return [] } },
	sys_ClientUrl: { request: async (url, method) => ({ ok: true, status: 200, json: async () => {
		if (url.endsWith('/system/status')) return { ok: true }
		if (url.endsWith('/sessions/create')) return { id: 'ses-session' }
		if (url.endsWith('/jobs/enqueue')) return { id: `ses-job-${++routeJobCounter}` }
		if (/\/jobs\/ses-job-\d+\/output$/.test(url)) { outputCalls++; return { data: encode(lineOnlySes), filename: 'line-only.ses' } }
		if (/\/jobs\/ses-job-\d+$/.test(url)) return { state: 'COMPLETED' }
		return {}
	} }) },
}

const originalStructuredClone = globalThis.structuredClone
globalThis.structuredClone = undefined
try {
const shortLine = { ...expected.lines[0], a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } }
const shortSes = serializeSesSubset(rawSes, { lines: [shortLine], vias: [] })
rows = [{ id: 'existing-short', net: shortLine.net, layer: shortLine.layer, widthMil: shortLine.widthMil, a: shortLine.a, b: shortLine.b, locked: false }]
const preflightCounts = { focus: focusReads, source: sourceReads, lines: lineEnumerations, creates: nextId }
await assert.rejects(() => command('pcb.importAutoRouteSes').handler({ base64: encode(shortSes) }, {}), /SES 输入线段 1.*0\.5 mil 小于最低允许 1 mil/)
assert.deepEqual({ focus: focusReads, source: sourceReads, lines: lineEnumerations, creates: nextId }, preflightCounts, 'short SES input is rejected before focus, snapshot, or SDK access even when it already exists')
rows = []
const mmTemplate = rawSes.replaceAll('(resolution mil 1000)', '(resolution mm 1000)')
const exactMilLine = { ...expected.lines[0], a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
const exactMilSes = serializeSesSubset(mmTemplate, { lines: [exactMilLine], vias: [] })
const exactMilImported = await command('pcb.importAutoRouteSes').handler({ base64: encode(exactMilSes) }, {})
assert.equal(exactMilImported.created.lines, 1, 'a 1 mil SES segment expressed through mm resolution converts and is accepted at the boundary')
assert.ok(Math.abs(Math.hypot(rows[0].b.x - rows[0].a.x, rows[0].b.y - rows[0].a.y) - 1) < 1e-9, 'mm SES coordinates read back as a 1 mil route')
rows = []
const subMilLine = { ...expected.lines[0], a: { x: 0, y: 0 }, b: { x: 0.999, y: 0 } }
const subMilSes = serializeSesSubset(rawSes, { lines: [subMilLine], vias: [] })
const beforeSubMil = { focus: focusReads, source: sourceReads, lines: lineEnumerations, creates: nextId }
await assert.rejects(() => command('pcb.importAutoRouteSes').handler({ base64: encode(subMilSes) }, {}), /SES 输入线段 1.*0\.999 mil 小于最低允许 1 mil/)
assert.deepEqual({ focus: focusReads, source: sourceReads, lines: lineEnumerations, creates: nextId }, beforeSubMil, 'a 0.999 mil SES segment is rejected before all PCB API reads')
const twoMilLine = { ...expected.lines[0], a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }
const twoMilSes = serializeSesSubset(rawSes, { lines: [twoMilLine], vias: [] })
rows = [{ id: 'baseline-long', net: twoMilLine.net, layer: twoMilLine.layer, widthMil: twoMilLine.widthMil, a: { x: 0, y: 0 }, b: { x: 1.5, y: 0 }, locked: false }]
const beforeDeltaCreate = nextId
await assert.rejects(() => command('pcb.importAutoRouteSes').handler({ base64: encode(twoMilSes) }, {}), /SES 差集新增线段 1.*0\.5 mil 小于最低允许 1 mil/)
assert.equal(nextId, beforeDeltaCreate, 'a short residual from append subtraction is rejected before create')
rows = []
const first = await command('pcb.importAutoRouteSes').handler({ base64: encode(lineOnlySes) }, {})
assert.equal(first.backend, 'direct-primitives')
assert.equal(first.imported, true)
assert.equal(first.sesGeometryVerified, true)
assert.equal(first.created.lines, validLines.length)
assert.equal(first.created.vias, 0)
assert.equal(rows.length, validLines.length)
assert.equal(nativeCalls, 0, 'line-only import uses direct SDK primitives')
const writesAfterFirst = rows.length
const duplicate = await command('pcb.importAutoRouteSes').handler({ base64: encode(lineOnlySes) }, {})
assert.equal(duplicate.alreadyPresent, true)
assert.equal(rows.length, writesAfterFirst, 'duplicate append performs no SDK write')
	rows = rows.map(line => ({ ...line, locked: true }))
	const start = await command('pcb.autoRouteStart').handler({ skipDrc: false }, {})
	const stableRows = JSON.stringify(rows)
	const writesBeforeStatus = nextId
	const outputsBeforeStatus = outputCalls
	const sourcesBeforeStatus = sourceReads
	const lineReadsBeforeStatus = lineEnumerations
	const focusReadsBeforeStatus = focusReads
	const nativeBeforeStatus = nativeCalls
	const drcBeforeStatus = drcCalls
	const completed = await command('pcb.autoRouteStatus').handler({}, {})
	assert.equal(completed.jobId, start.jobId)
	assert.equal(completed.state, 'COMPLETED')
	assert.equal(completed.imported, false)
	assert.equal(completed.autoImportEnabled, false)
	assert.match(completed.note, /不会获取布线输出或修改 PCB/)
	assert.equal((await command('pcb.autoRouteStatus').handler({ jobId: start.jobId, noImport: false }, {})).imported, false, 'explicit noImport:false cannot enable automatic import')
	await assert.rejects(() => command('pcb.autoRouteStatus').handler({ jobId: start.jobId, noImport: 'false' }, {}), /noImport 必须是布尔值/)
	assert.equal(focusReads, focusReadsBeforeStatus, 'completed status checks do not read or validate the active PCB focus')
	const nextStart = await command('pcb.autoRouteStart').handler({ skipDrc: false }, {})
	focusUuid = 'pcb-other-page'
	const explicitOldJob = await command('pcb.autoRouteStatus').handler({ jobId: start.jobId, noImport: false }, {})
	assert.equal(explicitOldJob.jobId, start.jobId, 'the completed job remains queryable by its explicit ID')
	assert.equal(explicitOldJob.autoImportEnabled, false, 'a different focused page does not turn status polling into a write path')
	const defaultNextJob = await command('pcb.autoRouteStatus').handler({}, {})
	assert.equal(defaultNextJob.jobId, nextStart.jobId, 'completing an old explicit job does not release a newer default job')
	assert.equal(defaultNextJob.imported, false)
	assert.equal(outputCalls, outputsBeforeStatus, 'status never fetches the SES output')
	assert.equal(sourceReads, sourcesBeforeStatus, 'status never snapshots or reads PCB source')
	assert.equal(lineEnumerations, lineReadsBeforeStatus, 'status never reads route geometry')
	assert.equal(focusReads, focusReadsBeforeStatus + 2, 'status polling itself never reads focus; only the intervening start performs its two focus checks')
	assert.equal(nextId, writesBeforeStatus, 'status never creates or deletes PCB primitives')
	assert.equal(nativeCalls, nativeBeforeStatus, 'status never calls the SDK SES importer')
	assert.equal(drcCalls, drcBeforeStatus, 'status never invokes DRC')
	assert.equal(JSON.stringify(rows), stableRows, 'status polling preserves PCB route geometry')
	focusUuid = uuid
	await command('pcb.autoRouteStatus').handler({ jobId: nextStart.jobId }, {})
	const afterCompletedStart = await command('pcb.autoRouteStart').handler({ skipDrc: false }, {})
	assert.ok(afterCompletedStart.jobId, 'a completed matching job releases the default start slot')
uuid = 'ses-direct-readback-failure'
focusUuid = uuid
rows = []
failFreshGet = true
let failure
try { await command('pcb.importAutoRouteSes').handler({ base64: encode(lineOnlySes) }, {}) }
catch (error) { failure = error }
assert.ok(failure, 'unreadable direct primitive must fail')
assert.match(failure.message, /身份、网络或层读回不匹配/)
assert.equal(nativeCalls, 0, 'direct readback failure never falls back to native SES import')
assert.equal(failure.cause?.partial, true)
assert.equal(failure.cause?.restored, false)
const failedPartialIds = [...rows.map(line => line.id)]
const writesBeforeRecoveryLock = nextId
await command('pcb.autoRouteStatus').handler({ jobId: start.jobId }, {})
await assert.rejects(() => command('pcb.importAutoRouteSes').handler({ base64: encode(lineOnlySes) }, {}), /恢复未确认|recovery/i)
assert.equal(nextId, writesBeforeRecoveryLock, 'partial recovery lock blocks a same-document retry before another create')
assert.deepEqual(rows.map(line => line.id), failedPartialIds, 'the blocked retry preserves the partial geometry for diagnosis')

uuid = 'ses-diagnostic-compensation'
focusUuid = uuid
rows = []
failFreshGet = false
skipCreateAt = nextId + 2
let compensationError
try { await command('pcb.importAutoRouteSes').handler({ base64: encode(lineOnlySes) }, {}) }
catch (error) { compensationError = error }
skipCreateAt = 0
assert.ok(compensationError, 'a later unconfirmed create failure is surfaced')
assert.equal(compensationError.cause?.restored, true, 'the earlier confirmed primitive is compensated')
assert.equal(rows.length, 0, 'successful compensation removes the earlier created primitive')
const compensationJournal = compensationError.cause?.sesDiagnostic?.record?.journal
assert.ok(compensationJournal?.writes?.some(item => item.kind === 'compensate-delete-lines' && item.result === true), 'the final inline diagnostic includes the successful compensation write')
const compensationDiagnostic = compensationError.cause?.sesDiagnostic
assert.equal(compensationDiagnostic?.persisted, true, 'the final after-recovery diagnostic is persisted and read back')
const persistedCompensation = JSON.parse(storage.get(compensationDiagnostic.storageKey))
assert.ok(persistedCompensation.journal.writes.some(item => item.kind === 'compensate-delete-lines' && item.result === true), 'the persisted after-recovery journal includes the successful compensation write')
const inlineCompensationEntry = compensationJournal.writes.find(item => item.kind === 'compensate-delete-lines')
inlineCompensationEntry.kind = 'mutated-inline-copy'
assert.ok(persistedCompensation.journal.writes.some(item => item.kind === 'compensate-delete-lines'), 'mutating the inline journal copy does not mutate the persisted diagnostic')

uuid = 'ses-native-unknown-hole'
focusUuid = uuid
rows = []
failFreshGet = false
let nativeError
try { await command('pcb.importAutoRouteSes').handler({ base64: fullSesBase64 }, {}) }
catch (error) { nativeError = error }
assert.ok(nativeError, 'native importer false is surfaced')
assert.equal(nativeCalls, 1, 'SES containing a via with unspecified hole dimensions selects native exactly once')
assert.equal(nativeError.cause?.sesDiagnostic?.record?.backend, 'native-ses')
assert.equal(nativeError.cause?.sesDiagnostic?.record?.sdk?.attempted, true)
console.log('PASS SES command direct backend verifies exact geometry, duplicate append is zero-write, and failures never fall back')
}
finally {
	globalThis.structuredClone = originalStructuredClone
}

