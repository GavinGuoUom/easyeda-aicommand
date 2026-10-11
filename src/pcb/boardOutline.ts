export interface BoardOutlinePolylineResult {
	lines: any[];
	summaries: Array<{ id: string | null; source: unknown; lineCount: number }>;
	issues: string[];
}

function state<T = any>(object: any, name: string): T | undefined {
	const getter = object?.[`getState_${name}`];
	if (typeof getter !== 'function')
		return undefined;
	return getter.call(object) as T;
}

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeBoardOutlinePolylines(polylines: any[], boardLayer = 11): BoardOutlinePolylineResult {
	const lines: any[] = [];
	const summaries: BoardOutlinePolylineResult['summaries'] = [];
	const issues: string[] = [];
	const boardPolylines: any[] = [];
	for (const polyline of polylines) {
		const id = state<string>(polyline, 'PrimitiveId');
		const layer = state<number>(polyline, 'Layer');
		if (!finite(layer)) {
			issues.push(`折线图元 ${id ?? '(无 ID)'} 缺少有效图层`);
			continue;
		}
		if (layer === boardLayer)
			boardPolylines.push(polyline);
	}
	for (const polyline of boardPolylines) {
		const idValue = state<any>(polyline, 'PrimitiveId');
		const id = typeof idValue === 'string' ? idValue : null;
		const polygon = state<any>(polyline, 'Polygon');
		const source = typeof polygon?.getSource === 'function' ? polygon.getSource() : undefined;
		const summary = { id, source: source ?? null, lineCount: 0 };
		summaries.push(summary);
		const width = state<number>(polyline, 'LineWidth');
		if (!id?.trim() || !finite(width) || width <= 0) {
			issues.push(`板框折线 ${id ?? '(无 ID)'} 缺少有效 ID 或线宽`);
			continue;
		}
		if (!Array.isArray(source) || source.length !== 7 || source[0] !== 'R') {
			issues.push(`板框折线 ${id} 不是受支持的零旋转直角矩形`);
			continue;
		}
		const [, x, y, widthMil, heightMil, rotation, radius] = source;
		if (![x, y, widthMil, heightMil, rotation, radius].every(finite) || widthMil <= 0 || heightMil <= 0 || rotation !== 0 || radius !== 0) {
			issues.push(`板框折线 ${id} 的矩形坐标、尺寸、旋转或圆角无效`);
			continue;
		}
		const points = [
			{ x, y },
			{ x: x + widthMil, y },
			{ x: x + widthMil, y: y - heightMil },
			{ x, y: y - heightMil },
		];
		if (points.some(point => !finite(point.x) || !finite(point.y))
			|| points[1].x <= points[0].x || points[3].y >= points[0].y) {
			issues.push(`板框折线 ${id} 的矩形角点溢出或尺寸退化`);
			continue;
		}
		for (let index = 0; index < points.length; index++) {
			const start = points[index];
			const end = points[(index + 1) % points.length];
			lines.push({
				getState_PrimitiveId: () => id,
				getState_Layer: () => boardLayer,
				getState_StartX: () => start.x,
				getState_StartY: () => start.y,
				getState_EndX: () => end.x,
				getState_EndY: () => end.y,
				getState_LineWidth: () => width,
				getState_ArcAngle: () => 0,
			});
		}
		summary.lineCount = 4;
	}
	return { lines: issues.length ? [] : lines, summaries, issues };
}
