import type { ICommandDef } from '../engine/types';
import type { GeometryHost } from '../pcb/geometryHost';
import { createGeometryHost } from '../pcb/geometryHost';
import { padRing, polygonSourcesEqual, splitAnnulus } from '../pcb/padExpand/geometry';
import { parseSourceLog, resolveRecords } from '../pcb/sourcelog';

type GenerationType = 'noPours' | 'noFills' | 'solderMask';
interface ExpansionPlan {
	documentUuid: string;
	operation: 'padExpansion';
	units: 'mil';
	inputs: { targetIds: string[]; expansion: number; generationType: GenerationType };
	baseline: { source: string; rules: unknown };
	targets: Array<Record<string, unknown>>;
	plannedPrimitives: Array<Record<string, unknown>>;
	executable: boolean;
	warnings: Array<Record<string, unknown>>;
	provenance: Record<string, unknown>;
}

const TOP = 1;
const BOTTOM = 2;
const MULTI = 12;
const TOP_SOLDER_MASK = 5;
const BOTTOM_SOLDER_MASK = 6;
const NO_FILLS = 6;
const NO_POURS = 7;

function state<T = any>(object: any, name: string): T | undefined {
	const getter = object?.[`getState_${name}`];
	return typeof getter === 'function' ? getter.call(object) as T : undefined;
}

function stableJson(value: unknown): string {
	const stable = (item: any): any => Array.isArray(item)
		? item.map(stable)
		: item && typeof item === 'object'
			? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])]))
			: item;
	return JSON.stringify(stable(value));
}

function validate(params: Record<string, any>): ExpansionPlan['inputs'] {
	if (!Array.isArray(params.targetIds) || params.targetIds.length === 0 || params.targetIds.some((id: unknown) => typeof id !== 'string' || !id.trim()))
		throw new Error('targetIds 必须是非空的焊盘或器件图元 ID 数组');
	if (typeof params.expansion !== 'number' || !Number.isFinite(params.expansion) || params.expansion <= 0)
		throw new Error('expansion 必须是大于 0 的有限 mil 数值');
	if (params.generationType !== 'noPours' && params.generationType !== 'noFills' && params.generationType !== 'solderMask')
		throw new Error('generationType 必须是 noPours、noFills 或 solderMask');
	return { targetIds: [...new Set(params.targetIds as string[])], expansion: params.expansion, generationType: params.generationType };
}

async function readArray(host: GeometryHost, api: any, label: string): Promise<any[]> {
	return host.read(label, async () => {
		if (typeof api?.getAll !== 'function')
			throw new Error(`${label} 所需的公开 getAll 不存在`);
		const result = await api.getAll();
		if (!Array.isArray(result))
			throw new Error(`${label} 未返回完整数组`);
		return result;
	});
}

function primitiveIds(objects: any[], label: string): Set<string> {
	return new Set(objects.map((object) => {
		const id = state<string>(object, 'PrimitiveId');
		if (typeof id !== 'string' || id.length === 0)
			throw new Error(`${label}包含缺少有效 PrimitiveId 的对象`);
		return id;
	}));
}

function layerSides(layer: unknown): Array<{ side: 'top' | 'bottom'; regionLayer: number; maskLayer: number }> | undefined {
	if (layer === TOP)
		return [{ side: 'top', regionLayer: TOP, maskLayer: TOP_SOLDER_MASK }];
	if (layer === BOTTOM)
		return [{ side: 'bottom', regionLayer: BOTTOM, maskLayer: BOTTOM_SOLDER_MASK }];
	if (layer === MULTI) {
		return [
			{ side: 'top', regionLayer: TOP, maskLayer: TOP_SOLDER_MASK },
			{ side: 'bottom', regionLayer: BOTTOM, maskLayer: BOTTOM_SOLDER_MASK },
		];
	}
	return undefined;
}

async function collectTargets(host: GeometryHost, targetIds: string[]): Promise<Array<{ id: string; targetType: 'pad' | 'component' | 'unknown'; pad: any }>> {
	const components = await readArray(host, host.sdk.pcb_PrimitiveComponent, '读取 PCB 器件');
	const componentById = new Map<string, any>();
	for (const component of components) {
		const id = state<string>(component, 'PrimitiveId');
		if (id)
			componentById.set(id, component);
	}
	const padsById = new Map<string, any>();
	for (const component of components) {
		const componentId = state<string>(component, 'PrimitiveId');
		if (!componentId)
			continue;
		const pins = await host.read(`读取器件焊盘 ${componentId}`, async () => {
			if (typeof component.getAllPins !== 'function')
				throw new Error(`器件 ${componentId} 缺少 SDK 声明的 getAllPins()`);
			const result = await component.getAllPins();
			if (!Array.isArray(result))
				throw new Error(`器件 ${componentId} 的 getAllPins() 未返回完整数组`);
			return result;
		});
		for (const pad of pins) {
			const id = state<string>(pad, 'PrimitiveId');
			const ownerId = state<string>(pad, 'ParentComponentPrimitiveId');
			if (!id || ownerId !== componentId)
				throw new Error(`器件 ${componentId} 返回了缺少 ID 或归属不符的焊盘`);
			padsById.set(id, pad);
		}
	}
	const standaloneById = new Map<string, any>();
	const unresolvedPadIds = targetIds.filter(id => !componentById.has(id) && !padsById.has(id));
	if (unresolvedPadIds.length) {
		const result = await host.read('按 ID 读取独立焊盘', async () => {
			if (typeof host.sdk.pcb_PrimitivePad?.get !== 'function')
				throw new Error('pcb_PrimitivePad.get 不存在，无法解析焊盘 ID');
			const values = await host.sdk.pcb_PrimitivePad.get(unresolvedPadIds);
			if (!Array.isArray(values))
				throw new Error('pcb_PrimitivePad.get(焊盘 ID 数组) 未返回完整数组');
			return values;
		});
		for (const pad of result) {
			const id = state<string>(pad, 'PrimitiveId');
			if (id)
				standaloneById.set(id, pad);
		}
	}
	const selected: Array<{ id: string; targetType: 'pad' | 'component' | 'unknown'; pad: any }> = [];
	const seenPads = new Set<string>();
	for (const id of targetIds) {
		if (componentById.has(id)) {
			const pads = [...padsById.entries()].filter(([, pad]) => state<string>(pad, 'ParentComponentPrimitiveId') === id);
			if (pads.length === 0)
				selected.push({ id, targetType: 'component', pad: undefined });
			for (const [padId, pad] of pads) {
				if (!seenPads.has(padId)) {
					selected.push({ id: padId, targetType: 'component', pad });
					seenPads.add(padId);
				}
			}
		}
		else {
			const pad = padsById.get(id) ?? standaloneById.get(id);
			if (pad && !seenPads.has(id)) {
				selected.push({ id, targetType: 'pad', pad });
				seenPads.add(id);
			}
			else if (!pad) {
				selected.push({ id, targetType: 'unknown', pad: undefined });
			}
		}
	}
	return selected;
}

async function makePlan(host: GeometryHost, input: ExpansionPlan['inputs'], baseline: ExpansionPlan['baseline']): Promise<ExpansionPlan> {
	const selected = await collectTargets(host, input.targetIds);
	const targets: Array<Record<string, unknown>> = [];
	const plannedPrimitives: Array<Record<string, unknown>> = [];
	const warnings: Array<Record<string, unknown>> = [{ kind: 'boundary-verification', message: '扩大量定义为路径轮廓外扩；0.2mil 线宽对实际禁区/阻焊输出边界的影响仍待宿主导出与覆铜验证。' }];
	for (const item of selected) {
		if (!item.pad) {
			const reason = item.targetType === 'component' ? '器件没有可展开的焊盘' : 'targetId 不是当前 PCB 中可读的焊盘或器件';
			targets.push({ id: item.id, targetType: item.targetType, supported: false, reason });
			warnings.push({ id: item.id, reason });
			continue;
		}
		const layer = state(item.pad, 'Layer');
		const sides = layerSides(layer);
		const specialPad = state<any[]>(item.pad, 'SpecialPad');
		const padNumber = state<string>(item.pad, 'PadNumber') ?? '';
		const ownerId = state<string>(item.pad, 'ParentComponentPrimitiveId') ?? null;
		if (!sides || (Array.isArray(specialPad) && specialPad.length > 0)) {
			const reason = !sides ? `焊盘所在层 ${String(layer)} 没有受支持的顶/底阻焊与电气层映射` : '带按层变化外形的 specialPad 暂不支持';
			targets.push({ id: item.id, targetType: item.targetType, parentComponentId: ownerId, padNumber, layer, supported: false, reason });
			warnings.push({ id: item.id, reason });
			continue;
		}
		const source = padRing(item.pad);
		if (!source.ring) {
			const reason = source.issue ?? '焊盘几何无效';
			targets.push({ id: item.id, targetType: item.targetType, parentComponentId: ownerId, padNumber, layer, supported: false, reason });
			warnings.push({ id: item.id, reason });
			continue;
		}
		targets.push({ id: item.id, targetType: item.targetType, parentComponentId: ownerId, padNumber, layer, net: state(item.pad, 'Net') ?? '', x: state(item.pad, 'X'), y: state(item.pad, 'Y'), rotation: state(item.pad, 'Rotation'), sourceShape: state(item.pad, 'Pad'), supported: true });
		for (const side of sides) {
			let annulusSources: unknown[][];
			let regionPieces: unknown[][][];
			try {
				const expansion = splitAnnulus(source.ring, input.expansion);
				annulusSources = expansion.annulusSources;
				regionPieces = expansion.pieces;
			}
			catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				targets[targets.length - 1].supported = false;
				targets[targets.length - 1].reason = reason;
				warnings.push({ id: item.id, side: side.side, reason });
				continue;
			}
			const output = input.generationType === 'solderMask'
				? { kind: 'fill', layer: side.maskLayer, side: side.side, fillMode: 0, net: '', lineWidth: 0.2 }
				: { kind: 'region', layer: side.regionLayer, side: side.side, ruleType: [input.generationType === 'noPours' ? NO_POURS : NO_FILLS], lineWidth: 0.2 };
			if (output.kind === 'fill') {
				plannedPrimitives.push({ sourcePadId: item.id, parentComponentId: ownerId, padNumber, side: side.side, output, polygonSources: annulusSources, annulusSources });
			}
			else {
				for (const [pieceIndex, polygonSources] of regionPieces.entries())
					plannedPrimitives.push({ sourcePadId: item.id, parentComponentId: ownerId, padNumber, side: side.side, pieceIndex, pieceCount: regionPieces.length, output, polygonSources, annulusSources });
			}
		}
	}
	const executable = targets.length > 0 && targets.every(target => target.supported === true) && plannedPrimitives.length > 0;
	return {
		documentUuid: host.documentUuid,
		operation: 'padExpansion',
		units: 'mil',
		inputs: input,
		baseline,
		targets,
		plannedPrimitives,
		executable,
		warnings,
		provenance: { repository: 'easyeda/eext-pad-expand-helper', commit: 'de5b2eb6bd6817bb25025d621c2f6010bc110cab', license: 'Apache-2.0', geometry: 'source-derived polygon outline + offsetRings + outer-minus-inner ring', sdkTypes: '@jlceda/pro-api-types 0.4.26' },
	};
}

async function getPadExpansionPlan(params: Record<string, any>) {
	const input = validate(params);
	const host = await createGeometryHost(eda, params);
	try {
		const baseline = await host.getBaseline();
		const plan = await makePlan(host, input, baseline);
		await host.finish();
		return plan;
	}
	catch (error) {
		return host.fail(error);
	}
}

function polygonObject(sdk: any, sources: unknown[][], kind: string): any {
	const math = sdk.pcb_MathPolygon;
	if (kind === 'region') {
		if (!Array.isArray(sources) || sources.length !== 1 || !math || typeof math.createPolygon !== 'function')
			throw new Error('区域片必须是单环，且 pcb_MathPolygon.createPolygon 可用');
		const polygon = math.createPolygon(sources[0]);
		if (!polygon)
			throw new Error('planned 区域片无法创建 SDK Polygon');
		return polygon;
	}
	if (!math || typeof math.createComplexPolygon !== 'function')
		throw new Error('pcb_MathPolygon.createComplexPolygon 不存在');
	const polygon = math.createComplexPolygon(sources);
	if (!polygon)
		throw new Error('planned polygonSources 无法创建 SDK Polygon');
	return polygon;
}

function sourceObject(documentSource: string, documentUuid: string, type: string, id: string): Record<string, unknown> {
	const document = parseSourceLog(documentSource);
	if (document.uuid !== documentUuid || document.docType.toUpperCase() !== 'PCB')
		throw new Error(`外扩图元 ${id} 的源码 DOCHEAD 与目标 PCB 不符`);
	const record = resolveRecords(document, type).get(`${type}\u0000${id}`);
	if (!record || record.header.id !== id || record.header.type !== type || !record.data || typeof record.data !== 'object' || Array.isArray(record.data))
		throw new Error(`外扩图元 ${id} 在当前生效源码中缺少 ${type} 记录`);
	return record.data as Record<string, unknown>;
}

async function verifyCurrentSourceOutput(host: GeometryHost, id: string, output: Record<string, any>, polygonSources: unknown[][], sdkNet: unknown): Promise<Record<string, unknown>> {
	const documentSource = await host.read(`读取外扩图元 ${id} 的当前源码`, async () => {
		if (typeof host.sdk.sys_FileManager?.getDocumentSource !== 'function')
			throw new Error('sys_FileManager.getDocumentSource 不存在，无法核验完整图元源码');
		return await host.sdk.sys_FileManager.getDocumentSource();
	});
	if (typeof documentSource !== 'string')
		throw new Error(`外扩图元 ${id} 的 document source 不是字符串`);
	const type = output.kind === 'region' ? 'REGION' : 'FILL';
	const data = sourceObject(documentSource, host.documentUuid, type, id);
	const sdkNetKind = sdkNet === null ? 'null' : typeof sdkNet;
	const actualPath = data.path;
	const pathMatches = polygonSourcesEqual(polygonSources, actualPath);
	const widthMatches = typeof data.width === 'number' && Math.abs(data.width - output.lineWidth) <= 1e-9;
	const layerMatches = data.layerId === output.layer;
	const lockMatches = data.locked === false;
	let netMatches = true;
	let sourceRuleMatches = true;
	if (output.kind === 'fill') {
		const sourceNet = data.netName;
		netMatches = sourceNet === '' && (sdkNet === null || sdkNet === undefined || sdkNet === '');
		sourceRuleMatches = output.fillMode === 0 && data.fillStyle === 'SOLID';
	}
	else {
		const expectedProhibit = stableJson(output.ruleType) === stableJson([NO_POURS]) ? ['COPPER'] : ['FILL'];
		const actualProhibit = Array.isArray(data.prohibitType) ? data.prohibitType : undefined;
		sourceRuleMatches = stableJson(actualProhibit) === stableJson(expectedProhibit) && data.regionType === 'PROHIBIT';
	}
	if (!pathMatches || !widthMatches || !layerMatches || !lockMatches || !netMatches || !sourceRuleMatches) {
		const error = new Error(`外扩图元 ${id} 的当前生效源码 path/layer/width/rule/net/lock 与计划不符`) as Error & { cause?: unknown };
		error.cause = { padExpansionSourceReadback: { id, type, plannedPath: polygonSources, actualPath: actualPath ?? null, pathMatches, plannedLayer: output.layer, actualLayer: data.layerId ?? null, layerMatches, plannedWidth: output.lineWidth, actualWidth: data.width ?? null, widthMatches, plannedRule: output.ruleType ?? output.fillMode, actualRule: output.kind === 'region' ? data.prohibitType ?? null : data.fillStyle ?? null, sourceRuleMatches, sdkNet: sdkNet ?? null, sdkNetKind, actualNet: data.netName ?? null, netMatches, plannedLock: false, actualLock: data.locked ?? null, lockMatches } };
		throw error;
	}
	return { type, pathMatches, layer: data.layerId, width: data.width, rule: data.prohibitType ?? data.fillStyle ?? null, net: data.netName ?? null, sdkNetKind, locked: data.locked };
}

async function createTracked(host: GeometryHost, label: string, existingIds: Set<string>, create: () => Promise<any>) {
	return host.write(label, async () => {
		const object = await create();
		if (object && typeof object === 'object') {
			const id = String(state(object, 'PrimitiveId') ?? '');
			if (id) {
				if (existingIds.has(id))
					throw new Error(`创建操作返回了执行前已存在的 ID ${id}，拒绝将旧对象算作新建结果`);
				existingIds.add(id);
				host.recordCreated(id);
			}
		}
		return object;
	});
}

async function expandPads(params: Record<string, any>) {
	const submitted = params.plan as ExpansionPlan | undefined;
	if (!submitted || submitted.operation !== 'padExpansion' || submitted.units !== 'mil' || !submitted.baseline || !submitted.inputs)
		throw new Error('必须传入由 pcb.getPadExpansionPlan 返回的完整 plan');
	if (typeof submitted.documentUuid !== 'string' || !submitted.documentUuid.trim())
		throw new Error('完整 plan 必须含非空 documentUuid，不允许使用当前焦点代替目标文档');
	if (!Array.isArray(submitted.plannedPrimitives) || !Array.isArray(submitted.targets) || !Array.isArray(submitted.warnings))
		throw new Error('plan 缺少合法的 plannedPrimitives、targets 或 warnings 数组');
	const host = await createGeometryHost(eda, params, submitted.documentUuid);
	const created: Array<Record<string, unknown>> = [];
	let activeIndex = -1;
	let activeStage: Record<string, unknown> | undefined;
	try {
		await host.assertBaseline(submitted.baseline);
		const normalizedInput = validate(submitted.inputs as Record<string, any>);
		if (stableJson(normalizedInput) !== stableJson(submitted.inputs))
			throw new Error('plan.inputs 非法或未规范化，拒绝写入');
		const current = await makePlan(host, normalizedInput, submitted.baseline);
		for (const key of ['inputs', 'targets', 'plannedPrimitives', 'executable', 'warnings']) {
			if (stableJson((current as any)[key]) !== stableJson((submitted as any)[key]))
				throw new Error(`plan.${key} 与当前 PCB 重新规划结果不一致，拒绝写入`);
		}
		if (!submitted.executable || !current.executable)
			throw new Error('plan 不可执行，拒绝写入');
		await host.assertBaseline(submitted.baseline);
		const existingRegionIds = primitiveIds(await readArray(host, eda.pcb_PrimitiveRegion, '读取现有区域 ID'), '现有区域列表');
		const existingFillIds = primitiveIds(await readArray(host, eda.pcb_PrimitiveFill, '读取现有填充 ID'), '现有填充列表');
		for (let index = 0; index < submitted.plannedPrimitives.length; index++) {
			activeIndex = index;
			const planned = submitted.plannedPrimitives[index];
			const output = planned.output as Record<string, any>;
			const polygon = polygonObject(eda, planned.polygonSources as unknown[][], output.kind);
			let object: any;
			if (output.kind === 'region') {
				activeStage = { index, stage: 'create-region-piece', pieceIndex: planned.pieceIndex, sourcePadId: planned.sourcePadId, side: planned.side };
				object = await createTracked(host, `创建外扩禁止区域片 ${index + 1}`, existingRegionIds, async () => {
					if (typeof eda.pcb_PrimitiveRegion?.create !== 'function')
						throw new Error('当前 SDK 缺少 pcb_PrimitiveRegion.create()');
					return await eda.pcb_PrimitiveRegion.create(output.layer, polygon, output.ruleType, undefined, output.lineWidth, false);
				});
			}
			else {
				activeStage = { index, stage: 'create-solder-mask-fill', sourcePadId: planned.sourcePadId, side: planned.side };
				object = await createTracked(host, `创建阻焊外扩图形 ${index + 1}`, existingFillIds, () => eda.pcb_PrimitiveFill.create(output.layer, polygon, '', output.fillMode, output.lineWidth, false));
			}
			if (!object)
				throw new Error(`第 ${index + 1} 个外扩图元创建或配置返回空值`);
			const id = String(state(object, 'PrimitiveId') ?? '');
			if (!id)
				throw new Error(`第 ${index + 1} 个外扩图元已返回对象，但没有 PrimitiveId，结果未知`);
			const api = output.kind === 'region' ? eda.pcb_PrimitiveRegion : eda.pcb_PrimitiveFill;
			activeStage = { index, stage: 'readback-target', pieceIndex: planned.pieceIndex ?? null, sourcePadId: planned.sourcePadId, side: planned.side, outputId: id };
			const readback = await host.read(`按 ID 独立读回外扩图元 ${id}`, async () => await api.get(id));
			if (!readback)
				throw new Error(`外扩图元 ${id} 按 ID 读回为空`);
			const actualPolygon = state<any>(readback, 'ComplexPolygon');
			const actualSource = actualPolygon?.getSource?.();
			const actualLayer = Number(state(readback, 'Layer'));
			const actualId = String(state(readback, 'PrimitiveId') ?? '');
			const geometryMatches = output.kind === 'fill'
				? Array.isArray(planned.polygonSources) && planned.polygonSources.length > 0 && (polygonSourcesEqual(planned.polygonSources, actualSource) || polygonSourcesEqual([planned.polygonSources[0]], actualSource))
				: polygonSourcesEqual(planned.polygonSources, actualSource);
			const actualType = state<string>(readback, 'PrimitiveType');
			const actualLineWidth = state<number>(readback, 'LineWidth');
			const actualLock = state<boolean>(readback, 'PrimitiveLock');
			let regionRuleReadback: unknown;
			let rulesMatch = true;
			if (output.kind === 'region') {
				regionRuleReadback = state(readback, 'RuleType');
				rulesMatch = stableJson(regionRuleReadback) === stableJson(output.ruleType);
			}
			const actualFillMode = output.kind === 'fill' ? state(readback, 'FillMode') : undefined;
			const actualNet = output.kind === 'fill' ? state<string>(readback, 'Net') : undefined;
			const sdkNetKind = actualNet === null ? 'null' : typeof actualNet;
			const modeMatches = output.kind === 'region'
				? actualType === 'Region' && actualLineWidth === output.lineWidth
				: actualType === 'Fill' && actualFillMode === output.fillMode && (actualNet === null || actualNet === '' || actualNet === undefined) && actualLineWidth === output.lineWidth;
			if (actualId !== id || actualLayer !== output.layer || actualLock !== false || !geometryMatches || !rulesMatch || !modeMatches) {
				const error = new Error(`外扩图元 ${id} 的独立读回类型/图层/规则/填充模式/线宽/锁定状态/几何与计划不符`) as Error & { cause?: unknown };
				error.cause = { padExpansionReadback: { requestedId: id, actualId: actualId || null, plannedType: output.kind === 'region' ? 'Region' : 'Fill', actualType: actualType ?? null, plannedLayer: output.layer, actualLayer, plannedRuleType: output.ruleType ?? null, actualRuleType: regionRuleReadback ?? null, plannedFillMode: output.fillMode ?? null, actualFillMode: actualFillMode ?? null, actualNet: actualNet ?? null, sdkNetKind, plannedLineWidth: output.lineWidth, actualLineWidth: actualLineWidth ?? null, plannedLock: false, actualLock: actualLock ?? null, plannedPolygonSources: planned.polygonSources, actualPolygonSource: actualSource ?? null, geometryMatches, rulesMatch, modeMatches } };
				throw error;
			}
			activeStage = { index, stage: 'verify-current-source', pieceIndex: planned.pieceIndex ?? null, sourcePadId: planned.sourcePadId, side: planned.side, outputId: id };
			const sourceReadback = await verifyCurrentSourceOutput(host, id, output, planned.polygonSources as unknown[][], actualNet);
			host.recordVerified(id);
			created.push({ id, sourcePadId: planned.sourcePadId, parentComponentId: planned.parentComponentId, padNumber: planned.padNumber, side: planned.side, pieceIndex: planned.pieceIndex ?? null, kind: output.kind, layer: actualLayer, lineWidth: actualLineWidth, ruleType: regionRuleReadback ?? null, sourceReadback, polygonSources: actualSource });
			activeStage = undefined;
		}
		await host.finish();
		return { documentUuid: host.documentUuid, operation: 'padExpansion', created, verifiedIds: created.map(item => item.id), saved: false };
	}
	catch (error) {
		const firstUnattempted = activeIndex < 0 ? 0 : activeIndex + 1;
		return host.fail(error, { created, activeStage: activeStage ?? null, unattemptedPrimitives: (Array.isArray(submitted.plannedPrimitives) ? submitted.plannedPrimitives : []).slice(firstUnattempted).map((item: any) => ({ sourcePadId: item?.sourcePadId ?? null, side: item?.side ?? null })) });
	}
}

export const padExpansionCommands: ICommandDef[] = [
	{
		name: 'pcb.getPadExpansionPlan',
		summary: '只读生成焊盘外扩计划，目标可为焊盘或器件；检查顶/底层映射并按外环减内环生成阻焊外扩几何。',
		params: [
			{ name: 'targetIds', type: 'string[]', required: true, description: 'PCB 焊盘或器件图元 ID；器件展开为全部关联焊盘，重复目标自动去重。' },
			{ name: 'expansion', type: 'number', required: true, description: '单边外扩量，单位 mil，必须大于 0。' },
			{ name: 'generationType', type: 'noPours|noFills|solderMask', required: true, description: 'noPours 创建禁止覆铜区域；noFills 创建禁止填充区域；solderMask 在对应阻焊层创建填充环形图形。' },
		],
		returns: '含 documentUuid、operation、units、inputs、baseline、targets、plannedPrimitives、executable、warnings、provenance。无写入。',
		example: { cmd: 'pcb.getPadExpansionPlan', params: { targetIds: ['pad-id', 'component-id'], expansion: 5, generationType: 'noPours' } },
		handler: getPadExpansionPlan,
	},
	{
		name: 'pcb.expandPads',
		summary: '执行完整焊盘外扩计划；执行前重新规划并拒绝篡改或过期计划，逐图元按 ID 读回几何、层和区域规则。',
		params: [{ name: 'plan', type: 'PadExpansionPlan', required: true, description: 'pcb.getPadExpansionPlan 返回的完整计划。' }],
		returns: '返回创建和验证的图元清单；失败停止并由 partial 错误记录已创建 ID，不自动回滚、重试或保存。',
		example: { cmd: 'pcb.expandPads', params: { plan: '$step1.data' } },
		handler: expandPads,
	},
];
