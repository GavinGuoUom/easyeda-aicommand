interface Point { x: number; y: number }

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function stableJson(value: unknown): string {
	const sort = (item: any): any => Array.isArray(item)
		? item.map(sort)
		: item && typeof item === 'object'
			? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]))
			: item;
	return JSON.stringify(sort(value)) ?? 'undefined';
}

function singleClosedLineRing(source: unknown): Point[] | undefined {
	let raw = source;
	if (Array.isArray(raw) && Array.isArray(raw[0])) {
		if (raw.length !== 1)
			return undefined;
		raw = raw[0];
	}
	if (!Array.isArray(raw) || raw.length < 9 || raw[2] !== 'L' || (raw.length - 3) % 2 !== 0)
		return undefined;
	const points: Point[] = [{ x: raw[0], y: raw[1] }];
	if (!finite(points[0].x) || !finite(points[0].y))
		return undefined;
	for (let index = 3; index < raw.length; index += 2) {
		const x = raw[index];
		const y = raw[index + 1];
		if (!finite(x) || !finite(y))
			return undefined;
		points.push({ x, y });
	}
	const first = points[0];
	const last = points.at(-1)!;
	if (first.x !== last.x || first.y !== last.y)
		return undefined;
	points.pop();
	const unique: Point[] = [];
	for (const point of points) {
		if (!unique.some(item => item.x === point.x && item.y === point.y))
			unique.push(point);
	}
	return unique.length >= 3 ? points : undefined;
}

function sameRing(first: Point[], second: Point[]): boolean {
	if (first.length !== second.length)
		return false;
	for (let start = 0; start < second.length; start++) {
		if (first[0].x !== second[start].x || first[0].y !== second[start].y)
			continue;
		let forward = true;
		let reverse = true;
		for (let offset = 1; offset < first.length; offset++) {
			const f = second[(start + offset) % second.length];
			const r = second[(start - offset + second.length) % second.length];
			forward &&= first[offset].x === f.x && first[offset].y === f.y;
			reverse &&= first[offset].x === r.x && first[offset].y === r.y;
		}
		if (forward || reverse)
			return true;
	}
	return false;
}

export function comparePolygonSource(plannedSource: unknown, actualSource: unknown): { matches: boolean; mode: string } {
	const plannedRing = singleClosedLineRing(plannedSource);
	const actualRing = singleClosedLineRing(actualSource);
	if (plannedRing && actualRing)
		return { matches: sameRing(plannedRing, actualRing), mode: 'single-ring-cyclic-or-reversed' };
	const matches = stableJson(actualSource) === stableJson(plannedSource);
	return { matches, mode: matches ? 'strict-source' : 'strict-source-mismatch' };
}
