export type RelativePosition = 'top' | 'bottom' | 'left' | 'right';
export type TextAlign = 'left' | 'center' | 'right';

export interface SilkscreenInputs {
	targetIds: string[];
	layer: 'top-silk' | 'bottom-silk';
	fontFamily: string;
	fontSize: number;
	lineWidth: number;
	rotation: number;
	mirror: boolean;
	position?: RelativePosition;
	offset?: number;
	placements?: Array<{ padId: string; x: number; y: number; align: TextAlign }>;
}

export interface PadBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function stableJson(value: unknown): string {
	const stable = (item: any): any => Array.isArray(item)
		? item.map(stable)
		: item && typeof item === 'object'
			? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])]))
			: item;
	return JSON.stringify(stable(value));
}

export function validateInputs(params: Record<string, any>): SilkscreenInputs {
	if (!Array.isArray(params.targetIds) || params.targetIds.length === 0 || params.targetIds.some((id: unknown) => typeof id !== 'string' || !id.trim()))
		throw new Error('targetIds 必须是非空的焊盘或器件图元 ID 数组');
	if (params.layer !== 'top-silk' && params.layer !== 'bottom-silk')
		throw new Error('layer 必须明确为 top-silk 或 bottom-silk');
	const fontFamily = params.fontFamily == null ? 'Arial' : params.fontFamily;
	if (typeof fontFamily !== 'string' || fontFamily.length === 0)
		throw new Error('fontFamily 必须是非空字符串');
	const fontSize = params.fontSize == null ? 50 : params.fontSize;
	const lineWidth = params.lineWidth == null ? 8 : params.lineWidth;
	const rotation = params.rotation == null ? 0 : params.rotation;
	if (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize <= 0)
		throw new Error('fontSize 必须是大于 0 的有限 mil 数值');
	if (typeof lineWidth !== 'number' || !Number.isFinite(lineWidth) || lineWidth <= 0)
		throw new Error('lineWidth 必须是大于 0 的有限 mil 数值');
	if (typeof rotation !== 'number' || !Number.isFinite(rotation))
		throw new Error('rotation 必须是有限角度数值');
	if (params.mirror != null && typeof params.mirror !== 'boolean')
		throw new Error('mirror 必须是布尔值；该参数不会根据丝印层自动推断');
	const mirror = params.mirror ?? false;
	const targetIds = [...new Set(params.targetIds as string[])];
	const hasRelative = params.position != null || params.offset != null;
	const hasPlacements = params.placements != null;
	if (hasRelative === hasPlacements)
		throw new Error('必须且只能提供 position+offset，或 placements');
	if (hasRelative) {
		if (!['top', 'bottom', 'left', 'right'].includes(params.position))
			throw new Error('position 必须是 top、bottom、left 或 right');
		if (typeof params.offset !== 'number' || !Number.isFinite(params.offset) || params.offset < 0)
			throw new Error('offset 必须是大于或等于 0 的有限 mil 数值');
		return { targetIds, layer: params.layer, fontFamily, fontSize, lineWidth, rotation, mirror, position: params.position, offset: params.offset };
	}
	if (!Array.isArray(params.placements) || params.placements.length === 0)
		throw new Error('placements 必须是非空数组');
	const seen = new Set<string>();
	const placements = params.placements.map((placement: any, index: number) => {
		if (!placement || typeof placement !== 'object' || Array.isArray(placement) || typeof placement.padId !== 'string' || !placement.padId.trim())
			throw new Error(`placements[${index}].padId 必须是非空字符串`);
		if (seen.has(placement.padId))
			throw new Error(`placements 中 padId ${placement.padId} 重复`);
		seen.add(placement.padId);
		if (typeof placement.x !== 'number' || !Number.isFinite(placement.x) || typeof placement.y !== 'number' || !Number.isFinite(placement.y))
			throw new Error(`placements[${index}] 的 x/y 必须是有限 mil 坐标`);
		if (!['left', 'center', 'right'].includes(placement.align))
			throw new Error(`placements[${index}].align 必须是 left、center 或 right`);
		return { padId: placement.padId, x: placement.x, y: placement.y, align: placement.align };
	});
	return { targetIds, layer: params.layer, fontFamily, fontSize, lineWidth, rotation, mirror, placements };
}

export function validateBounds(value: unknown, padId: string): PadBounds {
	if (!value || typeof value !== 'object')
		throw new Error(`焊盘 ${padId} 的 pcb_Primitive.getPrimitivesBBox 返回空值`);
	const bounds = value as Record<string, unknown>;
	const numbers = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
	if (numbers.some(item => typeof item !== 'number' || !Number.isFinite(item))
		|| Number(bounds.minX) > Number(bounds.maxX) || Number(bounds.minY) > Number(bounds.maxY)) {
		throw new Error(`焊盘 ${padId} 的旋转后 bounding box 数据不完整或无效`);
	}
	return { minX: Number(bounds.minX), minY: Number(bounds.minY), maxX: Number(bounds.maxX), maxY: Number(bounds.maxY) };
}

// SDK 0.4.26 EPCB_PrimitiveStringAlignMode: CENTER_BOTTOM=6, CENTER_TOP=4,
// RIGHT_MIDDLE=8 and LEFT_MIDDLE=2. Positions are text alignment anchors.
const SIDE_ALIGN: Record<RelativePosition, EPCB_PrimitiveStringAlignMode> = {
	top: 6 as EPCB_PrimitiveStringAlignMode,
	bottom: 4 as EPCB_PrimitiveStringAlignMode,
	left: 8 as EPCB_PrimitiveStringAlignMode,
	right: 2 as EPCB_PrimitiveStringAlignMode,
};
const TEXT_ALIGN: Record<TextAlign, EPCB_PrimitiveStringAlignMode> = {
	left: 2 as EPCB_PrimitiveStringAlignMode,
	center: 5 as EPCB_PrimitiveStringAlignMode,
	right: 8 as EPCB_PrimitiveStringAlignMode,
};

export function locateText(bounds: PadBounds, inputs: SilkscreenInputs, padId: string): { x: number; y: number; alignMode: EPCB_PrimitiveStringAlignMode } {
	if (inputs.placements) {
		const placement = inputs.placements.find(item => item.padId === padId);
		if (!placement)
			throw new Error(`placements 未覆盖网络焊盘 ${padId}`);
		return { x: placement.x, y: placement.y, alignMode: TEXT_ALIGN[placement.align] };
	}
	const offset = inputs.offset!;
	switch (inputs.position) {
		case 'top': return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + offset, alignMode: SIDE_ALIGN.top };
		case 'bottom': return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY - offset, alignMode: SIDE_ALIGN.bottom };
		case 'left': return { x: bounds.minX - offset, y: (bounds.minY + bounds.maxY) / 2, alignMode: SIDE_ALIGN.left };
		case 'right': return { x: bounds.maxX + offset, y: (bounds.minY + bounds.maxY) / 2, alignMode: SIDE_ALIGN.right };
		default: throw new Error('缺少有效的相对焊盘位置');
	}
}
