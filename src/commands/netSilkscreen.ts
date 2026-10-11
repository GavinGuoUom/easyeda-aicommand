import type { ICommandDef } from '../engine/types';
import type { GeometryHost } from '../pcb/geometryHost';
import { createGeometryHost } from '../pcb/geometryHost';
import { locateText, stableJson, validateBounds, validateInputs } from '../pcb/netSilkscreen/planning';

interface SilkscreenPlan {
	documentUuid: string;
	operation: 'netSilkscreen';
	units: 'mil';
	inputs: ReturnType<typeof validateInputs>;
	baseline: { source: string; rules: unknown };
	targets: Array<Record<string, unknown>>;
	excludedTargets: Array<Record<string, unknown>>;
	plannedStrings: Array<Record<string, unknown>>;
	executable: boolean;
	warnings: string[];
	provenance: Record<string, unknown>;
}

function state<T = any>(object: any, name: string): T | undefined {
	const getter = object?.[`getState_${name}`];
	return typeof getter === 'function' ? getter.call(object) as T : undefined;
}

async function readArray(host: GeometryHost, api: any, label: string): Promise<any[]> {
	return host.read(label, async () => {
		if (typeof api?.getAll !== 'function')
			throw new Error(`${label} 所需的 SDK getAll() 不存在`);
		const result = await api.getAll();
		if (!Array.isArray(result))
			throw new Error(`${label} 未返回完整数组`);
		return result;
	});
}

interface SelectedPad { id: string; parentComponentId: string | null; pad: any }

async function resolveSelectedPads(host: GeometryHost, targetIds: string[]): Promise<SelectedPad[]> {
	const components = await readArray(host, host.sdk.pcb_PrimitiveComponent, '读取 PCB 器件');
	const componentsById = new Map<string, any>();
	for (const component of components) {
		const id = state<string>(component, 'PrimitiveId');
		if (typeof id !== 'string' || !id)
			throw new Error('PCB 器件列表包含缺少 PrimitiveId 的数据');
		componentsById.set(id, component);
	}
	const padsById = new Map<string, SelectedPad>();
	for (const [componentId, component] of componentsById) {
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
			if (typeof id !== 'string' || !id)
				throw new Error(`器件 ${componentId} 返回了缺少 PrimitiveId 的焊盘`);
			const parent = state<string>(pad, 'ParentComponentPrimitiveId');
			if (parent != null && parent !== componentId)
				throw new Error(`器件 ${componentId} 返回的焊盘 ${id} 归属不符`);
			if (padsById.has(id))
				throw new Error(`多个器件的 getAllPins() 重复返回焊盘 ${id}`);
			padsById.set(id, { id, parentComponentId: componentId, pad });
		}
	}
	const unresolved = targetIds.filter(id => !componentsById.has(id) && !padsById.has(id));
	const standaloneById = new Map<string, SelectedPad>();
	if (unresolved.length) {
		const values = await host.read('按 ID 读取独立焊盘', async () => {
			if (typeof host.sdk.pcb_PrimitivePad?.get !== 'function')
				throw new Error('pcb_PrimitivePad.get() 不存在，无法解析焊盘 ID');
			const result = await host.sdk.pcb_PrimitivePad.get(unresolved);
			if (!Array.isArray(result))
				throw new Error('pcb_PrimitivePad.get(焊盘 ID 数组) 未返回完整数组');
			return result;
		});
		for (const pad of values) {
			const id = state<string>(pad, 'PrimitiveId');
			if (typeof id !== 'string' || !id || !unresolved.includes(id))
				throw new Error('pcb_PrimitivePad.get() 返回缺少 ID 或不在请求中的焊盘');
			standaloneById.set(id, { id, parentComponentId: null, pad });
		}
	}
	const selected: SelectedPad[] = [];
	const seen = new Set<string>();
	for (const id of targetIds) {
		if (componentsById.has(id)) {
			const componentPads = [...padsById.values()].filter(item => item.parentComponentId === id);
			if (!componentPads.length)
				throw new Error(`器件 ${id} 没有可读取的焊盘`);
			for (const item of componentPads) {
				if (!seen.has(item.id)) {
					selected.push(item);
					seen.add(item.id);
				}
			}
		}
		else {
			const item = padsById.get(id) ?? standaloneById.get(id);
			if (!item)
				throw new Error(`targetId ${id} 不是当前 PCB 中可读的焊盘或器件`);
			if (!seen.has(item.id)) {
				selected.push(item);
				seen.add(item.id);
			}
		}
	}
	return selected;
}

async function makePlan(host: GeometryHost, input: ReturnType<typeof validateInputs>, baseline: SilkscreenPlan['baseline']): Promise<SilkscreenPlan> {
	const selected = await resolveSelectedPads(host, input.targetIds);
	const targets: Array<Record<string, unknown>> = [];
	const excludedTargets: Array<Record<string, unknown>> = [];
	const plannedStrings: Array<Record<string, unknown>> = [];
	for (const item of selected) {
		const getNet = item.pad?.getState_Net;
		if (typeof getNet !== 'function')
			throw new Error(`焊盘 ${item.id} 缺少 SDK 声明的 getState_Net()`);
		const net = getNet.call(item.pad) as string | undefined;
		if (net !== undefined && typeof net !== 'string')
			throw new Error(`焊盘 ${item.id} 的网络数据缺失或不是字符串`);
		const padNumber = state<string>(item.pad, 'PadNumber');
		if (net === undefined || net.length === 0) {
			excludedTargets.push({ id: item.id, parentComponentId: item.parentComponentId, padNumber: padNumber ?? null, net: net ?? '', reason: '焊盘没有网络名，跳过，不生成占位文字' });
			continue;
		}
		const bounds = await host.read(`读取焊盘旋转后 bounding box ${item.id}`, async () => {
			const primitiveApi = host.sdk.pcb_Primitive;
			if (typeof primitiveApi?.getPrimitivesBBox !== 'function')
				throw new Error('pcb_Primitive.getPrimitivesBBox() 不存在，不能安全计算相对焊盘位置');
			return validateBounds(await primitiveApi.getPrimitivesBBox([item.id]), item.id);
		});
		const target = { id: item.id, parentComponentId: item.parentComponentId, padNumber: padNumber ?? null, net, bounds };
		targets.push(target);
		const anchor = locateText(bounds, input, item.id);
		plannedStrings.push({
			padId: item.id,
			parentComponentId: item.parentComponentId,
			padNumber: padNumber ?? null,
			net,
			layer: input.layer === 'top-silk' ? 3 : 4,
			x: anchor.x,
			y: anchor.y,
			text: net,
			fontFamily: input.fontFamily,
			fontSize: input.fontSize,
			lineWidth: input.lineWidth,
			alignMode: anchor.alignMode,
			rotation: input.rotation,
			mirror: input.mirror,
		});
	}
	if (input.placements) {
		const expected = new Set(targets.map(item => item.id as string));
		const supplied = new Set(input.placements.map(item => item.padId));
		for (const padId of expected) {
			if (!supplied.has(padId))
				throw new Error(`placements 未覆盖有网络名的焊盘 ${padId}`);
		}
		for (const padId of supplied) {
			if (!expected.has(padId))
				throw new Error(`placements 中的 ${padId} 不是当前解析出的有网络名焊盘`);
		}
	}
	return {
		documentUuid: host.documentUuid,
		operation: 'netSilkscreen',
		units: 'mil',
		inputs: input,
		baseline,
		targets,
		excludedTargets,
		plannedStrings,
		executable: plannedStrings.length > 0,
		warnings: ['未执行全局文字碰撞检测；未估算字符宽度，需在放置后检查丝印与焊盘、阻焊开窗及现有图元间距。'],
		provenance: { repository: 'easyeda/eext-generate-silkscreen', mode: 'native editable PCB strings', sdkTypes: '@jlceda/pro-api-types 0.4.26' },
	};
}

async function getNetSilkscreenPlan(params: Record<string, any>) {
	const input = validateInputs(params);
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

function compareNumber(actual: unknown, expected: number): boolean {
	return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= 0.0001;
}

async function generateNetSilkscreen(params: Record<string, any>) {
	const submitted = params.plan as SilkscreenPlan | undefined;
	if (!submitted || submitted.operation !== 'netSilkscreen' || submitted.units !== 'mil' || !submitted.baseline || !submitted.inputs)
		throw new Error('必须传入由 pcb.getNetSilkscreenPlan 返回的完整 plan');
	if (typeof submitted.documentUuid !== 'string' || !submitted.documentUuid.trim())
		throw new Error('完整 plan 必须含非空 documentUuid，不允许使用当前焦点代替目标文档');
	if (!Array.isArray(submitted.plannedStrings))
		throw new Error('plan.plannedStrings 必须是完整数组');
	const host = await createGeometryHost(eda, params, submitted.documentUuid);
	const created: Array<Record<string, unknown>> = [];
	let activeIndex = -1;
	try {
		await host.assertBaseline(submitted.baseline);
		const input = validateInputs({ ...submitted.inputs, __docUuid: submitted.documentUuid });
		const current = await makePlan(host, input, submitted.baseline);
		for (const key of ['inputs', 'targets', 'excludedTargets', 'plannedStrings', 'executable', 'warnings']) {
			if (stableJson((current as any)[key]) !== stableJson((submitted as any)[key]))
				throw new Error(`plan.${key} 与当前 PCB 重新规划结果不一致，拒绝写入`);
		}
		if (!submitted.executable || !current.executable)
			throw new Error('plan 不可执行：没有可生成丝印的有网络名焊盘');
		await host.assertBaseline(submitted.baseline);
		const strings = await readArray(host, host.sdk.pcb_PrimitiveString, '读取现有 PCB 文字');
		const existingIds = new Set<string>();
		for (const item of strings) {
			const id = state<string>(item, 'PrimitiveId');
			if (typeof id !== 'string' || !id)
				throw new Error('现有 PCB 文字列表包含缺少 PrimitiveId 的数据');
			existingIds.add(id);
		}
		const observedCreatedIds = new Set(existingIds);
		const api = host.sdk.pcb_PrimitiveString;
		if (typeof api?.create !== 'function' || typeof api?.get !== 'function')
			throw new Error('pcb_PrimitiveString.create() 或独立 readback get() 不存在');
		for (let index = 0; index < submitted.plannedStrings.length; index++) {
			activeIndex = index;
			const planned = submitted.plannedStrings[index] as any;
			const attempt = await host.write(`创建网络丝印 ${planned.padId}`, async () => {
				const result = await api.create(
					planned.layer,
					planned.x,
					planned.y,
					planned.text,
					planned.fontFamily,
					planned.fontSize,
					planned.lineWidth,
					planned.alignMode,
					planned.rotation,
					false,
					0,
					planned.mirror,
					false,
				);
				const createdId = state<string>(result, 'PrimitiveId');
				const registeredNewId = Boolean(result && result !== false && typeof createdId === 'string' && createdId && !observedCreatedIds.has(createdId));
				if (registeredNewId) {
					observedCreatedIds.add(createdId!);
					host.recordCreated(createdId!);
				}
				return { result, registeredNewId };
			});
			const object = attempt?.result;
			if (!object || object === false)
				throw new Error(`焊盘 ${planned.padId} 的 pcb_PrimitiveString.create() 返回空值或 false，停止后续写入`);
			const id = state<string>(object, 'PrimitiveId');
			if (typeof id !== 'string' || !id)
				throw new Error(`焊盘 ${planned.padId} 的文字已创建但未返回有效 PrimitiveId，结果未知`);
			if (existingIds.has(id) || attempt.registeredNewId !== true)
				throw new Error(`文字创建返回执行前已存在的 ID ${id}，拒绝将旧对象算作新建结果`);
			const readback = await host.read(`按 ID 独立读回网络丝印 ${id}`, async () => await api.get(id));
			if (!readback)
				throw new Error(`网络丝印 ${id} 按 ID 独立读回为空`);
			const actual = {
				id: state(readback, 'PrimitiveId'),
				layer: state(readback, 'Layer'),
				x: state(readback, 'X'),
				y: state(readback, 'Y'),
				text: state(readback, 'Text'),
				fontFamily: state(readback, 'FontFamily'),
				fontSize: state(readback, 'FontSize'),
				lineWidth: state(readback, 'LineWidth'),
				alignMode: state(readback, 'AlignMode'),
				rotation: state(readback, 'Rotation'),
				reverse: state(readback, 'Reverse'),
				expansion: state(readback, 'Expansion'),
				mirror: state(readback, 'Mirror'),
				primitiveLock: state(readback, 'PrimitiveLock'),
			};
			const matches = actual.id === id
				&& actual.layer === planned.layer
				&& compareNumber(actual.x, planned.x)
				&& compareNumber(actual.y, planned.y)
				&& actual.text === planned.text
				&& actual.fontFamily === planned.fontFamily
				&& compareNumber(actual.fontSize, planned.fontSize)
				&& compareNumber(actual.lineWidth, planned.lineWidth)
				&& actual.alignMode === planned.alignMode
				&& compareNumber(actual.rotation, planned.rotation)
				&& actual.reverse === false
				&& compareNumber(actual.expansion, 0)
				&& actual.mirror === planned.mirror
				&& actual.primitiveLock === false;
			if (!matches)
				throw new Error(`网络丝印 ${id} 独立读回属性与计划不符：${stableJson({ planned, actual })}`);
			host.recordVerified(id);
			created.push({ ...actual, id, padId: planned.padId, net: planned.net });
		}
		await host.finish();
		return { documentUuid: host.documentUuid, operation: 'netSilkscreen', created, verifiedIds: created.map(item => item.id), warnings: current.warnings, saved: false };
	}
	catch (error) {
		const plannedStrings = Array.isArray(submitted.plannedStrings) ? submitted.plannedStrings : [];
		return host.fail(error, { created, unattemptedStrings: plannedStrings.slice(activeIndex < 0 ? 0 : activeIndex + 1).map((item: any) => ({ padId: item?.padId ?? null, net: item?.net ?? null })) });
	}
}

export const netSilkscreenCommands: ICommandDef[] = [
	{
		name: 'pcb.getNetSilkscreenPlan',
		summary: '按 PCB 焊盘网络名规划可编辑的原生丝印文字；可使用焊盘相对位置或显式 padId 坐标，不合并同名网络。',
		params: [
			{ name: 'targetIds', type: 'string[]', required: true, description: 'PCB 焊盘或器件图元 ID；器件会展开为全部关联焊盘，重复目标去重。' },
			{ name: 'layer', type: 'top-silk|bottom-silk', required: true, description: '必须明确指定顶层或底层丝印。' },
			{ name: 'position', type: 'top|bottom|left|right', description: '相对焊盘旋转后 bounding box 的方向；与 offset 配套使用。' },
			{ name: 'offset', type: 'number', description: '相对焊盘边界偏移量，单位 mil，必须大于或等于 0。' },
			{ name: 'placements', type: 'object[]', description: '显式锚点数组：[{padId,x,y,align}]；align 为 left|center|right，覆盖所有有网络名的目标焊盘。' },
			{ name: 'fontSize', type: 'number', description: '原生文字字高，单位 mil，默认 50。' },
			{ name: 'lineWidth', type: 'number', description: '原生文字线宽，单位 mil，默认 8。' },
			{ name: 'fontFamily', type: 'string', description: '原生文字字体，默认 Arial。' },
			{ name: 'rotation', type: 'number', description: '原生文字旋转角度，默认 0。' },
			{ name: 'mirror', type: 'boolean', description: '明确文字镜像状态，默认 false；不会根据底层自动推断。' },
		],
		returns: '只读完整计划：含 inputs、baseline、targets、excludedTargets、plannedStrings、executable、warnings。空网络目标显式排除；未做全局避让。',
		example: { cmd: 'pcb.getNetSilkscreenPlan', params: { targetIds: ['pad-id'], layer: 'top-silk', position: 'right', offset: 20 } },
		handler: getNetSilkscreenPlan,
	},
	{
		name: 'pcb.generateNetSilkscreen',
		summary: '执行完整网络丝印计划；拒绝过期或篡改计划，逐项创建并通过独立 ID 读回核对原生文字属性。',
		params: [{ name: 'plan', type: 'NetSilkscreenPlan', required: true, description: 'pcb.getNetSilkscreenPlan 返回的完整 plan。' }],
		returns: '逐文字返回创建与验证清单；不会保存。遇错停止并在 partial 错误中记录已创建和已验证 ID，不自动回滚或重试。',
		example: { cmd: 'pcb.generateNetSilkscreen', params: { plan: '$step1.data' } },
		handler: generateNetSilkscreen,
	},
];
