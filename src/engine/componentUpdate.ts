import JSZip from 'jszip';
import { appendRecords, getMaxTicket, parseSourceLine, parseSourceLog, resolveRecords } from '../pcb/sourcelog';
import { modifyComponentSafely } from './componentMutation';

interface Ref { uuid: string; libraryUuid: string }
interface UpdateItem { primitiveId: string; footprint?: Ref; properties?: Record<string, unknown> }
interface ExpectedFootprint { uuid: string; name?: string }
type UpdateApi = any;

const propertyFields = ['addIntoBom', 'addIntoPcb', 'designator', 'name', 'manufacturer', 'manufacturerId', 'supplier', 'supplierId'] as const;
const aliases: Record<string, { field: typeof propertyFields[number]; boolean?: boolean }> = {
	'Add into BOM': { field: 'addIntoBom', boolean: true },
	'Convert to PCB': { field: 'addIntoPcb', boolean: true },
	'Designator': { field: 'designator' },
	'Name': { field: 'name' },
	'Manufacturer': { field: 'manufacturer' },
	'Manufacturer Part': { field: 'manufacturerId' },
	'Supplier': { field: 'supplier' },
	'Supplier Part': { field: 'supplierId' },
};

function json(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map(json).join(',')}]`;
	if (value && typeof value === 'object') {
		const row = value as Record<string, unknown>;
		return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${json(row[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
	const text = typeof value === 'string' ? value : json(value);
	let hash = 0x811C9DC5;
	for (let index = 0; index < text.length; index++)
		hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
	return hash.toString(16).padStart(8, '0');
}

function same(a: unknown, b: unknown): boolean {
	return json(a) === json(b);
}

function cloneSourceData<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim())
		throw new Error(`${label} 必须是非空字符串`);
	return value;
}
function focusKey(info: any): string {
	return `${info?.documentType}\0${info?.uuid}\0${info?.parentProjectUuid}`;
}
function validFocus(info: any): boolean {
	return info?.documentType === 1 && typeof info.uuid === 'string' && !!info.uuid.trim() && typeof info.parentProjectUuid === 'string' && !!info.parentProjectUuid.trim();
}
async function checkFocus(api: UpdateApi, focus: any, phase: string): Promise<void> {
	const current = await api.dmt_SelectControl.getCurrentDocumentInfo();
	if (!validFocus(current) || focusKey(current) !== focusKey(focus))
		throw new Error(`${phase}焦点原理图页或所属工程已变化`);
}
function read(component: any, getter: string): any {
	if (typeof component?.[getter] !== 'function')
		throw new Error(`器件实例缺少 ${getter}，无法保留原属性`);
	return component[getter]();
}
function normalizeFootprint(value: any): Ref {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('footprint 必须是 {uuid, libraryUuid} 对象');
	return { uuid: requireString(value.uuid, 'footprint.uuid'), libraryUuid: requireString(value.libraryUuid, 'footprint.libraryUuid') };
}
function validateItems(value: unknown): UpdateItem[] {
	if (!Array.isArray(value) || value.length === 0)
		throw new Error('items 必须是非空数组');
	const seen = new Set<string>();
	return value.map((raw, index) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw))
			throw new Error(`items[${index}] 必须是对象`);
		const item = raw as UpdateItem;
		const primitiveId = requireString(item.primitiveId, `items[${index}].primitiveId`);
		if (seen.has(primitiveId))
			throw new Error(`items 中 primitiveId ${primitiveId} 重复`);
		seen.add(primitiveId);
		if (item.footprint === undefined && item.properties === undefined)
			throw new Error(`器件 ${primitiveId} 未提供 footprint 或 properties`);
		if (item.properties !== undefined) {
			if (!item.properties || typeof item.properties !== 'object' || Array.isArray(item.properties))
				throw new Error(`器件 ${primitiveId} properties 必须是对象`);
			if (!Object.keys(item.properties).length)
				throw new Error(`器件 ${primitiveId} properties 至少包含一个要更新的字段`);
			const unknown = Object.keys(item.properties).filter(key => ![...propertyFields, 'otherProperty'].includes(key as any));
			if (unknown.length)
				throw new Error(`器件 ${primitiveId} properties 含不支持字段：${unknown.join(', ')}`);
			for (const [field, fieldValue] of Object.entries(item.properties)) {
				if (field === 'otherProperty')
					continue;
				const booleanField = field === 'addIntoBom' || field === 'addIntoPcb';
				if (booleanField ? typeof fieldValue !== 'boolean' : fieldValue !== null && typeof fieldValue !== 'string')
					throw new Error(`器件 ${primitiveId} properties.${field} 类型无效`);
			}
			if (item.properties.otherProperty !== undefined && (!item.properties.otherProperty || typeof item.properties.otherProperty !== 'object' || Array.isArray(item.properties.otherProperty)))
				throw new Error(`器件 ${primitiveId} properties.otherProperty 必须是对象`);
			for (const [key, value] of Object.entries((item.properties.otherProperty as Record<string, unknown>) ?? {})) {
				if (typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value)))
					throw new Error(`器件 ${primitiveId} properties.otherProperty.${key} 类型无效`);
			}
			const reserved = Object.keys(item.properties.otherProperty as object ?? {}).filter(key => ['footprint', 'keyfootprint', 'symbol', 'device', 'unique id', 'uniqueid'].includes(key.toLowerCase()));
			if (reserved.length)
				throw new Error(`器件 ${primitiveId} properties.otherProperty 不支持结构字段：${reserved.join(', ')}`);
		}
		return { primitiveId, ...(item.footprint === undefined ? {} : { footprint: normalizeFootprint(item.footprint) }), ...(item.properties === undefined ? {} : { properties: item.properties }) };
	});
}

function currentProperties(component: any): Record<string, any> {
	const result: Record<string, any> = {
		x: read(component, 'getState_X'),
		y: read(component, 'getState_Y'),
		rotation: read(component, 'getState_Rotation'),
		mirror: read(component, 'getState_Mirror'),
		addIntoBom: read(component, 'getState_AddIntoBom'),
		addIntoPcb: read(component, 'getState_AddIntoPcb'),
		designator: read(component, 'getState_Designator'),
		name: read(component, 'getState_Name'),
		uniqueId: read(component, 'getState_UniqueId'),
		manufacturer: read(component, 'getState_Manufacturer'),
		manufacturerId: read(component, 'getState_ManufacturerId'),
		supplier: read(component, 'getState_Supplier'),
		supplierId: read(component, 'getState_SupplierId'),
		otherProperty: read(component, 'getState_OtherProperty') ?? {},
	};
	if (!result.otherProperty || typeof result.otherProperty !== 'object' || Array.isArray(result.otherProperty))
		throw new Error('器件 otherProperty 读回不是对象');
	return result;
}

function mergeProperties(current: Record<string, any>, patch: Record<string, unknown>): Record<string, unknown> {
	const result = { ...current, otherProperty: { ...current.otherProperty } };
	for (const [field, value] of Object.entries(patch)) {
		if (field === 'otherProperty') {
			Object.assign(result.otherProperty as object, value);
			continue;
		}
		if (value !== null && !['string', 'boolean'].includes(typeof value)) {
			throw new Error(`${field} 只能是字符串、布尔值或 null`);
		}
		;(result as any)[field] = value;
	}
	for (const [key, alias] of Object.entries(aliases)) {
		const aliasPresent = Object.prototype.hasOwnProperty.call(result.otherProperty as object, key);
		if (Object.prototype.hasOwnProperty.call(patch, alias.field) && aliasPresent)
			(result.otherProperty as any)[key] = alias.boolean ? ((result as any)[alias.field] ? 'yes' : 'no') : ((result as any)[alias.field] ?? '');
		if (Object.prototype.hasOwnProperty.call(patch.otherProperty as object ?? {}, key)) {
			const value = (result.otherProperty as any)[key];
			if (alias.boolean) {
				if (value !== 'yes' && value !== 'no') {
					throw new Error(`otherProperty.${key} 必须是 "yes" 或 "no"`);
				}
				;(result as any)[alias.field] = value === 'yes';
			}
			else {
				if (typeof value !== 'string') {
					throw new TypeError(`otherProperty.${key} 必须是字符串`);
				}
				;(result as any)[alias.field] = value;
			}
		}
	}
	return result;
}

function sourceItem(document: ReturnType<typeof parseSourceLog>, primitiveId: string, requireFootprint = true): { component: unknown; footprintAttr?: { record: any; data: any } } {
	const components = resolveRecords(document, 'COMPONENT');
	const component = components.get(`COMPONENT\0${primitiveId}`);
	if (!component)
		throw new Error(`当前原理图有效源码找不到器件 ${primitiveId}`);
	const attrs = Array.from(resolveRecords(document, 'ATTR').values()).filter(record => String((record.data as any)?.parentId ?? '') === primitiveId);
	const footprints = attrs.filter((record) => {
		const key = String((record.data as any)?.key ?? '').toLowerCase();
		return key === 'footprint' || key === 'keyfootprint';
	});
	if (footprints.length > 1 || (requireFootprint && footprints.length !== 1))
		throw new Error(`器件 ${primitiveId} 的有效 ATTR keyFootprint 数量为 ${footprints.length}，无法唯一更新封装关联`);
	return { component: component.data, ...(footprints[0] ? { footprintAttr: { record: footprints[0], data: footprints[0].data } } : {}) };
}

async function readTargetFootprint(api: UpdateApi, ref: Ref): Promise<{ item: any; source: string } & ParsedFootprint> {
	const item = await api.lib_Footprint.get(ref.uuid, ref.libraryUuid);
	if (!item)
		throw new Error(`库封装 ${ref.uuid} 不存在或不可读取`);
	const source = await api.lib_Footprint.getDocumentSource(ref.uuid, ref.libraryUuid);
	if (typeof source !== 'string' || !source.trim())
		throw new Error(`库封装 ${ref.uuid} 的 documentSource 为空`);
	return { item, source, ...parseFootprintSource(source, `库封装 ${ref.uuid}`, ref.uuid) };
}

interface ParsedFootprint {
	format: 'source-log' | 'efoo-1.8';
	sourceHead: { uuid: string; source: string };
	pads: string[];
	geometry: string;
	physicalPads: string[];
	normalizedDefaultRecords: Array<{ type: string; id: string; data: unknown }>;
}

const DEFAULT_EMPTY_NET = { netType: null, specialColor: null, retLine: true, differentialName: null, isPositiveNet: false, equalLengthGroupName: null };
const DEFAULT_PRIMITIVE_RECORDS: Record<string, unknown> = {
	'["PRIMITIVE","ALL"]': { layerId: 0, display: true, color: null },
	'["PRIMITIVE","DRC"]': { layerId: 0, color: '#FFCC00' },
	'["PRIMITIVE","PROHIBITEDREGION"]': { layerId: 0, color: '#9966FF' },
	'["PRIMITIVE","BOARDSHAPE"]': { layerId: 0, color: '#6D6A69' },
	'["PRIMITIVE","PARTITION"]': { layerId: 0, color: '#C0C0C0' },
	'["PRIMITIVE","CURSOR"]': { display: true, color: '#00ffff' },
	'["PRIMITIVE","BACKGROUND"]': { display: true, color: '#000000' },
	'["PRIMITIVE","GRID"]': { display: true, color: '#ffffff' },
	'["PRIMITIVE","BOLDGRID"]': { display: true, color: '#ffffff' },
	'["PRIMITIVE","COORDINATEAXIS"]': { display: true, color: '#ffffff' },
	'["PRIMITIVE","SELECTBOX"]': { display: true, color: '#00ffff' },
};

function isObservedDefaultConfiguration(record: { type: string; id: string; data: unknown }): boolean {
	if (record.type === 'NET' && record.id === '["NET",""]')
		return same(record.data, DEFAULT_EMPTY_NET);
	if (record.type === 'PRIMITIVE' && Object.hasOwn(DEFAULT_PRIMITIVE_RECORDS, record.id))
		return same(record.data, DEFAULT_PRIMITIVE_RECORDS[record.id]);
	return false;
}

function parseFootprintSource(source: string, label: string, expectedUuid?: string): ParsedFootprint {
	const firstLine = source.split(/\r?\n/u).find(line => line.trim());
	if (!firstLine)
		throw new Error(`${label} 源码为空`);
	let firstHeader: any;
	try {
		const separator = firstLine.indexOf('||');
		firstHeader = JSON.parse(separator >= 0 ? firstLine.slice(0, separator) : firstLine);
	}
	catch {
		throw new Error(`${label} 源码首条记录头不是有效 JSON`);
	}
	if (firstHeader && !Array.isArray(firstHeader) && firstHeader.type === 'DOCHEAD') {
		const document = parseSourceLog(source);
		const docHeads = document.records.filter(record => record.header.type === 'DOCHEAD');
		const identities = docHeads.map((record) => {
			const data = record.data as any;
			if (!data || typeof data !== 'object' || Array.isArray(data) || data.docType !== 'FOOTPRINT' || typeof data.uuid !== 'string' || !data.uuid.trim())
				throw new Error(`${label} DOCHEAD 必须包含 FOOTPRINT 类型和有效 UUID`);
			return data.uuid;
		});
		if (!identities.length || identities.some(uuid => uuid !== identities[0]))
			throw new Error(`${label} 多个 DOCHEAD 的 UUID 身份冲突`);
		const uuid = identities[0];
		if (expectedUuid && uuid !== expectedUuid)
			throw new Error(`${label} DOCHEAD.uuid 与资源路径不一致（${expectedUuid}/${uuid}）`);
		for (const record of document.records) {
			if (record.header.type !== 'DOCHEAD' && (typeof record.header.id !== 'string' || !record.header.id.trim()))
				throw new Error(`${label} 存在缺少 ID 的 ${record.header.type} 源码记录`);
		}
		const effective = [...resolveRecords(document).values()];
		const sourceValue = (record: typeof document.records[number]): string | undefined => {
			const value = (record.data as any)?.source;
			if (value === undefined || value === null)
				return undefined;
			if (typeof value !== 'string')
				throw new Error(`${label} ${record.header.type}.source 必须是字符串`);
			return value || undefined;
		};
		const latestDocHead = [...docHeads].sort((a, b) => Number(a.header.ticket ?? 0) - Number(b.header.ticket ?? 0)).at(-1);
		const docHeadSource = latestDocHead ? sourceValue(latestDocHead) : undefined;
		const metaRecord = effective.find(record => record.header.type === 'META' && record.header.id === 'META');
		const metaSource = metaRecord ? sourceValue(metaRecord) : undefined;
		if (docHeadSource && metaSource && docHeadSource !== metaSource)
			throw new Error(`${label} META/DOCHEAD.source 来源冲突`);
		const normalizedDefaultRecords: ParsedFootprint['normalizedDefaultRecords'] = [];
		const records = effective.flatMap((record) => {
			if (record.header.type === 'META' && record.header.id === 'META') {
				if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data))
					throw new Error(`${label} META 数据必须是对象`);
				const { title: _title, description: _description, tags: _tags, source: _source, ...geometryData } = record.data as Record<string, unknown>;
				return Object.keys(geometryData).length ? [{ type: record.header.type, id: record.header.id, data: geometryData }] : [];
			}
			const normalized = { type: record.header.type, id: String(record.header.id), data: record.data };
			if (isObservedDefaultConfiguration(normalized)) {
				normalizedDefaultRecords.push(normalized);
				return [];
			}
			return [{ type: record.header.type, id: record.header.id, data: record.data }];
		}).sort((a, b) => json(a).localeCompare(json(b)));
		const physicalPads = effective.filter(record => record.header.type === 'PAD').map(record => json(record.data)).sort();
		const padRecords = effective.filter(record => record.header.type === 'PAD');
		for (const [index, record] of padRecords.entries()) {
			const data = record.data as any;
			if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.num !== 'string')
				throw new Error(`${label} 有效 PAD[${index}] 缺少完整编号/对象`);
		}
		return {
			format: 'source-log',
			sourceHead: { uuid, source: metaSource ?? docHeadSource ?? '' },
			pads: padRecords.map(record => String((record.data as any).num)).sort(),
			geometry: json(records),
			physicalPads,
			normalizedDefaultRecords,
		};
	}
	const rows = source.split(/\r?\n/).filter(Boolean).map((line: string, index: number) => {
		try {
			return JSON.parse(line);
		}
		catch {
			throw new Error(`${label}源码第 ${index + 1} 行不是有效 JSON`);
		}
	});
	const heads = rows.filter((row: any) => Array.isArray(row) && (row[0] === 'HEAD' || row[0] === 'DOCHEAD'));
	if (heads.length !== 1 || typeof heads[0][1]?.uuid !== 'string' || !heads[0][1].uuid.trim())
		throw new Error(`${label}源码缺少唯一且有效的 HEAD.uuid`);
	if (expectedUuid && heads[0][1].uuid !== expectedUuid)
		throw new Error(`${label}路径与 HEAD.uuid 不一致（${expectedUuid}/${heads[0][1].uuid}）`);
	const padRows = rows.filter((row: any) => Array.isArray(row) && row[0] === 'PAD');
	for (const [index, row] of padRows.entries()) {
		if (row.length < 6 || typeof row[1] !== 'string' || !row[1])
			throw new Error(`${label} PAD[${index}] 格式不完整`);
	}
	const geometryRows = rows
		.filter((row: any) => row[0] !== 'DOCTYPE' && row[0] !== 'HEAD' && row[0] !== 'DOCHEAD')
		.map((row: any) => [row[0], ...row.slice(2)])
		.map(json)
		.sort();
	return {
		format: 'efoo-1.8',
		sourceHead: { uuid: heads[0][1].uuid, source: String(heads[0][1].source ?? '') },
		pads: padRows.map((row: any) => String(row[5] ?? '')).filter(Boolean).sort(),
		geometry: json(geometryRows),
		physicalPads: padRows.map((row: any, index: number) => {
			if (row.length < 6)
				throw new Error(`${label} PAD[${index}] 缺少物理焊盘编号`);
			return json(row.slice(2));
		}).sort(),
		normalizedDefaultRecords: [],
	};
}

async function readProjectFootprint(api: UpdateApi, uuid: string): Promise<ParsedFootprint> {
	const file = await api.sys_FileManager.getProjectFile(undefined, undefined, 'epro');
	if (!file || typeof file.arrayBuffer !== 'function')
		throw new Error('工程封装资源核验时导出 epro 失败');
	const zip = await JSZip.loadAsync(await file.arrayBuffer());
	const path = `FOOTPRINT/${uuid}.efoo`;
	const entry = zip.file(path);
	if (!entry)
		throw new Error(`工程 epro 中缺少封装资源 ${path}`);
	return parseFootprintSource(await entry.async('string'), `工程封装 ${uuid}`, uuid);
}

function readDeviceFootprint(device: any): Ref | null {
	const association = device?.association;
	if (association != null && (typeof association !== 'object' || Array.isArray(association)))
		throw new Error('辅助器件 association 结构无效');
	const nested = association?.footprint;
	if (nested != null && (typeof nested !== 'object' || Array.isArray(nested)))
		throw new Error('辅助器件 association.footprint 结构无效');
	const topUuid = device?.footprintUuid == null || device.footprintUuid === '' ? '' : requireString(device.footprintUuid, '辅助器件 footprintUuid');
	const associationUuid = association?.footprintUuid == null || association.footprintUuid === '' ? '' : requireString(association.footprintUuid, '辅助器件 association.footprintUuid');
	const nestedUuid = nested?.uuid == null || nested.uuid === '' ? '' : requireString(nested.uuid, '辅助器件 association.footprint.uuid');
	const flatUuid = topUuid || associationUuid;
	if ((topUuid && associationUuid && topUuid !== associationUuid) || (flatUuid && nestedUuid && flatUuid !== nestedUuid))
		throw new Error('辅助器件平铺与嵌套封装 UUID 冲突');
	const uuid = flatUuid || nestedUuid;
	if (!uuid)
		return null;
	return { uuid, libraryUuid: nested ? requireString(nested.libraryUuid, '辅助器件 association.footprint.libraryUuid') : 'project' };
}

function readDeviceSymbol(device: any): Ref {
	const association = device?.association;
	if (association != null && (typeof association !== 'object' || Array.isArray(association)))
		throw new Error('辅助器件 association 结构无效');
	const nested = association?.symbol;
	if (nested != null && (typeof nested !== 'object' || Array.isArray(nested)))
		throw new Error('辅助器件 association.symbol 结构无效');
	const topUuid = device?.symbolUuid == null || device.symbolUuid === '' ? '' : requireString(device.symbolUuid, '辅助器件 symbolUuid');
	const associationUuid = association?.symbolUuid == null || association.symbolUuid === '' ? '' : requireString(association.symbolUuid, '辅助器件 association.symbolUuid');
	const nestedUuid = nested?.uuid == null || nested.uuid === '' ? '' : requireString(nested.uuid, '辅助器件 association.symbol.uuid');
	const flatUuid = topUuid || associationUuid;
	if ((topUuid && associationUuid && topUuid !== associationUuid) || (flatUuid && nestedUuid && flatUuid !== nestedUuid))
		throw new Error('辅助器件平铺与嵌套符号 UUID 冲突');
	const uuid = flatUuid || nestedUuid;
	if (!uuid)
		throw new Error('辅助器件缺少可核对的符号关联');
	return { uuid, libraryUuid: nested ? requireString(nested.libraryUuid, '辅助器件 association.symbol.libraryUuid') : 'project' };
}

async function resolveHelperSymbolRef(api: UpdateApi, symbolRef: Ref): Promise<Ref | null> {
	const file = await api.sys_FileManager.getProjectFile(undefined, undefined, 'epro');
	if (file && typeof file.arrayBuffer === 'function') {
		const zip = await JSZip.loadAsync(await file.arrayBuffer());
		const projectEntry = zip.file('project.json');
		if (projectEntry) {
			const project = JSON.parse(await projectEntry.async('string'));
			const symbol = project?.symbols?.[symbolRef.uuid];
			const source = typeof symbol?.source === 'string' ? symbol.source : '';
			const parts = source.split('|');
			if (parts.length === 2 && parts.every((part: string) => part.trim()) && (parts[0] !== symbolRef.uuid || parts[1] !== symbolRef.libraryUuid))
				return { uuid: parts[0], libraryUuid: parts[1] };
		}
	}
	return null;
}

async function findProjectDevice(api: UpdateApi, name: string, projectLibraryUuid: string): Promise<any[]> {
	const matches = new Map<string, any>();
	let previousPage = '';
	for (let page = 1; ; page++) {
		const found = await api.lib_Device.search(name, projectLibraryUuid, undefined, undefined, 20, page);
		if (!Array.isArray(found))
			throw new Error(`工程辅助器件查询 ${name} 返回未知结构`);
		const pageKey = json(found.map((row: any) => row?.uuid ?? row?.name ?? null));
		if (found.length === 20 && pageKey === previousPage)
			throw new Error(`工程辅助器件查询 ${name} 翻页未前进`);
		previousPage = pageKey;
		for (const row of found.filter((candidate: any) => candidate?.name === name)) {
			if (typeof row.uuid === 'string' && row.uuid)
				matches.set(row.uuid, row);
		}
		if (found.length < 20)
			break;
	}
	return [...matches.values()];
}

function sameFootprintGeometry(a: ParsedFootprint, b: ParsedFootprint): boolean {
	if (a.format === 'source-log' && b.format === 'source-log')
		return same(a.geometry, b.geometry) && same(a.physicalPads, b.physicalPads);
	if (a.format === 'efoo-1.8' && b.format === 'efoo-1.8')
		return same(a.physicalPads, b.physicalPads) && same(a.pads, b.pads);
	return same(a.physicalPads, b.physicalPads) && same(a.pads, b.pads);
}

async function verifyImportedDevice(api: UpdateApi, device: any, helperName: string, sourceRef: Ref, sourceFootprint: Awaited<ReturnType<typeof readTargetFootprint>>): Promise<{ ref: Ref; actual: Awaited<ReturnType<typeof readTargetFootprint>> }> {
	if (!device || typeof device !== 'object')
		throw new Error(`工程辅助器件 ${helperName} 无法读回`);
	readDeviceSymbol(device);
	const ref = readDeviceFootprint(device);
	if (!ref)
		throw new Error(`工程辅助器件 ${helperName} 没有关联封装`);
	const actual = await readTargetFootprint(api, ref);
	if (actual.format !== 'source-log' || !sameFootprintGeometry(sourceFootprint, actual))
		throw new Error(`辅助器件封装 ${ref.uuid} 的工程库 3.0 几何与源封装不一致`);
	const expectedSource = `${sourceRef.uuid}|${sourceRef.libraryUuid}`;
	if (actual.sourceHead.source && actual.sourceHead.source !== expectedSource)
		throw new Error(`辅助器件库封装 ${ref.uuid} 的 META/DOCHEAD.source 与目标封装来源不一致`);
	const exported = await readProjectFootprint(api, ref.uuid);
	if (exported.sourceHead.source !== expectedSource)
		throw new Error(`工程导出封装 ${ref.uuid} 的 HEAD.source 与源封装不一致`);
	if (!same(sourceFootprint.pads, exported.pads))
		throw new Error(`工程导出封装 ${ref.uuid} 的 PAD 编号与源封装不一致`);
	return { ref, actual };
}

async function findProjectCopy(api: UpdateApi, sourceRef: Ref, projectLibraryUuid: string, sourceFootprint: Awaited<ReturnType<typeof readTargetFootprint>>, component: any, onCopyStart: (reused: boolean) => void, onCopied: (device: any) => void): Promise<{ ref: Ref; reused: boolean; actual: Awaited<ReturnType<typeof readTargetFootprint>>; helperUuid: string; generatedSymbolUuid?: string }> {
	const symbol = read(component, 'getState_Symbol');
	const symbolRef = { uuid: requireString(symbol?.uuid, '原器件实际符号 UUID'), libraryUuid: requireString(symbol?.libraryUuid, '原器件实际符号库 UUID') };
	const helperSymbolRef = await resolveHelperSymbolRef(api, symbolRef);
	const helperName = `ACE_FP_${sourceRef.libraryUuid}_${sourceRef.uuid}`;
	const matches = await findProjectDevice(api, helperName, projectLibraryUuid);
	if (matches.length > 1)
		throw new Error(`工程库中存在多个同名辅助器件 ${helperName}，无法确定复用对象`);
	if (matches.length === 1) {
		const device = matches[0];
		onCopyStart(true);
		onCopied(device);
		const verified = await verifyImportedDevice(api, device, helperName, sourceRef, sourceFootprint);
		return { ...verified, reused: true, helperUuid: requireString(device.uuid, `辅助器件 ${helperName} UUID`), generatedSymbolUuid: readDeviceSymbol(device).uuid };
	}
	onCopyStart(false);
	let helperUuid: string;
	try {
		const association = helperSymbolRef ? { symbol: helperSymbolRef, footprint: sourceRef } : { symbolType: 2, footprint: sourceRef };
		helperUuid = requireString(await api.lib_Device.create(projectLibraryUuid, helperName, [], association), `辅助器件 ${helperName} 创建 UUID`);
	}
	catch (createError) {
		const appeared = await findProjectDevice(api, helperName, projectLibraryUuid).catch(() => []);
		if (appeared.length !== 1)
			throw new Error(`辅助器件创建结果不确定；已按名称查询一次，无法唯一证明资源导入。原错误：${String((createError as any)?.message ?? createError)}`);
		const device = appeared[0];
		helperUuid = requireString(device.uuid, `辅助器件 ${helperName} UUID`);
		onCopied(device);
		const verified = await verifyImportedDevice(api, device, helperName, sourceRef, sourceFootprint);
		const generatedSymbolUuid = helperSymbolRef ? undefined : readDeviceSymbol(device).uuid;
		return { ...verified, reused: false, helperUuid, generatedSymbolUuid };
	}
	onCopied({ uuid: helperUuid });
	const appeared = await findProjectDevice(api, helperName, projectLibraryUuid);
	const matchesCreated = appeared.filter((row: any) => row?.uuid === helperUuid);
	if (matchesCreated.length !== 1)
		throw new Error(`辅助器件 ${helperName} 创建后按名称查询并匹配 UUID ${helperUuid} 得到 ${matchesCreated.length} 条记录`);
	const device = matchesCreated[0];
	onCopied(device);
	const verified = await verifyImportedDevice(api, device, helperName, sourceRef, sourceFootprint);
	const generatedSymbolUuid = helperSymbolRef ? undefined : readDeviceSymbol(device).uuid;
	return { ...verified, reused: false, helperUuid, generatedSymbolUuid };
}

async function bindFootprintInPlace(api: UpdateApi, primitiveId: string, expectedAttributeId: string, expectedSourceValue: unknown, expectedEffectiveUuid: string | null, footprintUuid: string): Promise<string> {
	const ids = await api.sch_PrimitiveAttribute.getAllPrimitiveId(primitiveId);
	const attrs = await api.sch_PrimitiveAttribute.get(ids);
	const targets = (attrs ?? []).filter((attr: any) => read(attr, 'getState_Key') === 'Footprint');
	if (targets.length !== 1)
		throw new Error(`器件 ${primitiveId} 的 Footprint 属性数量为 ${targets.length}，不能唯一原位替换`);
	const attr = targets[0];
	const attrId = requireString(read(attr, 'getState_PrimitiveId'), `器件 ${primitiveId} Footprint 属性图元 ID`);
	if (attrId !== expectedAttributeId)
		throw new Error(`器件 ${primitiveId} SDK Footprint 属性 ID 与源码不一致：期望 ${expectedAttributeId}，实际 ${attrId}`);
	const componentBefore = await api.sch_PrimitiveComponent.get(primitiveId);
	const currentEffectiveUuid = read(componentBefore, 'getState_Footprint')?.uuid;
	if (currentEffectiveUuid !== expectedEffectiveUuid)
		throw new Error(`器件 ${primitiveId} 有效封装 UUID 在写入前已变化：计划 ${expectedEffectiveUuid ?? 'null'}，当前 ${String(currentEffectiveUuid ?? 'null')}`);
	const sdkValue = read(attr, 'getState_Value');
	if (sdkValue !== expectedEffectiveUuid)
		throw new Error(`器件 ${primitiveId} SDK Footprint 属性值与计划有效封装不一致：期望 ${expectedEffectiveUuid ?? 'null'}，实际 ${String(sdkValue ?? 'null')}`);
	if (typeof expectedSourceValue === 'string' && expectedSourceValue && expectedSourceValue !== expectedEffectiveUuid)
		throw new Error(`器件 ${primitiveId} 源码显式封装 UUID 与组件有效封装不一致：源码 ${expectedSourceValue}，组件 ${expectedEffectiveUuid ?? 'null'}`);
	await api.sch_PrimitiveAttribute.modify(attrId, { value: footprintUuid });
	const back = await api.sch_PrimitiveAttribute.get(attrId);
	if (!back || read(back, 'getState_Value') !== footprintUuid)
		throw new Error(`器件 ${primitiveId} 封装属性原位写入未通过读回`);
	const componentAfter = await api.sch_PrimitiveComponent.get(primitiveId);
	if (!componentAfter || read(componentAfter, 'getState_Footprint')?.uuid !== footprintUuid)
		throw new Error(`器件 ${primitiveId} 实例未读回新封装 UUID`);
	const source = await api.sys_FileManager.getDocumentSource();
	if (typeof source !== 'string')
		throw new Error(`器件 ${primitiveId} 封装原位写入后源码无法读回`);
	const document = parseSourceLog(source);
	const records = sourceItem(document, primitiveId).footprintAttr;
	if (!records || records.data.value !== footprintUuid)
		throw new Error(`器件 ${primitiveId} 封装原位写入后源码关联值不符`);
	return source;
}

async function assertFootprintAssociationReadback(api: UpdateApi, source: string, primitiveId: string, expected: ExpectedFootprint, phase: string): Promise<void> {
	const document = parseSourceLog(source);
	const sourceAttribute = sourceItem(document, primitiveId).footprintAttr;
	if (!sourceAttribute || sourceAttribute.data.value !== expected.uuid)
		throw new Error(`器件 ${primitiveId} ${phase}源码 Footprint ATTR 未读回目标 UUID ${expected.uuid}`);
	const component = await api.sch_PrimitiveComponent.get(primitiveId);
	const componentUuid = read(component, 'getState_Footprint')?.uuid;
	if (!component || componentUuid !== expected.uuid)
		throw new Error(`器件 ${primitiveId} ${phase}组件有效封装未读回目标 UUID ${expected.uuid}（实际 ${String(componentUuid ?? 'null')}）`);
	const ids = await api.sch_PrimitiveAttribute.getAllPrimitiveId(primitiveId);
	const attrs = await api.sch_PrimitiveAttribute.get(ids);
	const targets = (attrs ?? []).filter((attr: any) => ['footprint', 'keyfootprint'].includes(String(read(attr, 'getState_Key') ?? '').toLowerCase()));
	if (targets.length !== 1)
		throw new Error(`器件 ${primitiveId} ${phase}SDK Footprint 属性数量为 ${targets.length}，不能确认目标关联`);
	const attrId = read(targets[0], 'getState_PrimitiveId');
	const attrValue = read(targets[0], 'getState_Value');
	if (attrId !== sourceAttribute.record.header.id || attrValue !== expected.uuid)
		throw new Error(`器件 ${primitiveId} ${phase}SDK Footprint ATTR 与源码/目标不一致：源码 ID ${String(sourceAttribute.record.header.id)}，SDK ID ${String(attrId)}，值 ${String(attrValue)}`);
}

async function prepare(api: UpdateApi, input: unknown, withFootprintSource: boolean) {
	const items = validateItems(input);
	const focus = await api.dmt_SelectControl.getCurrentDocumentInfo();
	if (!validFocus(focus))
		throw new Error('当前焦点不是具有工程身份的原理图页');
	const source = await api.sys_FileManager.getDocumentSource();
	if (typeof source !== 'string' || !source.trim())
		throw new Error('读取当前原理图源码失败');
	const document = parseSourceLog(source);
	if (document.docType !== 'SCH_PAGE' || document.uuid !== focus.uuid)
		throw new Error(`原理图源码身份不符（${document.docType}/${document.uuid}）`);
	const rows: any[] = [];
	for (const item of items) {
		const component = await api.sch_PrimitiveComponent.get(item.primitiveId);
		if (!component)
			throw new Error(`当前原理图页找不到器件 ${item.primitiveId}`);
		const data = sourceItem(document, item.primitiveId, item.footprint !== undefined);
		const effectiveFootprintUuid = item.footprint ? read(component, 'getState_Footprint')?.uuid ?? null : null;
		const properties = item.properties ? mergeProperties(currentProperties(component), item.properties) : undefined;
		let footprint: any;
		if (item.footprint) {
			footprint = await readTargetFootprint(api, item.footprint);
			if (!withFootprintSource)
				footprint.source = undefined;
		}
		rows.push({ item, component, sourceComponent: data.component, sourceFootprintRecord: data.footprintAttr?.record, effectiveFootprintUuid, properties, footprint });
	}
	await checkFocus(api, focus, '生成更新计划期间');
	return { items: rows, focus, source };
}

export async function getComponentUpdatePlan(api: UpdateApi, input: unknown) {
	const prepared = await prepare(api, input, false);
	return {
		planVersion: 1,
		document: { uuid: prepared.focus.uuid, projectUuid: prepared.focus.parentProjectUuid },
		items: prepared.items.map(({ item, sourceComponent, sourceFootprintRecord, effectiveFootprintUuid, properties, footprint }) => ({
			...item,
			changes: {
				footprint: item.footprint ? { from: sourceFootprintRecord?.data?.value ?? null, effectiveFrom: effectiveFootprintUuid, requested: item.footprint, sourceHead: footprint.sourceHead, padNumbers: footprint.pads } : undefined,
				properties: item.properties,
			},
			baselineFingerprint: fingerprint({ component: sourceComponent, footprintAttr: sourceFootprintRecord?.data ?? null, effectiveFootprintUuid, propertyState: properties, footprintSource: footprint ? { sourceHead: footprint.sourceHead, geometry: footprint.geometry, pads: footprint.pads } : null }),
		})),
		sourceFingerprint: fingerprint(sourceContent(prepared.source)),
	};
}

function sourceContent(source: string): unknown {
	const document = parseSourceLog(source);
	return document.records.filter(record => record.header.type !== 'DOCHEAD').map(record => ({ header: record.header, data: record.data }));
}

function sameSourceExceptDocHead(a: string, b: string): boolean {
	const left = parseSourceLog(a);
	const right = parseSourceLog(b);
	if (left.docType !== right.docType || left.uuid !== right.uuid)
		return false;
	const strip = (doc: typeof left) => doc.records.filter(record => record.header.type !== 'DOCHEAD').map(record => ({ header: record.header, data: record.data }));
	return same(strip(left), strip(right));
}

function requestedAttributeKeys(item: UpdateItem): Set<string> {
	const keys = new Set<string>();
	for (const field of Object.keys(item.properties ?? {})) {
		if (field === 'otherProperty') {
			for (const key of Object.keys((item.properties?.otherProperty as Record<string, unknown>) ?? {}))
				keys.add(key.toLowerCase());
		}
		else {
			const alias = Object.entries(aliases).find(([, value]) => value.field === field)?.[0];
			keys.add((alias ?? field).toLowerCase());
		}
	}
	return keys;
}

function sourceRecordParts(line: string, lineNumber: number): { header: any; data: any } | null {
	const record = parseSourceLine(line, lineNumber);
	return record ? { header: record.header, data: record.data } : null;
}

interface HostNormalization {
	primitiveId: string;
	recordType: string;
	recordId: string;
	field: string;
	before: unknown;
	after: unknown;
	beforeHeader?: unknown;
	afterHeader?: unknown;
}

async function expectedDeviceName(api: UpdateApi, source: string, primitiveId: string): Promise<string | undefined> {
	const componentRecord = sourceItem(parseSourceLog(source), primitiveId, false).component as any;
	if (componentRecord?.attrs?.DeviceName !== null)
		return undefined;
	const records = resolveRecords(parseSourceLog(source), 'ATTR');
	const devices = [...records.values()].filter(record => record.data?.parentId === primitiveId && record.data?.key === 'Device' && typeof record.data?.value === 'string' && record.data.value.trim());
	if (devices.length !== 1)
		return undefined;
	const deviceUuid = String(devices[0].data.value);
	const file = await api.sys_FileManager.getProjectFile(undefined, undefined, 'epro').catch(() => null);
	if (!file || typeof file.arrayBuffer !== 'function')
		return undefined;
	try {
		const zip = await JSZip.loadAsync(await file.arrayBuffer());
		const entry = zip.file('project.json');
		if (!entry)
			return undefined;
		const project = JSON.parse(await entry.async('string'));
		const device = project?.devices?.[deviceUuid];
		if (!device || device.uuid !== deviceUuid || typeof device.title !== 'string' || !device.title)
			return undefined;
		return JSON.stringify({ name: device.title, source: '', uuid: deviceUuid });
	}
	catch {
		return undefined;
	}
}

function sameExcept(recordBefore: any, recordAfter: any, changes: Record<string, unknown>): boolean {
	if (!same(recordBefore?.header, recordAfter?.header) || !recordBefore?.data || !recordAfter?.data)
		return false;
	const normalized = cloneSourceData(recordAfter.data) as Record<string, unknown>;
	for (const [key, value] of Object.entries(changes))
		normalized[key] = value;
	return same(recordBefore.data, normalized);
}

function acceptableAttributeNormalization(before: any, after: any, item: UpdateItem, expectedDesignator: unknown): HostNormalization | undefined {
	if (!before || !after || before.header.type !== 'ATTR' || after.header.id !== before.header.id || before.data?.parentId !== item.primitiveId || after.data?.parentId !== item.primitiveId)
		return undefined;
	const key = String(before.data.key ?? '').toLowerCase();
	if (key === 'unique id' && (before.data.zIndex == null) && typeof after.data.zIndex === 'number' && Number.isFinite(after.data.zIndex) && sameExcept(before, after, { zIndex: before.data.zIndex }))
		return { primitiveId: item.primitiveId, recordType: 'ATTR', recordId: String(after.header.id), field: 'zIndex', before: before.data.zIndex, after: after.data.zIndex, beforeHeader: before.header, afterHeader: after.header };
	if (key === 'designator' && (before.data.value == null) && before.data.rotation == null && typeof expectedDesignator === 'string' && after.data.value === expectedDesignator && after.data.rotation === 0 && sameExcept(before, after, { value: before.data.value, rotation: before.data.rotation }))
		return { primitiveId: item.primitiveId, recordType: 'ATTR', recordId: String(after.header.id), field: 'value+rotation', before: { value: before.data.value, rotation: before.data.rotation }, after: { value: after.data.value, rotation: after.data.rotation }, beforeHeader: before.header, afterHeader: after.header };
	return undefined;
}

function restoreUnrequestedAttributes(beforeSource: string, afterSource: string, item: UpdateItem, expectedName: string | undefined, expectedDesignator: unknown): { source: string; accepted: HostNormalization[] } {
	const before = parseSourceLog(beforeSource);
	const after = parseSourceLog(afterSource);
	if (before.docType !== after.docType || before.uuid !== after.uuid)
		throw new Error('属性更新期间原理图源码身份改变');
	const allowed = requestedAttributeKeys(item);
	const targetUnrequested = (line: string, lineNumber: number): boolean => {
		const record = sourceRecordParts(line, lineNumber);
		return record?.header.type === 'ATTR'
			&& String(record.data?.parentId ?? '') === item.primitiveId
			&& !allowed.has(String(record.data?.key ?? '').toLowerCase());
	};
	const splitRows = (source: string) => {
		const rows = source.split(/\r?\n/);
		const trailingNewline = rows.at(-1) === '';
		if (trailingNewline)
			rows.pop();
		return { rows, trailingNewline, trailingSeparator: rows.at(-1)?.endsWith('|') ?? false };
	};
	const beforeRows = splitRows(beforeSource).rows;
	const afterParts = splitRows(afterSource);
	const beforeById = new Map(beforeRows.flatMap((line, index) => {
		if (!targetUnrequested(line, index + 1))
			return [];
		const record = sourceRecordParts(line, index + 1);
		return record ? [[String(record.header.id ?? ''), line] as const] : [];
	}));
	const afterTargetIds = new Set<string>();
	const accepted: HostNormalization[] = [];
	let hasUnexpectedAttribute = false;
	const afterRows: string[] = [];
	afterParts.rows.forEach((line, index) => {
		if (!targetUnrequested(line, index + 1)) {
			afterRows.push(line);
			return;
		}
		const record = sourceRecordParts(line, index + 1);
		const id = String(record?.header.id ?? '');
		if (id)
			afterTargetIds.add(id);
		const original = beforeById.get(id);
		if (original) {
			const beforeRecord = sourceRecordParts(original, 1);
			const afterRecord = record;
			const normalization = acceptableAttributeNormalization(beforeRecord, afterRecord, item, expectedDesignator);
			if (normalization) {
				afterRows.push(line);
				accepted.push(normalization);
			}
			else {
				afterRows.push(original);
			}
		}
		else {
			hasUnexpectedAttribute = true;
		}
	});
	for (const [id, line] of beforeById) {
		if (!afterTargetIds.has(id))
			afterRows.push(line);
	}
	const compareRows = (rows: string[]) => rows.map(line => line.endsWith('|') ? line.slice(0, -1) : line).sort();
	const beforeUnrequested = [...beforeById.values()];
	const afterUnrequested = afterParts.rows.flatMap((line, index) => {
		if (!targetUnrequested(line, index + 1))
			return [];
		return [line];
	});
	const malformedBoundary = afterParts.rows.slice(0, -1).some(line => line.length > 0 && !line.endsWith('|'));
	const beforeComponents = resolveRecords(before, 'COMPONENT');
	const afterComponents = resolveRecords(after, 'COMPONENT');
	const beforeComponent = beforeComponents.get(`COMPONENT\0${item.primitiveId}`);
	const afterComponent = afterComponents.get(`COMPONENT\0${item.primitiveId}`);
	if (expectedName && beforeComponent?.data?.attrs?.DeviceName === null && afterComponent?.data?.attrs?.DeviceName === expectedName && sameExcept(beforeComponent, afterComponent, { attrs: { ...beforeComponent.data.attrs, DeviceName: null } }))
		accepted.push({ primitiveId: item.primitiveId, recordType: 'COMPONENT', recordId: item.primitiveId, field: 'attrs.DeviceName', before: null, after: expectedName, beforeHeader: beforeComponent.header, afterHeader: afterComponent.header });
	if (same(compareRows(beforeUnrequested), compareRows(afterUnrequested)) && !hasUnexpectedAttribute && !malformedBoundary)
		return { source: afterSource, accepted };
	const newline = afterSource.includes('\r\n') ? '\r\n' : '\n';
	const normalized = afterRows.map((line, index) => {
		const body = line.endsWith('|') ? line.slice(0, -1) : line;
		return index < afterRows.length - 1 || afterParts.trailingSeparator ? `${body}|` : body;
	});
	return { source: normalized.join(newline) + (afterParts.trailingNewline ? newline : ''), accepted };
}

function matchesRequestedGetterValue(actual: unknown, wanted: unknown): boolean {
	if (wanted === null)
		return actual === null || actual === undefined || actual === '';
	return same(actual, wanted);
}

function verifyRequestedProperties(component: any, item: UpdateItem): void {
	const getters: Record<string, string> = {
		addIntoBom: 'getState_AddIntoBom',
		addIntoPcb: 'getState_AddIntoPcb',
		designator: 'getState_Designator',
		name: 'getState_Name',
		manufacturer: 'getState_Manufacturer',
		manufacturerId: 'getState_ManufacturerId',
		supplier: 'getState_Supplier',
		supplierId: 'getState_SupplierId',
	};
	for (const [field, wanted] of Object.entries(item.properties ?? {})) {
		if (field !== 'otherProperty') {
			if (!matchesRequestedGetterValue(read(component, getters[field]), wanted))
				throw new Error(`器件 ${item.primitiveId} 恢复源码后请求字段 ${field} 的 getter 读回不符`);
			continue;
		}
		for (const [key, value] of Object.entries(wanted as Record<string, unknown>)) {
			const alias = aliases[key];
			const effectiveWanted = alias?.boolean ? value === 'yes' : value;
			if (alias && !matchesRequestedGetterValue(read(component, getters[alias.field]), effectiveWanted))
				throw new Error(`器件 ${item.primitiveId} 恢复源码后请求属性 ${key} 的 getter 读回不符`);
			if (!alias) {
				const otherProperty = read(component, 'getState_OtherProperty');
				if (!otherProperty || typeof otherProperty !== 'object' || Array.isArray(otherProperty) || !Object.prototype.hasOwnProperty.call(otherProperty, key) || !matchesRequestedGetterValue(otherProperty[key], value))
					throw new Error(`器件 ${item.primitiveId} 恢复源码后请求属性 ${key} 的 getter 读回不符`);
			}
		}
	}
}

function matchesExpectedFootprintName(value: unknown, expected: ExpectedFootprint): boolean {
	if (typeof value !== 'string')
		return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	}
	catch {
		return false;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype)
		return false;
	const row = parsed as Record<string, unknown>;
	const keys = Object.keys(row).sort();
	if (row.uuid !== expected.uuid)
		return false;
	if (keys.length === 1 && keys[0] === 'uuid')
		return true;
	return keys.length === 2 && keys[0] === 'name' && keys[1] === 'uuid' && typeof expected.name === 'string' && row.name === expected.name;
}

function parseNamedFootprintCache(value: unknown): { uuid: string; name: string } | undefined {
	if (typeof value !== 'string')
		return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	}
	catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype)
		return undefined;
	const row = parsed as Record<string, unknown>;
	if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'uuid') || !Object.hasOwn(row, 'name') || typeof row.uuid !== 'string' || !row.uuid || typeof row.name !== 'string' || !row.name)
		return undefined;
	return { uuid: row.uuid, name: row.name };
}

function withFootprintNameCache(source: string, primitiveId: string, expected: ExpectedFootprint): string {
	if (typeof expected.name !== 'string' || !expected.name)
		throw new Error(`器件 ${primitiveId} 没有可信目标封装名称，不能修复 FootprintName 缓存`);
	const document = parseSourceLog(source);
	const component = resolveRecords(document, 'COMPONENT').get(`COMPONENT\0${primitiveId}`);
	if (!component || !component.data || typeof component.data !== 'object' || Array.isArray(component.data))
		throw new Error(`器件 ${primitiveId} 无法读回有效 COMPONENT 记录以修复 FootprintName`);
	const data = cloneSourceData(component.data) as Record<string, any>;
	if (!data.attrs || typeof data.attrs !== 'object' || Array.isArray(data.attrs))
		throw new Error(`器件 ${primitiveId} COMPONENT.attrs 无效，不能修复 FootprintName 缓存`);
	data.attrs.FootprintName = JSON.stringify({ uuid: expected.uuid, name: expected.name });
	return appendRecords(source, [{ header: { ...component.header, ticket: getMaxTicket(document) + 1 }, data }]);
}

function repairableFootprintNameCaches(beforeSource: string, afterSource: string, items: UpdateItem[], expectedFootprints: Map<string, ExpectedFootprint>): Array<{ item: UpdateItem; before: string; after: string }> {
	const before = parseSourceLog(beforeSource);
	const after = parseSourceLog(afterSource);
	const beforeComponents = resolveRecords(before, 'COMPONENT');
	const afterComponents = resolveRecords(after, 'COMPONENT');
	const repairs: Array<{ item: UpdateItem; before: string; after: string }> = [];
	for (const item of items) {
		if (!item.footprint)
			continue;
		const expected = expectedFootprints.get(item.primitiveId);
		if (!expected || typeof expected.name !== 'string' || !expected.name)
			continue;
		const beforeData = beforeComponents.get(`COMPONENT\0${item.primitiveId}`)?.data as any;
		const afterData = afterComponents.get(`COMPONENT\0${item.primitiveId}`)?.data as any;
		const beforeRaw = beforeData?.attrs?.FootprintName;
		const afterRaw = afterData?.attrs?.FootprintName;
		const beforeCache = parseNamedFootprintCache(beforeRaw);
		const afterCache = parseNamedFootprintCache(afterRaw);
		if (!beforeCache || !afterCache || beforeCache.name === expected.name || afterCache.uuid !== expected.uuid || afterCache.name !== beforeCache.name)
			continue;
		repairs.push({ item, before: beforeRaw, after: afterRaw });
	}
	return repairs;
}

function assertSourceScope(beforeSource: string, afterSource: string, items: UpdateItem[], expectedFootprints: Map<string, ExpectedFootprint> = new Map(), acceptedNormalizations: HostNormalization[] = []): void {
	const before = parseSourceLog(beforeSource);
	const after = parseSourceLog(afterSource);
	if (before.docType !== after.docType || before.uuid !== after.uuid)
		throw new Error('更新后原理图源码身份改变');
	const targets = new Set(items.map(item => item.primitiveId));
	const targetAttributeIds = new Set([...before.records, ...after.records]
		.filter(record => record.header.type === 'ATTR' && targets.has(String((record.data as any)?.parentId ?? '')))
		.map(record => String(record.header.id ?? '')));
	const nonTargetRecords = (document: typeof before) => document.records
		.filter((record) => {
			if (record.header.type === 'DOCHEAD')
				return false;
			if (record.header.type === 'COMPONENT' && targets.has(String(record.header.id ?? '')))
				return false;
			if (record.header.type === 'ATTR' && (targets.has(String((record.data as any)?.parentId ?? '')) || targetAttributeIds.has(String(record.header.id ?? ''))))
				return false;
			return true;
		})
		.map(record => ({ header: record.header, data: record.data }));
	if (!same(nonTargetRecords(before), nonTargetRecords(after)))
		throw new Error('更新后非目标器件、导线或其它源码记录发生变化');
	const beforeComponents = resolveRecords(before, 'COMPONENT');
	const afterComponents = resolveRecords(after, 'COMPONENT');
	const beforeAttrs = resolveRecords(before, 'ATTR');
	const afterAttrs = resolveRecords(after, 'ATTR');
	for (const item of items) {
		const beforeComponent = beforeComponents.get(`COMPONENT\0${item.primitiveId}`);
		const afterComponent = afterComponents.get(`COMPONENT\0${item.primitiveId}`);
		const beforeData = cloneSourceData(beforeComponent?.data);
		const afterData = cloneSourceData(afterComponent?.data);
		const expectedFootprint = expectedFootprints.get(item.primitiveId);
		if (item.footprint && expectedFootprint && beforeData?.attrs && afterData?.attrs && matchesExpectedFootprintName(afterData.attrs.FootprintName, expectedFootprint))
			afterData.attrs.FootprintName = beforeData.attrs.FootprintName;
		const deviceNameNormalization = acceptedNormalizations.find(normalization => normalization.primitiveId === item.primitiveId && normalization.recordType === 'COMPONENT' && normalization.field === 'attrs.DeviceName');
		if (deviceNameNormalization && afterComponent && beforeData && afterData && beforeData.attrs && afterData.attrs && beforeData.attrs.DeviceName === deviceNameNormalization.before && afterData.attrs.DeviceName === deviceNameNormalization.after && same(afterComponent.header, deviceNameNormalization.afterHeader)) {
			const beforeDevice = [...beforeAttrs.values()].filter(record => record.data?.parentId === item.primitiveId && record.data?.key === 'Device');
			let deviceJson: any;
			try {
				deviceJson = JSON.parse(String(deviceNameNormalization.after));
			}
			catch { throw new Error(`器件 ${item.primitiveId} COMPONENT.attrs.DeviceName 宿主补全不是 JSON`); }
			if (beforeDevice.length !== 1 || beforeDevice[0].data.value !== deviceJson?.uuid || deviceJson?.source !== '' || typeof deviceJson?.name !== 'string')
				throw new Error(`器件 ${item.primitiveId} COMPONENT.attrs.DeviceName 未与既有 Device ATTR 匹配`);
			afterData.attrs.DeviceName = deviceNameNormalization.before;
		}
		if (!beforeComponent || !afterComponent || !same(beforeData, afterData))
			throw new Error(`器件 ${item.primitiveId} 的符号、位号、位置、姿态、唯一 ID 或连线相关组件数据发生变化`);
		const allowed = requestedAttributeKeys(item);
		if (item.footprint) {
			allowed.add('footprint');
			allowed.add('keyfootprint');
		}
		const unchangedAttributes = (records: Map<string, any>, isAfter: boolean) => [...records.values()]
			.filter(record => String((record.data as any)?.parentId ?? '') === item.primitiveId)
			.filter(record => !allowed.has(String((record.data as any)?.key ?? '').toLowerCase()))
			.map((record) => {
				const normalization = isAfter ? acceptedNormalizations.find(row => row.primitiveId === item.primitiveId && row.recordType === 'ATTR' && row.recordId === String(record.header.id)) : undefined;
				if (!normalization)
					return { type: record.header.type, id: record.header.id, data: record.data };
				const beforeRecord = beforeAttrs.get(`ATTR\0${normalization.recordId}`);
				const fieldMatches = normalization.field === 'value+rotation'
					? record.data.value === (normalization.after as any).value && record.data.rotation === (normalization.after as any).rotation
					: record.data[normalization.field] === normalization.after;
				if (!beforeRecord || !same(record.header, normalization.afterHeader) || !fieldMatches)
					throw new Error(`器件 ${item.primitiveId} 属性 ${normalization.recordId} 的宿主补全读回发生变化（${normalization.field}，header=${same(record.header, normalization.afterHeader)}，expected=${json(normalization.after)}，actual=${json(normalization.field === 'value+rotation' ? { value: record.data.value, rotation: record.data.rotation } : record.data[normalization.field])}）`);
				const normalized = cloneSourceData(record.data) as any;
				if (normalization.field === 'value+rotation') {
					normalized.value = (normalization.before as any).value;
					normalized.rotation = (normalization.before as any).rotation;
				}
				else {
					normalized[normalization.field] = normalization.before;
				}
				return { type: record.header.type, id: record.header.id, data: normalized };
			});
		if (!same(unchangedAttributes(beforeAttrs, false), unchangedAttributes(afterAttrs, true)))
			throw new Error(`器件 ${item.primitiveId} 未请求更新的属性发生变化`);
	}
}

function failPartial(message: string, state: Record<string, unknown>): never {
	const error = new Error(message) as Error & { partial: boolean; retryable: boolean };
	error.partial = true;
	error.retryable = false;
	error.cause = { partial: true, retryable: false, ...state };
	throw error;
}

export async function updateComponents(api: UpdateApi, plan: any) {
	if (!plan || plan.planVersion !== 1 || !Array.isArray(plan.items) || typeof plan.sourceFingerprint !== 'string')
		throw new Error('plan 结构无效，请先调用 schematic.getComponentUpdatePlan');
	const requests = validateItems(plan.items.map((item: any) => ({ primitiveId: item.primitiveId, footprint: item.footprint, properties: item.properties })));
	const prepared = await prepare(api, requests, true);
	if (focusKey(prepared.focus) !== `1\0${plan.document?.uuid}\0${plan.document?.projectUuid}` || plan.sourceFingerprint !== fingerprint(sourceContent(prepared.source)))
		throw new Error('更新计划生成后器件、属性或封装源码已变化；请重新生成计划');
	for (let index = 0; index < prepared.items.length; index++) {
		const planned = plan.items[index];
		const current = prepared.items[index];
		if (planned.baselineFingerprint !== fingerprint({ component: current.sourceComponent, footprintAttr: current.sourceFootprintRecord?.data ?? null, effectiveFootprintUuid: current.effectiveFootprintUuid, propertyState: current.properties, footprintSource: current.footprint ? { sourceHead: current.footprint.sourceHead, geometry: current.footprint.geometry, pads: current.footprint.pads } : null }))
			throw new Error(`器件 ${current.item.primitiveId} 的计划基线已变化；请重新生成计划`);
	}
	const copied: Array<any> = [];
	const updated: Array<string> = [];
	const verified: Array<string> = [];
	const notAttempted: Array<string> = [];
	const updatedRefs = new Map<string, { ref: Ref; reused: boolean; actual: Awaited<ReturnType<typeof readTargetFootprint>>; resource: any }>();
	const expectedFootprints = new Map<string, ExpectedFootprint>();
	const acceptedHostNormalizations: HostNormalization[] = [];
	const footprintNameRepairs: Array<{ primitiveId: string; before: string; after: string; target: ExpectedFootprint; sourceWriteStarted: boolean; sourceWriteCompleted: boolean; readbackVerified: boolean }> = [];
	let source = prepared.source;
	let document = parseSourceLog(source);
	let currentIndex = -1;
	let currentPhases: string[] = [];
	let writeStarted = false;
	try {
		for (const [index, entry] of prepared.items.entries()) {
			currentIndex = index;
			const { item } = entry;
			const phase: string[] = [];
			currentPhases = phase;
			if (item.footprint) {
				const key = `${item.footprint.libraryUuid}\0${item.footprint.uuid}`;
				let cached = updatedRefs.get(key);
				if (!cached) {
					await checkFocus(api, prepared.focus, '封装导入前');
					const projectLibraryUuid = requireString(await api.lib_LibrariesList.getProjectLibraryUuid(), '当前工程库 UUID');
					const component = await api.sch_PrimitiveComponent.get(item.primitiveId);
					if (!component)
						throw new Error(`器件 ${item.primitiveId} 封装导入前无法读回实例`);
					const importRecord: { from: Ref; primitiveId: string; reused: boolean; verified: boolean; libraryReadback: boolean; projectResourcePresent: boolean; libraryGeometryVerified: boolean; serializedGeometryVerified: boolean; helperUuid: string | null; actualFootprint: Ref | null; generatedSymbolUuid: string | null; actualSource: unknown; padNumbers: string[] } = { from: item.footprint, primitiveId: item.primitiveId, reused: false, verified: false, libraryReadback: false, projectResourcePresent: false, libraryGeometryVerified: false, serializedGeometryVerified: false, helperUuid: null, actualFootprint: null, generatedSymbolUuid: null, actualSource: null, padNumbers: [] };
					const located = await findProjectCopy(api, item.footprint, projectLibraryUuid, entry.footprint, component, (reused) => {
						phase.push(reused ? 'project-device-resource-reuse-check-started' : 'project-device-import-started');
						writeStarted = true;
						copied.push(importRecord);
					}, (device) => {
						importRecord.helperUuid = typeof device?.uuid === 'string' ? device.uuid : null;
						const footprintUuid = device?.footprintUuid ?? device?.association?.footprintUuid ?? device?.association?.footprint?.uuid;
						if (typeof footprintUuid === 'string' && footprintUuid)
							importRecord.actualFootprint = { uuid: footprintUuid, libraryUuid: device?.association?.footprint?.libraryUuid ?? 'project' };
						const symbolUuid = device?.symbolUuid ?? device?.association?.symbolUuid ?? device?.association?.symbol?.uuid;
						if (typeof symbolUuid === 'string' && symbolUuid)
							importRecord.generatedSymbolUuid = symbolUuid;
						phase.push('project-device-import-returned');
					});
					const resource: any = Object.assign(importRecord, { helperUuid: located.helperUuid, generatedSymbolUuid: located.generatedSymbolUuid ?? null, to: located.ref, reused: located.reused, libraryReadback: true, libraryGeometryVerified: true, projectResourcePresent: true, serializedGeometryVerified: false, actualFootprintSource: located.actual.sourceHead, actualSource: { uuid: entry.footprint.sourceHead.uuid, libraryUuid: item.footprint.libraryUuid }, padNumbers: located.actual.pads });
					if (entry.footprint.normalizedDefaultRecords.length || located.actual.normalizedDefaultRecords.length)
						resource.normalizedDefaultRecords = { target: entry.footprint.normalizedDefaultRecords, imported: located.actual.normalizedDefaultRecords };
					if (!copied.includes(importRecord))
						copied.push(resource);
					cached = { ...located, resource };
					updatedRefs.set(key, cached);
					phase.push(located.reused ? 'project-device-resource-reused' : 'project-device-resource-imported');
				}
				const projectRef = cached.ref;
				const copiedResource = cached.resource;
				const projectFootprint = cached.actual;
				const requestedPads = [...new Set(entry.footprint.pads)].sort();
				const copiedPads = [...new Set(projectFootprint.pads)].sort();
				if (!same(requestedPads, copiedPads))
					throw new Error(`工程库封装 ${projectRef.uuid} PAD 编号与目标封装不一致`);
				phase.push('copied-footprint-library-readback');
				const currentSource = await api.sys_FileManager.getDocumentSource();
				if (typeof currentSource !== 'string' || !sameSourceExceptDocHead(source, currentSource))
					throw new Error(`器件 ${item.primitiveId} 写入前原理图源码已变化`);
				source = currentSource;
				document = parseSourceLog(source);
				const currentAttr = sourceItem(document, item.primitiveId).footprintAttr;
				if (!currentAttr)
					throw new Error(`器件 ${item.primitiveId} 写入前缺少 Footprint ATTR`);
				await checkFocus(api, prepared.focus, `器件 ${item.primitiveId} 封装关联写入前`);
				writeStarted = true;
				source = await bindFootprintInPlace(api, item.primitiveId, entry.sourceFootprintRecord.header.id, (currentAttr.data as any).value, entry.effectiveFootprintUuid, projectRef.uuid);
				document = parseSourceLog(source);
				phase.push('footprint-association-updated');
				if (!updated.includes(item.primitiveId))
					updated.push(item.primitiveId);
				const component = await api.sch_PrimitiveComponent.get(item.primitiveId);
				const attached = read(component, 'getState_Footprint');
				if (attached?.uuid !== projectRef.uuid)
					throw new Error(`器件 ${item.primitiveId} 实例读回封装 UUID 不符`);
				const projectResource = await readProjectFootprint(api, projectRef.uuid);
				if (projectResource.sourceHead.source !== `${item.footprint.uuid}|${item.footprint.libraryUuid}` || !same(entry.footprint.pads, projectResource.pads))
					throw new Error(`器件 ${item.primitiveId} 工程 epro 封装来源或 PAD 编号与目标不一致`);
				copiedResource.verified = true;
				copiedResource.projectResourcePresent = true;
				copiedResource.libraryGeometryVerified = true;
				copiedResource.serializedGeometryVerified = false;
				copiedResource.projectReadbackSource = projectResource.sourceHead;
				copiedResource.projectReadbackPadNumbers = projectResource.pads;
				const footprintName = cached.actual.item?.name;
				expectedFootprints.set(item.primitiveId, { uuid: projectRef.uuid, ...(typeof footprintName === 'string' && footprintName ? { name: footprintName } : {}) });
				phase.push('footprint-resource-verified');
			}
			if (item.properties) {
				const beforePropertiesSource = await api.sys_FileManager.getDocumentSource();
				if (typeof beforePropertiesSource !== 'string' || !sameSourceExceptDocHead(source, beforePropertiesSource))
					throw new Error(`器件 ${item.primitiveId} 属性更新前原理图源码已变化`);
				source = beforePropertiesSource;
				const current = await api.sch_PrimitiveComponent.get(item.primitiveId);
				if (!current)
					throw new Error(`器件 ${item.primitiveId} 属性更新前无法读取当前实例`);
				const expectedName = await expectedDeviceName(api, beforePropertiesSource, item.primitiveId);
				const expectedDesignator = read(current, 'getState_Designator');
				const full = mergeProperties(currentProperties(current), item.properties);
				writeStarted = true;
				await modifyComponentSafely(api, item.primitiveId, full);
				if (expectedFootprints.has(item.primitiveId)) {
					const after = await api.sch_PrimitiveComponent.get(item.primitiveId);
					if (!after || read(after, 'getState_Footprint')?.uuid !== expectedFootprints.get(item.primitiveId)?.uuid)
						throw new Error(`器件 ${item.primitiveId} 属性更新后封装关联被覆盖`);
				}
				phase.push('properties-updated-verified');
				if (!updated.includes(item.primitiveId))
					updated.push(item.primitiveId);
				const modifiedSource = await api.sys_FileManager.getDocumentSource();
				if (typeof modifiedSource !== 'string' || !modifiedSource.trim())
					throw new Error(`器件 ${item.primitiveId} 属性更新后原理图源码无法读回`);
				const restoration = restoreUnrequestedAttributes(beforePropertiesSource, modifiedSource, item, expectedName, expectedDesignator);
				const restoredSource = restoration.source;
				acceptedHostNormalizations.push(...restoration.accepted);
				if (!sameSourceExceptDocHead(modifiedSource, restoredSource)) {
					phase.push('unrequested-attribute-restoration-pending');
					await checkFocus(api, prepared.focus, `器件 ${item.primitiveId} 恢复未请求属性前`);
					phase.push('unrequested-attribute-restoration-started');
					const restoreResult = await api.sys_FileManager.setDocumentSource(restoredSource);
					if (restoreResult !== true)
						throw new Error(`器件 ${item.primitiveId} 恢复未请求属性时 setDocumentSource 返回 ${String(restoreResult)}`);
					const restoredReadback = await api.sys_FileManager.getDocumentSource();
					if (typeof restoredReadback !== 'string' || !restoredReadback.trim())
						throw new Error(`器件 ${item.primitiveId} 恢复未请求属性后的源码读回不匹配`);
					const readbackRestoration = restoreUnrequestedAttributes(restoredSource, restoredReadback, item, expectedName, expectedDesignator);
					assertSourceScope(restoredSource, restoredReadback, [item], expectedFootprints, readbackRestoration.accepted);
					acceptedHostNormalizations.push(...readbackRestoration.accepted);
					phase.push('unrequested-attributes-restored');
					source = restoredReadback;
					const restoredComponent = await api.sch_PrimitiveComponent.get(item.primitiveId);
					if (!restoredComponent)
						throw new Error(`器件 ${item.primitiveId} 恢复源码后无法读取实例`);
					verifyRequestedProperties(restoredComponent, item);
					phase.push('requested-properties-reverified-after-restore');
				}
				else {
					source = modifiedSource;
				}
			}
			entry.phase = phase;
		}
		source = await api.sys_FileManager.getDocumentSource();
		if (typeof source !== 'string' || !source.trim())
			throw new Error('更新后无法读取原理图源码');
		const plannedFootprintNameRepairs = repairableFootprintNameCaches(prepared.source, source, requests, expectedFootprints);
		if (plannedFootprintNameRepairs.length) {
			let candidate = source;
			for (const repair of plannedFootprintNameRepairs) {
				const expected = expectedFootprints.get(repair.item.primitiveId)!;
				await assertFootprintAssociationReadback(api, source, repair.item.primitiveId, expected, '缓存修正前');
				candidate = withFootprintNameCache(candidate, repair.item.primitiveId, expected);
				footprintNameRepairs.push({ primitiveId: repair.item.primitiveId, before: repair.after, after: JSON.stringify({ uuid: expected.uuid, name: expected.name }), target: expected, sourceWriteStarted: false, sourceWriteCompleted: false, readbackVerified: false });
			}
			assertSourceScope(prepared.source, candidate, requests, expectedFootprints, acceptedHostNormalizations);
			await checkFocus(api, prepared.focus, '修正 FootprintName 缓存前');
			const latestSource = await api.sys_FileManager.getDocumentSource();
			if (typeof latestSource !== 'string' || !sameSourceExceptDocHead(source, latestSource))
				throw new Error('修正 FootprintName 缓存前原理图源码已变化');
			currentPhases.push('footprint-name-cache-repair-pending');
			writeStarted = true;
			currentPhases.push('footprint-name-cache-repair-started');
			for (const repair of footprintNameRepairs)
				repair.sourceWriteStarted = true;
			const repairResult = await api.sys_FileManager.setDocumentSource(candidate);
			if (repairResult !== true)
				throw new Error(`FootprintName 缓存修正 setDocumentSource 返回 ${String(repairResult)}`);
			for (const repair of footprintNameRepairs)
				repair.sourceWriteCompleted = true;
			const repairedReadback = await api.sys_FileManager.getDocumentSource();
			if (typeof repairedReadback !== 'string' || !repairedReadback.trim())
				throw new Error('FootprintName 缓存修正后源码无法读回');
			if (!sameSourceExceptDocHead(candidate, repairedReadback))
				throw new Error('FootprintName 缓存修正后的源码读回除 DOCHEAD 外发生变化');
			const repairedDocument = parseSourceLog(repairedReadback);
			const repairedComponents = resolveRecords(repairedDocument, 'COMPONENT');
			for (const repair of plannedFootprintNameRepairs) {
				const expected = expectedFootprints.get(repair.item.primitiveId)!;
				const data = repairedComponents.get(`COMPONENT\0${repair.item.primitiveId}`)?.data as any;
				const cache = parseNamedFootprintCache(data?.attrs?.FootprintName);
				if (!cache || cache.uuid !== expected.uuid || cache.name !== expected.name)
					throw new Error(`器件 ${repair.item.primitiveId} FootprintName 缓存修正读回不符`);
			}
			for (const repair of footprintNameRepairs)
				repair.readbackVerified = true;
			source = repairedReadback;
			currentPhases.push('footprint-name-cache-repair-readback-verified');
		}
		assertSourceScope(prepared.source, source, requests, expectedFootprints, acceptedHostNormalizations);
		for (const [primitiveId, expected] of expectedFootprints) {
			await assertFootprintAssociationReadback(api, source, primitiveId, expected, '最终');
		}
		for (const item of requests) {
			if (!item.properties)
				continue;
			const current = await api.sch_PrimitiveComponent.get(item.primitiveId);
			if (!current)
				throw new Error(`器件 ${item.primitiveId} 最终属性读回无法读取实例`);
			verifyRequestedProperties(current, item);
		}
		verified.push(...requests.map(item => item.primitiveId));
		return { updated, verified, copiedResources: copied, acceptedHostNormalizations, footprintNameRepairs, verificationScope: 'schematic-instance-and-requested-updates', electricalMappingVerified: false, pcbSynchronized: false, persistenceVerified: false };
	}
	catch (error) {
		if (!writeStarted)
			throw error;
		for (const entry of prepared.items.slice(currentIndex + 1)) {
			if (!updated.includes(entry.item.primitiveId))
				notAttempted.push(entry.item.primitiveId);
		}
		const itemPhases = prepared.items.map((entry, index) => ({ primitiveId: entry.item.primitiveId, phases: index === currentIndex ? currentPhases : entry.phase ?? [] }));
		failPartial(`器件更新在执行中停止：${String((error as any)?.message ?? error)}`, { copiedResources: copied, items: itemPhases, updated, verified, notAttempted, currentPrimitiveId: prepared.items[currentIndex]?.item.primitiveId, currentPhases, footprintNameRepairs, operationError: String((error as any)?.message ?? error) });
	}
}
