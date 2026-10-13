import JSZip from 'jszip';
import { effectiveRecordsByType, extractPcbDocument, parseSourceLog } from '../pcb/sourcelog';

type ImportApi = Record<string, any>;

interface ExpectedPin {
	number: string;
	net: string;
}

interface ExpectedComponent {
	identity: string;
	uniqueId: string;
	channelId: string;
	designator: string;
	footprintUuid: string;
	pins: Array<ExpectedPin>;
}

function value(object: any, getter: string): any {
	const fn = object?.[getter];
	if (typeof fn !== 'function')
		throw new Error(`PCB 读回对象缺少 ${getter}`);
	return fn.call(object);
}

function string(value: unknown, label: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
		throw new Error(`${label} 缺失或无效`);
	return value.trim();
}

function propsOf(component: any): Record<string, any> {
	const props = component?.props;
	if (!props || typeof props !== 'object' || Array.isArray(props))
		throw new Error('JLCEDA 网表器件缺少 props 对象');
	return props;
}

function identityOf(uniqueId: string, channelId: string): string {
	return `${uniqueId}\u0000${channelId}`;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function parseNetlist(text: string): Array<ExpectedComponent> {
	const data = JSON.parse(text);
	if (!data || typeof data !== 'object' || !data.components || typeof data.components !== 'object' || Array.isArray(data.components))
		throw new Error('JLCEDA 网表缺少 components 对象');
	const merged = new Map<string, ExpectedComponent>();
	for (const [key, raw] of Object.entries(data.components as Record<string, any>)) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw))
			throw new Error(`网表器件 ${key} 结构无效`);
		const props = propsOf(raw);
		if (String(props['Convert to PCB'] ?? '').toLowerCase() !== 'yes')
			continue;
		const uniqueId = string(props['Unique ID'] ?? key, `网表器件 ${key} Unique ID`);
		const channelId = string(props['Channel ID'] ?? '', `网表器件 ${key} Channel ID`, true);
		const designator = string(props.Designator, `网表器件 ${key} Designator`);
		const footprintUuid = string(props.Footprint, `网表器件 ${key} Footprint`);
		const rawPins = raw.pinInfoMap;
		if (!rawPins || typeof rawPins !== 'object' || Array.isArray(rawPins))
			throw new Error(`网表器件 ${designator} 缺少 pinInfoMap`);
		const pins = Object.entries(rawPins as Record<string, any>).map(([pinKey, pin]) => {
			if (!pin || typeof pin !== 'object' || Array.isArray(pin))
				throw new Error(`网表器件 ${designator} 引脚 ${pinKey} 结构无效`);
			return {
				number: string(pin.number ?? pin.pin ?? pinKey, `${designator} 引脚号`),
				net: typeof pin.net === 'string' ? pin.net : pin.net == null ? '' : String(pin.net),
			};
		}).sort((a, b) => a.number.localeCompare(b.number) || a.net.localeCompare(b.net));
		const identity = identityOf(uniqueId, channelId);
		const component = { identity, uniqueId, channelId, designator, footprintUuid, pins };
		const previous = merged.get(identity);
		if (previous && stableJson(previous) !== stableJson(component))
			throw new Error(`多页网表存在冲突身份 ${uniqueId}/${channelId}，内容不一致`);
		merged.set(identity, component);
	}
	return [...merged.values()];
}

async function awaitWithin<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超时；调用结果可能未知`)), timeoutMs); }),
		]);
	}
	finally {
		if (timer)
			clearTimeout(timer);
	}
}

function partialError(message: string, details: Record<string, unknown>, cause?: unknown): Error {
	const error = cause instanceof Error ? cause : new Error(message)
	;(error as any).cause = { partial: true, retryable: false, contentsVerified: false, ...details };
	if (!cause)
		error.message = message;
	return error;
}

async function requireFocus(api: ImportApi, documentType: number, uuid: string, label: string): Promise<void> {
	const focus = await api.dmt_SelectControl.getCurrentDocumentInfo();
	if (focus?.documentType !== documentType || focus?.uuid !== uuid)
		throw new Error(`${label}焦点身份不符（期望 type=${documentType}, uuid=${uuid}; 实际 type=${focus?.documentType ?? '未知'}, uuid=${focus?.uuid ?? '未知'}）`);
}

async function projectFootprints(api: ImportApi, focusUuid: string): Promise<Map<string, string>> {
	await requireFocus(api, 3, focusUuid, '封装映射导出前');
	const file = await api.sys_FileManager.getProjectFile(undefined, undefined, 'epro');
	if (!file || typeof file.arrayBuffer !== 'function')
		throw new Error('导出工程封装映射失败：未返回 epro 文件');
	await requireFocus(api, 3, focusUuid, '封装映射导出后');
	const zip = await JSZip.loadAsync(await file.arrayBuffer());
	const result = new Map<string, string>();
	for (const path of Object.keys(zip.files).filter(name => /^FOOTPRINT\/[^/]+\.efoo$/i.test(name))) {
		const source = await zip.files[path].async('string');
		let head: any;
		for (const [index, line] of source.split(/\r?\n/).entries()) {
			if (!line.trim())
				continue;
			let row: any;
			try {
				row = JSON.parse(line);
			}
			catch (error) {
				throw new Error(`封装 ${path} 第 ${index + 1} 行格式无效：${String((error as any)?.message ?? error)}`);
			}
			if (!Array.isArray(row) || typeof row[0] !== 'string')
				throw new Error(`封装 ${path} 第 ${index + 1} 行不是支持的记录`);
			if (row[0] === 'HEAD' || row[0] === 'DOCHEAD') {
				if (head)
					throw new Error(`封装 ${path} 含多个 HEAD/DOCHEAD 记录`);
				head = row[1];
			}
		}
		if (head && typeof head.uuid === 'string' && typeof head.source === 'string') {
			const sourceParts = head.source.split('|');
			if (sourceParts.length !== 2 || !sourceParts[0] || !sourceParts[1])
				throw new Error(`封装 ${path} 的 HEAD.source 无法解析`);
			result.set(head.uuid, sourceParts[0]);
		}
	}
	return result;
}

function attributes(source: string): Map<string, Record<string, string>> {
	const doc = parseSourceLog(source);
	const result = new Map<string, Record<string, string>>();
	for (const record of effectiveRecordsByType(doc, 'ATTR')) {
		const data = record.data as any;
		if (!data?.parentId || !data?.key)
			continue;
		const row = result.get(String(data.parentId)) ?? {};
		row[String(data.key).toLowerCase()] = String(data.value ?? '');
		result.set(String(data.parentId), row);
	}
	return result;
}

function snapshotPcbOnly(source: string): Array<unknown> {
	const doc = parseSourceLog(source);
	const attrs = attributes(source);
	const padNets = effectiveRecordsByType(doc, 'PAD_NET');
	const result: Array<unknown> = [];
	for (const record of effectiveRecordsByType(doc, 'COMPONENT')) {
		const id = String(record.header.id);
		const data = record.data as any;
		const uniqueId = attrs.get(id)?.['unique id'] ?? String(data?.attrs?.['Unique ID'] ?? '');
		if (uniqueId)
			continue;
		const relatedAttrs = effectiveRecordsByType(doc, 'ATTR').filter(row => String((row.data as any)?.parentId ?? '') === id).map(row => row.data);
		const relatedPads = padNets.filter((row) => {
			try {
				return JSON.parse(String(row.header.id))?.[1] === id;
			}
			catch {
				return false;
			}
		}).map(row => ({ id: row.header.id, data: row.data }));
		result.push({ id, component: data, attributes: relatedAttrs, padNets: relatedPads });
	}
	return result.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
}

function mismatch(condition: boolean, text: string, out: Array<string>): void {
	if (!condition)
		out.push(text);
}

async function verifyContents(api: ImportApi, pcbUuid: string, expected: Array<ExpectedComponent>, beforePcbOnly: Array<unknown>): Promise<Record<string, unknown>> {
	await requireFocus(api, 3, pcbUuid, '读回 PCB 前');
	const source = await api.sys_FileManager.getDocumentSource();
	if (typeof source !== 'string' || !source.trim())
		throw new Error('读取 PCB 源码失败');
	const parsed = extractPcbDocument(source);
	if (parsed.uuid !== pcbUuid)
		throw new Error(`PCB 源码 UUID 不符（${parsed.uuid}）`);
	const attrs = attributes(source);
	const padNets = new Map<string, Array<{ physicalId: string; net: string }>>();
	for (const record of effectiveRecordsByType(parseSourceLog(source), 'PAD_NET')) {
		let identity: any;
		try {
			identity = JSON.parse(String(record.header.id));
		}
		catch {
			throw new Error(`PCB PAD_NET 记录 ID 无效：${String(record.header.id)}`);
		}
		if (!Array.isArray(identity) || identity.length < 3 || identity[0] !== 'PAD_NET')
			throw new Error(`PCB PAD_NET 记录身份格式不受支持：${String(record.header.id)}`);
		const data = record.data as any;
		const key = `${identity[1]}\u0000${identity[2]}`;
		padNets.set(key, [...(padNets.get(key) ?? []), { physicalId: String(identity[3]), net: typeof data?.padNet === 'string' ? data.padNet : '' }]);
	}
	const sourceByIdentity = new Map<string, any>();
	const sourceChannelByUniqueId = new Map<string, Array<{ component: any; channelId: string }>>();
	for (const component of parsed.components) {
		const row = attrs.get(component.id) ?? {};
		const uniqueId = row['unique id'] ?? String((component.data.attrs as any)?.['Unique ID'] ?? '');
		const channelId = row['channel id'] ?? String((component.data.attrs as any)?.['Channel ID'] ?? '');
		if (!uniqueId)
			continue;
		const identity = identityOf(uniqueId, channelId);
		if (sourceByIdentity.has(identity))
			throw new Error(`PCB 源码有重复身份 ${uniqueId}/${channelId}`);
		sourceByIdentity.set(identity, component);
		sourceChannelByUniqueId.set(uniqueId, [...(sourceChannelByUniqueId.get(uniqueId) ?? []), { component, channelId }]);
	}
	const libraryFootprints = await projectFootprints(api, pcbUuid);
	const actual = await api.pcb_PrimitiveComponent.getAll();
	if (!Array.isArray(actual))
		throw new Error('PCB 器件列表读回失败');
	const byIdentity = new Map<string, any>();
	for (const component of actual) {
		const uniqueId = value(component, 'getState_UniqueId');
		if (typeof uniqueId !== 'string' || !uniqueId.trim())
			continue; // 不带原理图 Unique ID 的 PCB-only 器件不属于托管集合。
		const other = typeof component.getState_OtherProperty === 'function' ? component.getState_OtherProperty() : {};
		const sourceMatches = sourceChannelByUniqueId.get(uniqueId) ?? [];
		const sourceEntry = sourceMatches.length === 1 ? sourceMatches[0] : undefined;
		const sourceComponent = sourceEntry?.component;
		const channelFromSource = sourceEntry?.channelId ?? '';
		const channelId = String(other?.['Channel ID'] ?? channelFromSource);
		if (!sourceComponent && !Object.prototype.hasOwnProperty.call(other ?? {}, 'Channel ID'))
			throw new Error(`无法从 PCB 实际器件或有效源码唯一确认 Channel ID（${uniqueId}）`);
		const identity = identityOf(uniqueId, channelId);
		if (byIdentity.has(identity))
			throw new Error(`PCB SDK 读回存在重复身份 ${uniqueId}/${channelId}`);
		byIdentity.set(identity, component);
	}
	const differences: Array<string> = [];
	const afterPcbOnly = snapshotPcbOnly(source);
	const pcbOnlyPreserved = stableJson(beforePcbOnly) === stableJson(afterPcbOnly);
	if (!pcbOnlyPreserved)
		differences.push('PCB-only 器件（缺少原理图 Unique ID）的源码状态在导入前后发生变化');
	for (const want of expected) {
		const fromSource = sourceByIdentity.get(want.identity);
		const component = byIdentity.get(want.identity);
		if (!fromSource || !component) {
			differences.push(`${want.designator} (${want.uniqueId}/${want.channelId}): PCB 缺少器件`);
			continue;
		}
		const designator = value(component, 'getState_Designator');
		const footprint = value(component, 'getState_Footprint');
		const expectedLibraryUuid = libraryFootprints.get(want.footprintUuid);
		const actualFootprintUuid = typeof footprint?.uuid === 'string' ? footprint.uuid : '';
		mismatch(designator === want.designator, `${want.designator}: 位号读回为 ${String(designator)}`, differences);
		mismatch(fromSource.designator === want.designator, `${want.designator}: 有效 COMPONENT/ATTR 源码位号为 ${String(fromSource.designator)}`, differences);
		mismatch(Boolean(expectedLibraryUuid) && actualFootprintUuid === expectedLibraryUuid, `${want.designator}: 封装绑定不一致或无法经工程资源确认`, differences);
		const pads = await api.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(String(value(component, 'getState_PrimitiveId')));
		if (!Array.isArray(pads))
			throw new Error(`${want.designator}: 焊盘列表读回失败`);
		const actualPins = new Map<string, Array<string>>();
		for (const pad of pads) {
			const number = value(pad, 'getState_PadNumber');
			if (typeof number !== 'string' || !number.trim())
				continue; // 额外机械 pad 可无编号。
			const net = value(pad, 'getState_Net');
			actualPins.set(number, [...(actualPins.get(number) ?? []), typeof net === 'string' ? net : '']);
		}
		const expectedPins = new Map<string, string>();
		for (const pin of want.pins) {
			if (expectedPins.has(pin.number) && expectedPins.get(pin.number) !== pin.net)
				differences.push(`${want.designator}.${pin.number}: 同编号网表引脚的网络冲突`);
			expectedPins.set(pin.number, pin.net);
		}
		for (const [number, net] of expectedPins) {
			const physical = actualPins.get(number);
			if (!physical?.length || physical.some(actualNet => actualNet !== net))
				differences.push(`${want.designator}.${number}: 期望网络 ${JSON.stringify(net)}，实际 ${JSON.stringify(physical ?? [])}`);
			const padNetValues = fromSource ? padNets.get(`${fromSource.id}\u0000${number}`) : undefined;
			if (!padNetValues?.length || padNetValues.some(pad => pad.net !== net))
				differences.push(`${want.designator}.${number}: 有效 PAD_NET 源码网络 ${JSON.stringify(padNetValues)} 与期望 ${JSON.stringify(net)} 不符`);
		}
	}
	for (const identity of sourceByIdentity.keys()) {
		if (!expected.some(component => component.identity === identity))
			differences.push(`PCB 源码含原理图托管集合之外的器件 ${identity.replace('\u0000', '/')}`);
	}
	for (const identity of byIdentity.keys()) {
		if (!expected.some(component => component.identity === identity))
			differences.push(`PCB 含原理图托管集合之外的器件 ${identity.replace('\u0000', '/')}`);
	}
	await requireFocus(api, 3, pcbUuid, 'PCB 内容核验结束');
	return { ok: differences.length === 0, managedComponents: expected.length, checkedComponents: byIdentity.size, pcbOnlyPreserved, differences };
}

export async function importAndVerifyChanges(api: ImportApi, params: Record<string, any>): Promise<Record<string, unknown>> {
	const deadline = performance.now() + (Number.isFinite(Number(params._timeoutMs)) && Number(params._timeoutMs) > 0 ? Number(params._timeoutMs) : 290_000);
	api = new Proxy(api, {
		get(target, namespace: string) {
			const service = target[namespace];
			if (!service || typeof service !== 'object')
				return service;
			return new Proxy(service, {
				get(serviceTarget, method: string) {
					const fn = serviceTarget[method];
					if (typeof fn !== 'function')
						return fn;
					return (...args: Array<any>) => {
						const remaining = Math.floor(deadline - performance.now());
						if (remaining <= 0)
							return Promise.reject(new Error(`pcb.importChanges 共享预算已耗尽；${namespace}.${method} 未启动`));
						return awaitWithin(Promise.resolve().then(() => fn.apply(serviceTarget, args)), remaining, `${namespace}.${method}`);
					};
				},
			});
		},
	});
	const beforeFocus = await api.dmt_SelectControl.getCurrentDocumentInfo();
	if (beforeFocus?.documentType !== 3 || typeof beforeFocus.uuid !== 'string' || !beforeFocus.uuid.trim())
		throw new Error('焦点文档不是有效 PCB，已拒绝导入');
	const pcbUuid = beforeFocus.uuid;
	if (params.__docUuid && params.__docUuid !== pcbUuid)
		throw new Error(`导入前焦点 PCB 与请求目标不符（请求=${params.__docUuid}, 当前=${pcbUuid}）`);
	let requested = typeof params.schematicUuid === 'string' && params.schematicUuid.trim() ? params.schematicUuid.trim() : undefined;
	let importRequested = false;
	try {
		const board = await api.dmt_Board.getCurrentBoardInfo();
		if (!board?.pcb?.uuid || board.pcb.uuid !== pcbUuid || !board?.schematic?.uuid)
			throw new Error('当前 PCB 未能通过 Board 关联到同工程原理图');
		if (!requested)
			requested = board.schematic.uuid;
		const schematics = await api.dmt_Schematic.getAllSchematicsInfo();
		const schematic = (schematics ?? []).find((item: any) => item.uuid === requested);
		if (!schematic || schematic.parentProjectUuid !== board.parentProjectUuid)
			throw new Error(`原理图 ${requested} 不属于当前 Board 工程`);
		const pages = await api.dmt_Schematic.getAllSchematicPagesInfo();
		const targetPages = (pages ?? []).filter((page: any) => page.parentSchematicUuid === requested);
		if (!targetPages.length)
			throw new Error(`原理图 ${requested} 没有可导出的图页`);
		const texts: Array<string> = [];
		let expectedFocusType = 3;
		let expectedFocusUuid = pcbUuid;
		for (const page of targetPages) {
			await requireFocus(api, expectedFocusType, expectedFocusUuid, '切换原理图页前');
			const tabId = await api.dmt_EditorControl.openDocument(page.uuid);
			if (typeof tabId !== 'string' || !tabId)
				throw new Error(`无法打开原理图页 ${page.uuid}`);
			await requireFocus(api, 1, page.uuid, '打开原理图页后');
			const activated = await api.dmt_EditorControl.activateDocument(tabId);
			if (activated === false)
				throw new Error(`激活原理图页 ${page.uuid} 失败`);
			await requireFocus(api, 1, page.uuid, '原理图网表导出前');
			const file = await api.sch_ManufactureData.getNetlistFile(undefined, 'JLCEDA');
			await requireFocus(api, 1, page.uuid, '原理图网表导出后');
			if (!file || typeof file.text !== 'function')
				throw new Error(`原理图页 ${page.uuid} 的 JLCEDA 网表导出为空`);
			const text = await file.text();
			if (!text.trim())
				throw new Error(`原理图页 ${page.uuid} 的 JLCEDA 网表为空`);
			texts.push(text);
			expectedFocusType = 1;
			expectedFocusUuid = page.uuid;
		}
		const expected = parseNetlist(texts[0]);
		for (const text of texts.slice(1)) {
			const merged = new Map(expected.map(component => [component.identity, stableJson(component)]));
			for (const component of parseNetlist(text)) {
				const previous = merged.get(component.identity);
				if (previous && previous !== stableJson(component))
					throw new Error(`多页网表身份 ${component.uniqueId}/${component.channelId} 内容冲突`);
				if (!previous)
					expected.push(component);
			}
		}
		await requireFocus(api, expectedFocusType, expectedFocusUuid, '恢復目标 PCB 前');
		const pcbTabId = await api.dmt_EditorControl.openDocument(pcbUuid);
		if (typeof pcbTabId !== 'string' || !pcbTabId)
			throw new Error(`无法打开目标 PCB ${pcbUuid}`);
		await requireFocus(api, 3, pcbUuid, '打开目标 PCB 后');
		const activatedPcb = await api.dmt_EditorControl.activateDocument(pcbTabId);
		if (activatedPcb === false)
			throw new Error(`无法恢复目标 PCB ${pcbUuid}`);
		await requireFocus(api, 3, pcbUuid, '导入前恢复 PCB');
		const preImportSource = await api.sys_FileManager.getDocumentSource();
		if (typeof preImportSource !== 'string' || !preImportSource.trim())
			throw new Error('导入前读取 PCB 源码失败');
		const beforePcbOnly = snapshotPcbOnly(preImportSource);
		await requireFocus(api, 3, pcbUuid, '导入前 PCB 源码快照');
		importRequested = true;
		const sdkResult = await api.pcb_Document.importChanges(requested);
		await requireFocus(api, 3, pcbUuid, '导入后');
		if (sdkResult !== true && sdkResult !== false)
			throw partialError(`pcb.importChanges 返回无效结果（${String(sdkResult)}）；目标 PCB=${pcbUuid}，应用状态未知，不要自动重试`, { documentUuid: pcbUuid, sdkResult: sdkResult === undefined ? 'undefined' : sdkResult, outcome: 'unknown', importRequested: true });
		const contents = await verifyContents(api, pcbUuid, expected, beforePcbOnly);
		if (!contents.ok)
			throw partialError(`导入请求返回 ${String(sdkResult)}，但 PCB 内容核验失败；目标 PCB=${pcbUuid}，不要自动重试`, { documentUuid: pcbUuid, sdkResult, outcome: 'content-mismatch', importRequested: true, verification: contents });
		return { imported: sdkResult === true, sdkResult, outcome: 'contents-verified', importRequested: true, contentsVerified: true, completionVerified: true, verificationScope: ['component identity', 'designator', 'footprint binding', 'pin net'], persistenceVerified: false, documentUuid: pcbUuid, schematicUuid: requested, ...contents };
	}
	catch (error) {
		if ((error as any)?.cause?.partial)
			throw error;
		if (importRequested)
			throw partialError(`PCB 导入已请求，但内容核验或身份读回失败；目标 PCB=${pcbUuid}，不要自动重试`, { documentUuid: pcbUuid, sdkResult: 'unknown', outcome: 'unknown', importRequested: true }, error);
		throw error;
	}
}
