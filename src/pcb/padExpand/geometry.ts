import clipping from '../autoCopper/upstream/polygon-clipping.js';

type Point = [number, number];
type Ring = Point[];

function close(points: Point[]): Ring {
	const ring = points.map(point => [point[0], point[1]] as Point);
	if (ring.length > 0 && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]))
		ring.push([...ring[0]] as Point);
	return ring;
}

function rotateAndTranslate(points: Point[], x: number, y: number, degrees: number): Ring {
	const angle = degrees * Math.PI / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return close(points.map(([px, py]) => [x + px * cos - py * sin, y + px * sin + py * cos]));
}

function ellipsePoints(width: number, height: number, count = 96): Point[] {
	return Array.from({ length: count }, (_, index) => {
		const angle = 2 * Math.PI * index / count;
		return [width / 2 * Math.cos(angle), height / 2 * Math.sin(angle)];
	});
}

function capsulePoints(width: number, height: number): Point[] {
	const radius = Math.min(width, height) / 2;
	const horizontal = width >= height;
	const halfSegment = Math.abs(width - height) / 2;
	const centerA: Point = horizontal ? [-halfSegment, 0] : [0, -halfSegment];
	const centerB: Point = horizontal ? [halfSegment, 0] : [0, halfSegment];
	const points: Point[] = [];
	const count = 48;
	for (let index = 0; index <= count; index++) {
		const angle = (horizontal ? -Math.PI / 2 : 0) + Math.PI * index / count;
		points.push([centerB[0] + radius * Math.cos(angle), centerB[1] + radius * Math.sin(angle)]);
	}
	for (let index = 0; index <= count; index++) {
		const angle = (horizontal ? Math.PI / 2 : Math.PI) + Math.PI * index / count;
		points.push([centerA[0] + radius * Math.cos(angle), centerA[1] + radius * Math.sin(angle)]);
	}
	return points;
}

export function padRing(pad: any): { ring?: Ring; issue?: string } {
	const shape = pad?.getState_Pad?.();
	const x = pad?.getState_X?.();
	const y = pad?.getState_Y?.();
	const rotation = pad?.getState_Rotation?.();
	if (!Array.isArray(shape) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rotation))
		return { issue: '缺少有效焊盘外形、坐标或旋转' };
	const kind = shape[0];
	let points: Point[] | undefined;
	if (kind === 'ELLIPSE' && Number.isFinite(shape[1]) && shape[1] > 0 && Number.isFinite(shape[2]) && shape[2] > 0) {
		points = ellipsePoints(shape[1], shape[2]);
	}
	else if (kind === 'OVAL' && Number.isFinite(shape[1]) && shape[1] > 0 && Number.isFinite(shape[2]) && shape[2] > 0) {
		points = capsulePoints(shape[1], shape[2]);
	}
	else if (kind === 'RECT' && Number.isFinite(shape[1]) && shape[1] > 0 && Number.isFinite(shape[2]) && shape[2] > 0) {
		const width = shape[1];
		const height = shape[2];
		const radius = shape[3];
		if (!Number.isFinite(radius) || radius < 0 || radius > Math.min(width / 2, height / 2))
			return { issue: '矩形焊盘圆角半径超出有效范围' };
		if (radius === 0) {
			points = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
		}
		else {
			points = [];
			for (const [cx, cy, start] of [[width / 2 - radius, -height / 2 + radius, -90], [width / 2 - radius, height / 2 - radius, 0], [-width / 2 + radius, height / 2 - radius, 90], [-width / 2 + radius, -height / 2 + radius, 180]]) {
				for (let step = 0; step <= 8; step++) {
					const angle = (start + step * 90 / 8) * Math.PI / 180;
					points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
				}
			}
		}
	}
	else if (kind === 'NGON') {
		return { issue: 'NGON 焊盘的旋转和顶点朝向无法从公开数据可靠还原，暂不支持' };
	}
	else if (kind === 'POLYGON') {
		return { issue: 'POLYGON 焊盘的局部坐标与板坐标语义无法从公开数据可靠确认，暂不支持' };
	}
	if (!points || points.length < 3)
		return { issue: `焊盘外形 ${String(kind ?? '(缺失)')} 不支持或几何数据无效` };
	return { ring: rotateAndTranslate(points, x, y, rotation) };
}

function polygonSource(ring: Ring): unknown[] {
	const points = close(ring);
	return [points[0][0], points[0][1], 'L', ...points.slice(1).flatMap(point => point)];
}

export function expandedAnnulus(innerRing: Ring, amount: number): unknown[][] {
	const outerRings = clipping.offsetRings([innerRing], amount) as Point[][];
	if (!Array.isArray(outerRings) || outerRings.length === 0)
		throw new Error('焊盘外形外扩后未产生有效轮廓');
	if (outerRings.length !== 1)
		throw new Error(`焊盘外扩产生 ${outerRings.length} 个外轮廓，当前不支持拆分环形结果`);
	const expanded = clipping.difference([[outerRings[0]]], [[innerRing]]) as Point[][][];
	if (!Array.isArray(expanded) || expanded.length === 0)
		throw new Error('焊盘外扩环形差集未产生有效区域');
	const sources: unknown[][] = [];
	for (const polygon of expanded) {
		for (const ring of polygon) {
			if (!Array.isArray(ring) || ring.length < 4)
				throw new Error('焊盘外扩返回了不完整多边形轮廓');
			sources.push(polygonSource(ring));
		}
	}
	return sources;
}

const GEOMETRY_TOLERANCE = 1e-4;

function parseRings(value: unknown): Ring[] | undefined {
	const paths: unknown[][] = [];
	const visit = (part: unknown): void => {
		if (!Array.isArray(part))
			return;
		if (part.some(item => typeof item === 'number')) {
			paths.push(part);
			return;
		}
		for (const item of part)
			visit(item);
	};
	visit(value);
	if (paths.length === 0)
		return undefined;
	const rings: Ring[] = [];
	for (const path of paths) {
		const points: Point[] = [];
		for (let index = 0; index < path.length;) {
			if (typeof path[index] === 'string' && path[index++] !== 'L')
				return undefined;
			const x = path[index++];
			const y = path[index++];
			if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y))
				return undefined;
			points.push([x, y]);
		}
		while (points.length > 1 && distance(points[0], points.at(-1)!) <= GEOMETRY_TOLERANCE)
			points.pop();
		if (points.length < 3)
			return undefined;
		const pruned = pruneCollinear(points);
		if (pruned.length < 3 || Math.abs(signedArea(pruned)) <= 1e-12)
			return undefined;
		rings.push(pruned);
	}
	return rings;
}

function distance(first: Point, second: Point): number {
	return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function signedArea(points: Ring): number {
	return points.reduce((sum, point, index) => {
		const next = points[(index + 1) % points.length];
		return sum + point[0] * next[1] - next[0] * point[1];
	}, 0) / 2;
}

function pruneCollinear(source: Ring): Ring {
	const points = [...source];
	let changed = true;
	while (changed && points.length > 3) {
		changed = false;
		for (let index = 0; index < points.length; index++) {
			const previous = points[(index + points.length - 1) % points.length];
			const current = points[index];
			const next = points[(index + 1) % points.length];
			const first: Point = [current[0] - previous[0], current[1] - previous[1]];
			const second: Point = [next[0] - current[0], next[1] - current[1]];
			const cross = first[0] * second[1] - first[1] * second[0];
			const scale = Math.max(1, Math.hypot(...first) + Math.hypot(...second));
			if (Math.abs(cross) <= GEOMETRY_TOLERANCE * scale && first[0] * second[0] + first[1] * second[1] >= 0) {
				points.splice(index, 1);
				changed = true;
				break;
			}
		}
	}
	return points;
}

function ringMatches(expected: Ring, actual: Ring, reverse: boolean): boolean {
	if (expected.length !== actual.length || Math.sign(signedArea(expected)) !== (reverse ? -1 : 1) * Math.sign(signedArea(actual)))
		return false;
	for (let start = 0; start < actual.length; start++) {
		let match = true;
		for (let index = 0; index < expected.length; index++) {
			const actualIndex = (start + (reverse ? -index : index) + actual.length) % actual.length;
			if (distance(expected[index], actual[actualIndex]) > GEOMETRY_TOLERANCE) {
				match = false;
				break;
			}
		}
		if (match)
			return true;
	}
	return false;
}

function ringsMatch(expected: Ring[], actual: Ring[], reverse: boolean): boolean {
	if (expected.length !== actual.length)
		return false;
	const used = new Set<number>();
	for (const expectedRing of expected) {
		const index = actual.findIndex((actualRing, candidate) => !used.has(candidate) && ringMatches(expectedRing, actualRing, reverse));
		if (index < 0)
			return false;
		used.add(index);
	}
	return true;
}

export function polygonSourcesEqual(expected: unknown, actual: unknown): boolean {
	const expectedRings = parseRings(expected);
	const actualRings = parseRings(actual);
	return Boolean(expectedRings && actualRings && (ringsMatch(expectedRings, actualRings, false) || ringsMatch(expectedRings, actualRings, true)));
}

export function splitAnnulus(innerRing: Ring, amount: number): { annulusSources: unknown[][]; pieces: unknown[][][] } {
	const outerRings = clipping.offsetRings([innerRing], amount) as Point[][];
	if (!Array.isArray(outerRings) || outerRings.length !== 1 || outerRings[0].length < 4)
		throw new Error('焊盘外扩未产生唯一有效外轮廓');
	const outerRing = outerRings[0];
	const annulus = clipping.difference([[outerRing]], [[innerRing]]) as Point[][][];
	if (!Array.isArray(annulus) || annulus.length !== 1 || annulus[0].length !== 2)
		throw new Error('焊盘外扩没有产生唯一双环环形区域');
	const annulusSources = annulus[0].map(ring => polygonSource(ring));
	const bounds = outerRing.reduce((result, point) => ({ minX: Math.min(result.minX, point[0]), maxX: Math.max(result.maxX, point[0]), minY: Math.min(result.minY, point[1]), maxY: Math.max(result.maxY, point[1]) }), { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
	const middleY = (bounds.minY + bounds.maxY) / 2;
	const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, amount) * 4 + 1;
	const minX = bounds.minX - margin;
	const maxX = bounds.maxX + margin;
	const lowerMask: Point[] = [[minX, bounds.minY - margin], [maxX, bounds.minY - margin], [maxX, middleY], [minX, middleY], [minX, bounds.minY - margin]];
	const upperMask: Point[] = [[minX, middleY], [maxX, middleY], [maxX, bounds.maxY + margin], [minX, bounds.maxY + margin], [minX, middleY]];
	const lower = clipping.difference(annulus, [[upperMask]]) as Point[][][];
	const upper = clipping.difference(annulus, [[lowerMask]]) as Point[][][];
	const pieces: unknown[][][] = [];
	for (const result of [lower, upper]) {
		if (!Array.isArray(result) || result.length !== 1 || result[0].length !== 1 || result[0][0].length < 4)
			throw new Error('焊盘环形区域切分后未得到两个无孔连通片');
		const source = polygonSource(result[0][0]);
		if (!polygonSourcesEqual([source], [source]))
			throw new Error('焊盘环形切片退化');
		pieces.push([source]);
	}
	if (pieces.length !== 2)
		throw new Error('焊盘环形区域没有分成两个切片');
	const combined = clipping.union(lower, upper) as Point[][][];
	const combinedSources = combined.flatMap(polygon => polygon.map(ring => polygonSource(ring)));
	if (!polygonSourcesEqual(annulusSources, combinedSources))
		throw new Error('焊盘环形切片的并集与原环形不一致');
	return { annulusSources, pieces };
}
