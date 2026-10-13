import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';

const ROOT = resolve(import.meta.dirname, '..');
const bundle = 'test/.component-update-regression-bundle.mjs';
const focus = { documentType: 1, uuid: 'page-1', parentProjectUuid: 'project-1' };
function cloneFixtureData(value) {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
async function withoutStructuredClone(fn) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
	try {
		Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
		return await fn();
	}
	finally {
		if (descriptor)
			Object.defineProperty(globalThis, 'structuredClone', descriptor);
		else
			delete globalThis.structuredClone;
	}
}
function footprintSource(uuid, source) {
	return [
		JSON.stringify(['DOCTYPE', 'FOOTPRINT', '1.8']),
		JSON.stringify(['HEAD', { uuid, source }]),
		JSON.stringify(['PAD', 'pad-1', 0, '', 1, '1', 0, 0, 0]),
		JSON.stringify(['PAD', 'pad-2', 0, '', 1, '2', 0, 0, 0]),
	].join('\n');
}
function footprintLog(uuid, source) {
	const rows = [
		{ type: 'DOCHEAD', data: { docType: 'FOOTPRINT', uuid, source } },
		{ type: 'PAD', id: 'pad-1', ticket: 1, data: { num: '1', centerX: -10, centerY: 0, width: 20, height: 20 } },
		{ type: 'PAD', id: 'pad-2', ticket: 2, data: { num: '2', centerX: 10, centerY: 0, width: 20, height: 20 } },
	];
	return rows.map(row => `${JSON.stringify({ type: row.type, ...(row.id ? { id: row.id } : {}), ...(row.ticket ? { ticket: row.ticket } : {}) })}||${JSON.stringify(row.data)}`).join('|\n');
}
function mutateFootprintSource(source, type, id, mutate) {
	let changed = false;
	return source.split(/\r?\n/u).map(line => {
		const separator = line.indexOf('||');
		if (separator < 0) return line;
		const header = JSON.parse(line.slice(0, separator));
		if (changed || header.type !== type || header.id !== id) return line;
		const dataText = line.slice(separator + 2);
		const data = JSON.parse(dataText.endsWith('|') ? dataText.slice(0, -1) : dataText);
		mutate(data);
		changed = true;
		return `${line.slice(0, separator)}||${JSON.stringify(data)}${dataText.endsWith('|') ? '|' : ''}`;
	}).join('\n');
}
function appendFootprintRecord(source, header, data) {
	return `${source}${source.endsWith('\n') ? '' : '\n'}${JSON.stringify(header)}||${JSON.stringify(data)}|`;
}
function appendComponentFootprintName(source, primitiveId, metadata) {
	let latest;
	let maxTicket = 0;
	for (const line of source.split(/\r?\n/u)) {
		const separator = line.indexOf('||');
		if (separator < 0) continue;
		const header = JSON.parse(line.slice(0, separator));
		maxTicket = Math.max(maxTicket, Number(header.ticket ?? 0));
		if (header.type !== 'COMPONENT' || header.id !== primitiveId) continue;
		const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
		if (!latest || Number(header.ticket ?? 0) >= Number(latest.header.ticket ?? 0))
			latest = { header, data };
	}
	assert.ok(latest, `component ${primitiveId} exists`);
	latest.data.attrs.FootprintName = metadata;
	return appendFootprintRecord(source, { ...latest.header, ticket: maxTicket + 1 }, latest.data);
}
function appendConflictingFootprintDocHead(source) {
	const first = source.split(/\r?\n/u).find(line => line.trim());
	const separator = first.indexOf('||');
	const data = JSON.parse(first.slice(separator + 2).replace(/\|$/u, ''));
	data.uuid = 'conflicting-footprint-uuid';
	return `${source}\n${JSON.stringify({ type: 'DOCHEAD', ticket: 99999 })}||${JSON.stringify(data)}|`;
}
function decorateFootprintDocHead(source) {
	const lines = source.split(/\r?\n/u);
	const first = lines[0];
	const separator = first.indexOf('||');
	const header = JSON.parse(first.slice(0, separator));
	const reordered = { ...(header.ticket === undefined ? {} : { ticket: header.ticket }), type: header.type };
	lines[0] = ` \t${JSON.stringify(reordered)}${first.slice(separator)}`;
	return `\n${lines.join('\n')}`;
}
function sourceLog(footprintValue = null, includeFootprint = true, secondComponent = false) {
	const rows = [
		{ type: 'DOCHEAD', data: { docType: 'SCH_PAGE', uuid: focus.uuid, client: 'test', revision: 1 } },
		{ type: 'COMPONENT', id: 'c1', ticket: 1, data: { x: 10, y: 20, symbol: 'symbol-1', uniqueId: 'uid-1', attrs: { FootprintName: null } } },
		...(secondComponent ? [{ type: 'COMPONENT', id: 'c2', ticket: 2, data: { x: 30, y: 40, symbol: 'symbol-2', uniqueId: 'uid-2', attrs: { FootprintName: null } } }] : []),
		...(includeFootprint ? [{ type: 'ATTR', id: 'a1', ticket: secondComponent ? 3 : 2, data: { parentId: 'c1', key: 'Footprint', value: footprintValue } }] : []),
		...(secondComponent ? [{ type: 'ATTR', id: 'a2', ticket: 4, data: { parentId: 'c2', key: 'Footprint', value: null } }] : []),
		{ type: 'WIRE', id: 'w1', ticket: secondComponent ? 5 : 3, data: { points: [1, 2, 3, 4] } },
	];
	return rows.map(row => `${JSON.stringify({ type: row.type, ...(row.id ? { id: row.id } : {}), ...(row.ticket ? { ticket: row.ticket } : {}) })}||${JSON.stringify(row.data)}`).join('|\n');
}
function fixture(options = {}) {
	let currentSource = sourceLog(options.footprintSourceValue ?? null, !options.skipFootprint, options.secondComponent);
	let focusNow = focus;
	const component = {
		footprint: { uuid: options.initialEffectiveFootprintUuid ?? 'old-footprint' },
		props: { x: 10, y: 20, rotation: 0, mirror: false, addIntoBom: true, addIntoPcb: true, designator: 'R1', name: '10k', uniqueId: 'uid-1', manufacturer: 'Acme', manufacturerId: 'A-1', supplier: 'Shop', supplierId: 'S-1', otherProperty: { 'Custom': 'keep', ...(options.footprintAlias ? { Footprint: 'legacy-footprint' } : {}), 'Manufacturer': 'Acme', 'Manufacturer Part': 'A-1', 'Supplier': 'Shop', 'Supplier Part': 'S-1', 'Name': '10k', 'Designator': 'R1', 'Add into BOM': 'yes', 'Convert to PCB': 'yes' } },
	};
	if (options.skipFootprint)
		delete component.props.otherProperty.Footprint;
	const second = cloneFixtureData(component);
	second.props.designator = 'R2';
	second.props.otherProperty.Designator = 'R2';
	second.props.uniqueId = 'uid-2';
	second.props.name = '22k';
	second.props.otherProperty.Name = '22k';
	second.props.x = 30;
	second.props.y = 40;
	const components = { c1: component, c2: second };
	let writeCalls = 0;
	let attributeWriteCalls = 0;
	let copyCalls = 0;
	let lastDeviceAssociation = null;
	const deviceSearchCalls = [];
	const componentObject = (id) => {
		const item = components[id];
		const o = { getState_Footprint: () => item.footprint, getState_Symbol: () => ({ uuid: 'symbol-1', libraryUuid: 'symbol-library' }) };
		const getters = { X: 'x', Y: 'y', Rotation: 'rotation', Mirror: 'mirror', AddIntoBom: 'addIntoBom', AddIntoPcb: 'addIntoPcb', Designator: 'designator', Name: 'name', UniqueId: 'uniqueId', Manufacturer: 'manufacturer', ManufacturerId: 'manufacturerId', Supplier: 'supplier', SupplierId: 'supplierId', OtherProperty: 'otherProperty' };
		for (const [suffix, field] of Object.entries(getters)) o[`getState_${suffix}`] = () => item.props[field];
		return o;
	};
	const projectUuid = options.projectFootprintUuid ?? 'project-footprint';
	const projectFootprint = (uuid = projectUuid) => footprintSource(uuid, 'target-footprint|source-library');
	const makeHelperDevice = (uuid, name, libraryUuid, association) => ({ uuid, name, libraryUuid, symbolUuid: association.symbol?.uuid ?? 'generated-symbol', footprintUuid: projectUuid, symbolName: '10K', footprintName: 'R0805', otherProperty: {} });
	let helperDevice = options.existingCopy ? makeHelperDevice('existing-helper', 'ACE_FP_source-library_target-footprint', 'project-library', { symbol: { uuid: 'symbol-1', libraryUuid: 'symbol-library' } }) : null;
	const api = {
		dmt_SelectControl: { getCurrentDocumentInfo: async () => focusNow },
		sys_FileManager: {
			getDocumentSource: async () => currentSource,
			setDocumentSource: async (value) => {
				writeCalls++;
				if (options.failFootprintNameWrite)
					throw new Error('FootprintName write interrupted');
				if (options.failSourceWrite)
					throw new Error('write interrupted');
				if (options.failSourceRestore)
					throw new Error('restore interrupted');
				currentSource = value;
				if (options.normalizeAfterSourceRestore) {
					currentSource = currentSource.split(/\r?\n/u).map(line => {
						const separator = line.indexOf('||');
						if (separator < 0) return line;
						const header = JSON.parse(line.slice(0, separator));
						const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
						if (header.type === 'COMPONENT' && header.id === 'c1' && data.attrs?.DeviceName === null)
							data.attrs.DeviceName = JSON.stringify({ name: '0603WAF1002T5E', source: '', uuid: '301d70968a4ea233' });
						if (header.type === 'ATTR' && data.parentId === 'c1' && data.key === 'Unique ID' && data.zIndex == null)
							data.zIndex = -6;
						return `${line.slice(0, separator)}||${JSON.stringify(data)}${line.endsWith('|') ? '|' : ''}`;
					}).join('\n');
				}
				if (options.footprintNameReadbackTransform)
					currentSource = options.footprintNameReadbackTransform(currentSource);
				const line = value.split(/\r?\n/).map((line) => {
					try {
						const separator = line.indexOf('||');
						return separator >= 0 && JSON.parse(line.slice(0, separator)).type === 'ATTR' ? JSON.parse(line.slice(separator + 2).replace(/\|$/u, '')) : null;
					}
					catch {
						return null;
					}
				});
				for (const row of line) {
					if (row?.key === 'Footprint' && typeof row.value === 'string' && row.value && components[row.parentId]) {
						components[row.parentId].footprint = { uuid: row.value };
						components[row.parentId].props.otherProperty.Footprint = row.value;
					}
					if (options.inconsistentRequestedAfterRestore && row?.key === 'ModuleRole' && components[row.parentId])
						components[row.parentId].props.otherProperty.ModuleRole = 'getter-mismatch';
				}
				return true;
			},
			getProjectFile: async () => {
				const zip = new JSZip();
				zip.file('project.json', JSON.stringify({ symbols: options.noSymbolMapping ? {} : { 'symbol-1': { uuid: 'symbol-1', source: 'symbol-source|symbol-library' } }, devices: { '301d70968a4ea233': { uuid: '301d70968a4ea233', title: '0603WAF1002T5E', source: 'opaque-device-source' } } }));
				if (!options.missingResource)
					zip.file(`FOOTPRINT/${projectUuid}.efoo`, options.projectFootprintSource ?? projectFootprint());
				const bytes = await zip.generateAsync({ type: 'uint8array' });
				return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
			},
		},
		sch_PrimitiveComponent: {
			get: async id => components[id] ? componentObject(id) : null,
			modify: async (_id, properties) => {
				const previous = components[_id].props;
				components[_id].props = cloneFixtureData(properties);
				if (options.freshHostDefaults) {
					currentSource = options.freshHostDefaults;
					return true;
				}
				const aliases = { addIntoBom: 'Add into BOM', addIntoPcb: 'Convert to PCB', designator: 'Designator', name: 'Name', manufacturer: 'Manufacturer', manufacturerId: 'Manufacturer Part', supplier: 'Supplier', supplierId: 'Supplier Part' };
				const entries = Object.entries(aliases).map(([field, key]) => [key, properties[field] === true ? 'yes' : properties[field] === false ? 'no' : properties[field]]);
				for (const [key, value] of Object.entries(properties.otherProperty)) {
					if (!Object.values(aliases).includes(key))
						entries.push([key, value]);
				}
				let maxTicket = Math.max(0, ...currentSource.split(/\r?\n/u).map((line) => {
					try {
						return Number(JSON.parse(line.slice(0, line.indexOf('||'))).ticket ?? 0);
					}
					catch {
						return 0;
					}
				}));
				const changed = entries.filter(([key, value]) => {
					const field = Object.entries(aliases).find(([, alias]) => alias === key)?.[0];
					const oldValue = field ? (field.startsWith('addInto') ? (previous[field] ? 'yes' : 'no') : previous[field]) : previous.otherProperty[key];
					return !Object.is(oldValue, value);
				});
				const lines = changed.map(([key, value]) => {
					maxTicket++;
					const id = `attr-${_id}-${key}`;
					return `${JSON.stringify({ type: 'ATTR', id, ticket: maxTicket })}||${JSON.stringify({ parentId: _id, key, value })}|`;
				});
				if (lines.length)
					currentSource += `\n${lines.join('\n')}`;
				if (options.rewriteExistingName) {
					currentSource = currentSource.split(/\r?\n/u).map((line) => {
						const separator = line.indexOf('||');
						if (separator < 0)
							return line;
						const header = JSON.parse(line.slice(0, separator));
						const body = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
						if (header.type !== 'ATTR' || body.parentId !== _id || body.key !== 'Name')
							return line;
						body.value = 'SDK explicit value';
						return `${JSON.stringify(header)}||${JSON.stringify(body)}${line.endsWith('|') ? '|' : ''}`;
					}).join('\n');
				}
				if (options.injectAttributeDefaults && Object.hasOwn(properties.otherProperty, 'ModuleRole')) {
					const newAttributes = [];
					for (const [key, value] of [['Designator', previous.designator], ['Name', options.nameAttrValue ?? '={Value}']]) {
						maxTicket++;
						const id = `attr-${_id}-${key}`;
						const existing = currentSource.split(/\r?\n/u).map((line) => {
							try {
								const split = line.indexOf('||');
								return split >= 0 && JSON.parse(line.slice(0, split)).id === id ? JSON.parse(line.slice(split + 2).replace(/\|$/u, '')) : null;
							}
							catch {
								return null;
							}
						}).find(Boolean) ?? { x: null, y: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, keyVisible: null, valueVisible: true, key, fillColor: null, parentId: _id, zIndex: key === 'Designator' ? 5 : 11 };
						newAttributes.push(`${JSON.stringify({ type: 'ATTR', id, ticket: maxTicket })}||${JSON.stringify({ ...existing, rotation: 0, value })}|`);
					}
					currentSource += `\n${newAttributes.join('\n')}`;
				}
				if (options.injectPcbLayerDefault && Object.hasOwn(properties.otherProperty, 'ModuleRole')) {
					maxTicket++;
					const layer = { x: null, y: null, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value: options.pcbLayerValue ?? 'Default', keyVisible: null, valueVisible: null, key: 'PCB Layer', fillColor: null, parentId: _id, zIndex: 8 };
					currentSource += `\n${JSON.stringify({ type: 'ATTR', id: `attr-${_id}-PCB-Layer`, ticket: maxTicket })}||${JSON.stringify(layer)}|`;
				}
				if (options.modifySourceTransform)
					currentSource = options.modifySourceTransform(currentSource);
				return true;
			},
		},
		lib_LibrariesList: { getProjectLibraryUuid: async () => 'project-library' },
		lib_Footprint: {
			get: async (uuid, libraryUuid) => ({ uuid, libraryUuid, name: uuid === 'target-footprint' ? 'Target Footprint' : Object.hasOwn(options, 'projectFootprintName') ? options.projectFootprintName : `ACE_FP_${uuid}` }),
		getDocumentSource: async (uuid, libraryUuid) => options.footprintSources?.[uuid] ?? footprintLog(uuid, uuid === 'target-footprint' ? 'library-source' : 'target-footprint|source-library'),
			search: async () => [],
			copy: async () => {
				copyCalls++;
				return projectUuid;
			},
		},
		lib_Device: {
			create: async (libraryUuid, name, _classification, association) => {
				copyCalls++;
				lastDeviceAssociation = association;
				if (options.createThrowsNoWrite)
					throw new Error('device create failed before write');
				const actualSymbol = association.symbol ?? { uuid: 'generated-symbol', libraryUuid: 'project-library' };
				helperDevice = makeHelperDevice(options.createUuid ?? 'helper-device', name, libraryUuid, { symbol: actualSymbol });
				if (options.createThrows)
					throw new Error('device create response lost');
				return helperDevice.uuid;
			},
			get: async (uuid) => options.deviceGetThrows ? Promise.reject(new Error('device get unavailable')) : helperDevice?.uuid === uuid ? helperDevice : null,
			search: async (...args) => {
				deviceSearchCalls.push(args);
				if (deviceSearchCalls.length === options.throwDeviceSearchCall)
					throw new Error('device name search failed after create');
				return helperDevice && helperDevice.name === args[0] ? [helperDevice] : [];
			},
		},
		sch_PrimitiveAttribute: {
			getAllPrimitiveId: async (parentId) => effectiveAttribute(currentSource, parentId, 'Footprint').map(row => row.header.id),
			get: async (ids) => {
				const create = id => {
					const row = currentSource.split(/\r?\n/u).map(line => {
						const separator = line.indexOf('||');
						if (separator < 0 || JSON.parse(line.slice(0, separator)).id !== id)
							return null;
						return JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
					}).find(Boolean);
				return { getState_PrimitiveId: () => options.sdkFootprintAttrId ?? id, getState_Key: () => row?.key, getState_Value: () => row?.key === 'Footprint' ? options.sdkFootprintValue ?? row.value ?? components[row.parentId]?.footprint?.uuid ?? null : row?.value ?? null };
				};
				return Array.isArray(ids) ? ids.map(create) : create(ids);
			},
			modify: async (id, properties) => {
				attributeWriteCalls++;
				if (options.failAttributeWrite)
					throw new Error('attribute write interrupted');
				if (options.failAttributeWrite)
					throw new Error('attribute write interrupted');
				currentSource = currentSource.split(/\r?\n/u).map(line => {
					const separator = line.indexOf('||');
					if (separator < 0 || JSON.parse(line.slice(0, separator)).id !== id)
						return line;
					const body = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
					body.value = properties.value;
					return `${line.slice(0, separator)}||${JSON.stringify(body)}${line.endsWith('|') ? '|' : ''}`;
				}).join('\n');
				const targetData = currentSource.split(/\r?\n/u).map(line => {
					const separator = line.indexOf('||');
					return separator >= 0 && JSON.parse(line.slice(0, separator)).id === id ? JSON.parse(line.slice(separator + 2).replace(/\|$/u, '')) : null;
				}).find(Boolean);
				const parentId = targetData?.parentId ?? 'c1';
				currentSource = currentSource.split(/\r?\n/u).map(line => {
					const separator = line.indexOf('||');
					if (separator < 0)
						return line;
					const header = JSON.parse(line.slice(0, separator));
					if (header.type !== 'COMPONENT' || header.id !== parentId)
						return line;
					const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
					const footprintMetadata = typeof options.footprintNameMetadata === 'function' ? options.footprintNameMetadata(properties.value) : options.footprintNameMetadata ?? { uuid: properties.value };
					data.attrs.FootprintName = typeof footprintMetadata === 'string' ? footprintMetadata : JSON.stringify(footprintMetadata);
					return `${line.slice(0, separator)}||${JSON.stringify(data)}${line.endsWith('|') ? '|' : ''}`;
				}).join('\n');
				const updated = components[parentId];
				updated.footprint = { uuid: properties.value };
				updated.props.otherProperty.Footprint = properties.value;
				return true;
			},
		},
	};
	return {
		api,
		focusChange: (value) => { focusNow = value; },
		sourceChange: (value) => { currentSource = value; },
		setDesignator: (value) => { component.props.designator = value; component.props.otherProperty.Designator = value; },
		get writes() { return writeCalls; },
		get attributeWrites() { return attributeWriteCalls; },
		get copies() { return copyCalls; },
		get deviceSearchCalls() { return deviceSearchCalls; },
		get deviceAssociation() { return lastDeviceAssociation; },
		get helperDevice() { return helperDevice; },
		get source() { return currentSource; },
		get component() { return component; },
		get second() { return second; },
	};
}

function effectiveAttribute(source, parentId, key) {
	const entries = new Map();
	for (const line of source.split(/\r?\n/u).filter(Boolean)) {
		const separator = line.indexOf('||');
		const header = JSON.parse(line.slice(0, separator));
		if (header.type !== 'ATTR')
			continue;
		const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
		const recordKey = `${header.type}\0${header.id}`;
		const previous = entries.get(recordKey);
		if (!previous || Number(header.ticket ?? 0) >= Number(previous.header.ticket ?? 0)) {
			if (data === '' && previous?.data.parentId === parentId && previous.data.key === key)
				entries.delete(recordKey);
			else if (data !== '' && data.parentId === parentId && data.key === key)
				entries.set(recordKey, { header, data });
		}
	}
	return [...entries.values()];
}

function effectiveComponent(source, primitiveId) {
	let selected;
	for (const line of source.split(/\r?\n/u).filter(Boolean)) {
		const separator = line.indexOf('||');
		if (separator < 0) continue;
		const header = JSON.parse(line.slice(0, separator));
		if (header.type !== 'COMPONENT' || header.id !== primitiveId) continue;
		const row = { header, data: JSON.parse(line.slice(separator + 2).replace(/\|$/u, '')) };
		if (!selected || Number(header.ticket ?? 0) >= Number(selected.header.ticket ?? 0))
			selected = row;
	}
	return selected;
}

async function main() {
	try {
		const realLibraryFootprint = await readFile(resolve(ROOT, 'test/fixtures/component-update-library-footprint.sourcelog'), 'utf8');
		const realAfterPropertiesSource = await readFile(resolve(ROOT, 'test/fixtures/component-update-after-properties-62.sourcelog'), 'utf8');
		const real0402ProjectSource = await readFile(resolve(ROOT, 'test/fixtures/footprint-220-project0402.sourcelog'), 'utf8');
		const real0402Source = await readFile(resolve(ROOT, 'test/fixtures/footprint-221-source0402.sourcelog'), 'utf8');
		const real0402ProjectWithHeaderVariants = decorateFootprintDocHead(real0402ProjectSource);
		const real0402SourceWithHeaderVariants = decorateFootprintDocHead(real0402Source);
		const freshBefore = (await readFile(resolve(ROOT, 'test/fixtures/component-update-fresh-before.sourcelog'), 'utf8')).replaceAll('e1b85596175705fd', 'c1');
		const freshAfter = (await readFile(resolve(ROOT, 'test/fixtures/component-update-fresh-after.sourcelog'), 'utf8')).replaceAll('e1b85596175705fd', 'c1');
		await build({ stdin: { contents: `import { getComponentUpdatePlan, updateComponents } from '../src/engine/componentUpdate.ts'; import { componentUpdateCommands } from '../src/commands/componentUpdate.ts'; export { getComponentUpdatePlan, updateComponents, componentUpdateCommands }`, resolveDir: resolve(ROOT, 'test'), sourcefile: '.component-update-regression-entry.ts' }, outfile: bundle, bundle: true, format: 'esm', platform: 'node', target: 'node24' });
		const mod = await import(pathToFileURL(resolve(ROOT, bundle)).href);
		assert.deepEqual(mod.componentUpdateCommands.map(command => command.name), ['schematic.getComponentUpdatePlan', 'schematic.updateComponents']);
		{
			const f = fixture({ footprintAlias: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' }, properties: { manufacturerId: 'A-2', otherProperty: { Custom: 'updated', Extra: 'new' } } }]);
			assert.equal(f.writes, 0, 'planning never writes');
			assert.equal(f.copies, 0, 'planning never copies a library resource');
			const result = await mod.updateComponents(f.api, plan);
			assert.equal(f.copies, 1, 'one target footprint is copied once');
			assert.deepEqual(f.deviceAssociation.symbol, { uuid: 'symbol-source', libraryUuid: 'symbol-library' }, 'the project symbol index resolves the original effective symbol reference');
			assert.equal(result.verified[0], 'c1');
			assert.equal(result.pcbSynchronized, false, 'PCB synchronization is reported separately');
			assert.equal(result.copiedResources[0].helperUuid, 'helper-device', 'resource provenance reports the helper device UUID');
			assert.equal(result.copiedResources[0].projectResourcePresent, true, 'the exported project contains the imported footprint');
			assert.equal(result.copiedResources[0].libraryGeometryVerified, true, 'the target and imported 3.0 library geometry match');
			assert.equal(result.copiedResources[0].serializedGeometryVerified, false, 'legacy serialized geometry is not claimed as cross-format verified');
			assert.equal(f.component.footprint.uuid, 'project-footprint', 'same schematic primitive now points to copied footprint');
			const footprintAttribute = effectiveAttribute(f.source, 'c1', 'Footprint');
			assert.equal(footprintAttribute.length, 1, 'footprint snapshot replacement leaves one effective association');
			assert.equal(footprintAttribute[0].header.id, 'a1', 'footprint association retains its original ATTR id');
			assert.equal(f.component.props.otherProperty.Custom, 'updated', 'requested custom property updated');
			assert.equal(f.component.props.otherProperty.Extra, 'new', 'new custom property merged');
			assert.equal(f.component.props.otherProperty.Manufacturer, 'Acme', 'unknown/unmodified system property preserved');
			assert.equal(f.component.props.otherProperty.Footprint, 'project-footprint', 'fresh property merge retains the synchronized footprint alias');
			assert.equal(f.component.props.manufacturerId, 'A-2', 'top-level system property updated');
			assert.equal(f.component.props.otherProperty['Manufacturer Part'], 'A-2', 'system alias updated with field');
			assert.equal(f.component.props.uniqueId, 'uid-1', 'component identity preserved');
			assert.equal(f.component.props.designator, 'R1', 'designator preserved');
			assert.match(f.source, /"type":"WIRE"/u, 'unrelated source record preserved');
		}
		{
			const request = [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }];
			const inherited = fixture();
			const inheritedPlan = await mod.getComponentUpdatePlan(inherited.api, request);
			assert.equal(inheritedPlan.items[0].changes.footprint.from, null, 'plan reports inherited raw source value as null');
			assert.equal(inheritedPlan.items[0].changes.footprint.effectiveFrom, 'old-footprint', 'plan separately reports the effective component footprint');
			await mod.updateComponents(inherited.api, inheritedPlan);
			assert.equal(inherited.attributeWrites, 1, 'inherited SDK Footprint value binds successfully after pre-write validation');

			const explicit = fixture({ footprintSourceValue: 'old-footprint' });
			const explicitPlan = await mod.getComponentUpdatePlan(explicit.api, request);
			await mod.updateComponents(explicit.api, explicitPlan);
			assert.equal(explicit.attributeWrites, 1, 'explicit raw source footprint matching the effective UUID binds normally');

			const sdkMismatch = fixture({ sdkFootprintValue: 'unexpected-footprint' });
			const sdkMismatchPlan = await mod.getComponentUpdatePlan(sdkMismatch.api, request);
			await assert.rejects(mod.updateComponents(sdkMismatch.api, sdkMismatchPlan), /SDK Footprint 属性值与计划有效封装不一致/u);
			assert.equal(sdkMismatch.attributeWrites, 0, 'SDK/component footprint mismatch rejects before Footprint ATTR write');

			const changedEffective = fixture();
			const changedPlan = await mod.getComponentUpdatePlan(changedEffective.api, request);
			changedEffective.component.footprint = null;
			await assert.rejects(mod.updateComponents(changedEffective.api, changedPlan), /计划基线已变化/u);
			assert.equal(changedEffective.copies, 0, 'effective footprint change after planning expires the plan before resource copy');

			const idMismatch = fixture({ sdkFootprintAttrId: 'sdk-other-attr' });
			const idMismatchPlan = await mod.getComponentUpdatePlan(idMismatch.api, request);
			await assert.rejects(mod.updateComponents(idMismatch.api, idMismatchPlan), /SDK Footprint 属性 ID 与源码不一致/u);
			assert.equal(idMismatch.attributeWrites, 0, 'SDK Footprint ATTR ID mismatch rejects without writing that ATTR');
		}
		{
			const request = [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' }, properties: { manufacturerId: 'A-2' } }];
			const runMetadata = async (label, metadata, trustedName = 'R0402') => {
				const f = fixture({ projectFootprintName: trustedName, footprintNameMetadata: metadata });
				const plan = await mod.getComponentUpdatePlan(f.api, request);
				const result = await mod.updateComponents(f.api, plan);
				assert.deepEqual(result.verified, ['c1'], label);
			};
			await runMetadata('uuid-only FootprintName metadata remains accepted', { uuid: 'project-footprint' });
			await runMetadata('FootprintName UUID and trusted name are accepted', { uuid: 'project-footprint', name: 'R0402' });
			await runMetadata('FootprintName key order is irrelevant', '{"name":"R0402","uuid":"project-footprint"}');

			const rejectMetadata = async (label, metadata, trustedName = 'R0402') => {
				const f = fixture({ projectFootprintName: trustedName, footprintNameMetadata: metadata });
				const plan = await mod.getComponentUpdatePlan(f.api, request);
				await assert.rejects(mod.updateComponents(f.api, plan), error => {
					assert.equal(error.partial, true, `${label} is reported as a partial update`);
					assert.match(error.cause.operationError, /组件数据发生变化/u, label);
					return true;
				});
			};
			await rejectMetadata('wrong FootprintName name is rejected', { uuid: 'project-footprint', name: 'R0805' });
			await rejectMetadata('wrong FootprintName UUID is rejected', { uuid: 'other-footprint', name: 'R0402' });
			await rejectMetadata('extra FootprintName keys are rejected', { uuid: 'project-footprint', name: 'R0402', extra: true });
			await rejectMetadata('FootprintName arrays are rejected', ['project-footprint']);
			await rejectMetadata('invalid FootprintName JSON is rejected', '{invalid-json');
			await rejectMetadata('name metadata without a trusted name is rejected', { uuid: 'project-footprint', name: 'R0402' }, null);

			const changedComponent = fixture({
				projectFootprintName: 'R0402',
				footprintNameMetadata: { uuid: 'project-footprint', name: 'R0402' },
				modifySourceTransform: source => source.split(/\r?\n/u).map(line => {
					const separator = line.indexOf('||');
					if (separator < 0)
						return line;
					const header = JSON.parse(line.slice(0, separator));
					if (header.type !== 'COMPONENT' || header.id !== 'c1')
						return line;
					const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
					data.x++;
					return `${line.slice(0, separator)}||${JSON.stringify(data)}${line.endsWith('|') ? '|' : ''}`;
				}).join('\n'),
			});
			const changedComponentPlan = await mod.getComponentUpdatePlan(changedComponent.api, request);
			await assert.rejects(mod.updateComponents(changedComponent.api, changedComponentPlan), error => {
				assert.equal(error.partial, true);
				assert.match(error.cause.operationError, /组件数据发生变化/u, 'a valid FootprintName normalization does not mask a separate component-data change');
				return true;
			});

			const staleCache = fixture({
				projectFootprintName: 'R0805',
				initialEffectiveFootprintUuid: 'project-footprint',
				footprintSourceValue: 'project-footprint',
				footprintNameMetadata: { uuid: 'project-footprint', name: 'R0402' },
			});
			staleCache.sourceChange(appendComponentFootprintName(staleCache.source, 'c1', JSON.stringify({ uuid: 'project-footprint', name: 'R0402' })));
			const stalePlan = await mod.getComponentUpdatePlan(staleCache.api, request);
			const staleResult = await mod.updateComponents(staleCache.api, stalePlan);
			assert.equal(staleCache.writes, 1, 'same-UUID stale-name cache repair uses one scoped source write');
			assert.deepEqual(effectiveComponent(staleCache.source, 'c1').data.attrs.FootprintName, JSON.stringify({ uuid: 'project-footprint', name: 'R0805' }));
			assert.deepEqual(staleResult.footprintNameRepairs, [{
				primitiveId: 'c1', before: JSON.stringify({ uuid: 'project-footprint', name: 'R0402' }),
				after: JSON.stringify({ uuid: 'project-footprint', name: 'R0805' }),
				target: { uuid: 'project-footprint', name: 'R0805' },
				sourceWriteStarted: true, sourceWriteCompleted: true, readbackVerified: true,
			}], 'successful repair reports before, after, verified target, and write/readback evidence');

			const correctCache = fixture({
				projectFootprintName: 'R0805',
				footprintNameMetadata: { uuid: 'project-footprint', name: 'R0805' },
			});
			correctCache.sourceChange(appendComponentFootprintName(correctCache.source, 'c1', JSON.stringify({ uuid: 'project-footprint', name: 'R0805' })));
			const correctPlan = await mod.getComponentUpdatePlan(correctCache.api, request);
			await mod.updateComponents(correctCache.api, correctPlan);
			assert.equal(correctCache.writes, 0, 'already-correct named cache does not add a source write');

			const staleReadback = fixture({
				projectFootprintName: 'R0805',
				footprintNameMetadata: { uuid: 'project-footprint', name: 'R0402' },
				footprintNameReadbackTransform: source => appendComponentFootprintName(source, 'c1', JSON.stringify({ uuid: 'project-footprint', name: 'R0402' })),
			});
			staleReadback.sourceChange(appendComponentFootprintName(staleReadback.source, 'c1', JSON.stringify({ uuid: 'project-footprint', name: 'R0402' })));
			const staleReadbackPlan = await mod.getComponentUpdatePlan(staleReadback.api, request);
			await assert.rejects(mod.updateComponents(staleReadback.api, staleReadbackPlan), error => {
				assert.equal(error.partial, true);
				assert.equal(staleReadback.writes, 1, 'failed repair readback does not retry the source write');
				const evidence = error.cause.footprintNameRepairs[0];
				assert.equal(evidence.sourceWriteStarted, true);
				assert.equal(evidence.sourceWriteCompleted, true);
				assert.equal(evidence.readbackVerified, false);
				assert.deepEqual(evidence.target, { uuid: 'project-footprint', name: 'R0805' });
				return true;
			});
		}
		{
			const sourceRef = { uuid: '8d616a6a3868455fa095fe0e1b87a43c', libraryUuid: '3703bce0b34942feac42a48deacb014b' };
			const projectFootprintUuid = '23cc3c617275a8b6';
			const makeReal0402Fixture = projectSource => fixture({
				projectFootprintUuid,
				footprintSources: {
					[sourceRef.uuid]: real0402SourceWithHeaderVariants,
					[projectFootprintUuid]: projectSource,
				},
				projectFootprintSource: projectSource,
			});
			const positive = makeReal0402Fixture(real0402ProjectWithHeaderVariants);
			const positivePlan = await mod.getComponentUpdatePlan(positive.api, [{ primitiveId: 'c1', footprint: sourceRef }]);
			const positiveResult = await mod.updateComponents(positive.api, positivePlan);
			assert.deepEqual(positiveResult.verified, ['c1'], 'the 51-record library source and 52-record project export match after stripping only managed META fields');
			assert.deepEqual(positiveResult.copiedResources[0].actualFootprintSource, { uuid: projectFootprintUuid, source: `${sourceRef.uuid}|${sourceRef.libraryUuid}` }, 'META.source is read from the project export and retained');
			const rejectionCases = [
				['changed PAD data', source => mutateFootprintSource(source, 'PAD', 'e13', data => { data.centerX += 1; }), /工程库 3\.0 几何与源封装不一致/u],
				['unknown non-PAD field', source => mutateFootprintSource(source, 'CANVAS', 'CANVAS', data => { data.vendorGeometryMarker = 'changed'; }), /工程库 3\.0 几何与源封装不一致/u],
				['unknown META field', source => mutateFootprintSource(source, 'META', 'META', data => { data.vendorMetaMarker = 'changed'; }), /工程库 3\.0 几何与源封装不一致/u],
				['wrong META.source', source => mutateFootprintSource(source, 'META', 'META', data => { data.source = 'other-source|other-library'; }), /META\/DOCHEAD.source 与目标封装来源不一致/u],
				['second DOCHEAD UUID conflict', source => appendConflictingFootprintDocHead(source), /DOCHEAD 的 UUID 身份冲突/u],
			];
			for (const [label, transform, expected] of rejectionCases) {
				const f = makeReal0402Fixture(transform(real0402ProjectSource));
				const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: sourceRef }]);
				await assert.rejects(mod.updateComponents(f.api, plan), error => {
					assert.equal(error.partial, true, `${label} rejection retains partial import evidence`);
					assert.match(error.cause.operationError, expected, label);
					return true;
				});
			}
		}
		{
			const sourceRef = { uuid: '0eaeee1f4268490394fd0815b737081a', libraryUuid: '3703bce0b34942feac42a48deacb014b' };
			const projectFootprintUuid = 'baf2b92f3eb98130';
			const source0805 = await readFile(resolve(ROOT, 'test/fixtures/component-update-0805-source.sourcelog'), 'utf8');
			const project0805 = await readFile(resolve(ROOT, 'test/fixtures/component-update-0805-project.sourcelog'), 'utf8');
			const make0805Fixture = (targetSource = source0805, projectSource = project0805) => fixture({
				projectFootprintUuid,
				footprintSources: { [sourceRef.uuid]: targetSource, [projectFootprintUuid]: projectSource },
				projectFootprintSource: projectSource,
			});
			const positive = make0805Fixture();
			const plan = await mod.getComponentUpdatePlan(positive.api, [{ primitiveId: 'c1', footprint: sourceRef }]);
			const result = await mod.updateComponents(positive.api, plan);
			assert.deepEqual(result.verified, ['c1'], 'captured 0805 source and project source match after only exact observed defaults are normalized');
			const normalization = result.copiedResources[0].normalizedDefaultRecords;
			assert.equal(normalization.target.length, 12, 'normalization evidence lists the empty NET and eleven exact PRIMITIVE defaults from the source');
			assert.deepEqual(normalization.imported, [], 'the exported project omits those exact default records');

			const emptyNetId = '["NET",""]';
			const primitiveGridId = '["PRIMITIVE","GRID"]';
			const rejectionCases = [
				['PAD geometry change', source => mutateFootprintSource(source, 'PAD', 'e7', data => { data.centerX += 1; })],
				['ordinary geometry change', source => mutateFootprintSource(source, 'POLY', 'e1', data => { data.width += 1; })],
				['empty NET with unknown field', source => mutateFootprintSource(source, 'NET', emptyNetId, data => { data.vendorNetOption = true; })],
				['named NET', source => appendFootprintRecord(source, { type: 'NET', id: '["NET","GND"]', ticket: 99999 }, { netType: null, specialColor: null, retLine: true, differentialName: null, isPositiveNet: false, equalLengthGroupName: null })],
				['non-default known PRIMITIVE value', source => mutateFootprintSource(source, 'PRIMITIVE', primitiveGridId, data => { data.color = '#ff0000'; })],
				['known PRIMITIVE with an extra key', source => mutateFootprintSource(source, 'PRIMITIVE', primitiveGridId, data => { data.vendorOption = true; })],
				['unknown PRIMITIVE record omitted from project', source => appendFootprintRecord(source, { type: 'PRIMITIVE', id: '["PRIMITIVE","UNKNOWN"]', ticket: 99998 }, { layerId: 0, display: true, color: null })],
			];
			for (const [label, transform] of rejectionCases) {
				const f = make0805Fixture(transform(source0805));
				const rejectionPlan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: sourceRef }]);
				await assert.rejects(mod.updateComponents(f.api, rejectionPlan), error => {
					assert.equal(error.partial, true, `${label} rejection retains import evidence`);
					assert.match(error.cause.operationError, /工程库 3\.0 几何与源封装不一致/u, label);
					return true;
				});
			}
		}
		{
			const f = fixture();
			f.sourceChange(f.source.replace(/\n\{"type":"WIRE".*$/u, '').replace(/\|$/u, ''));
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			await mod.updateComponents(f.api, plan);
			assert.ok(!f.source.endsWith('|'), 'footprint ATTR snapshot replacement preserves an unterminated final record');
		}
		{
			const f = fixture();
			f.api.lib_Footprint.get = async (uuid, libraryUuid) => ({ uuid, libraryUuid, name: 'R0402' });
			f.api.lib_Footprint.getDocumentSource = async () => realLibraryFootprint;
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: '8d616a6a3868455fa095fe0e1b87a43c', libraryUuid: '3703bce0b34942feac42a48deacb014b' } }]);
			assert.equal(plan.items[0].changes.footprint.sourceHead.uuid, '8d616a6a3868455fa095fe0e1b87a43c', 'real direct-library sourcelog is parsed and UUID verified');
			assert.deepEqual(plan.items[0].changes.footprint.padNumbers.sort(), ['1', '2'], 'real sourcelog reports every physical pad number');
		}
		{
			const f = fixture({ missingResource: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), /工程 epro 中缺少封装资源/u);
			assert.equal(f.component.footprint.uuid, 'old-footprint', 'missing exported resource stops before changing the schematic association');
		}
		{
			const f = fixture({ skipFootprint: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { name: 'updated' } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1'], 'attribute-only update works without a Footprint ATTR');
			assert.equal(f.copies, 0, 'attribute-only update does not copy footprints');
		}
		{
			const f = fixture({ secondComponent: true, injectPcbLayerDefault: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [
				{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } },
				{ primitiveId: 'c2', properties: { otherProperty: { ModuleRole: 'output-divider' } } },
			]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1', 'c2'], 'exact default PCB Layer records added by the SDK do not fail property verification');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'PCB Layer'), [], 'new implicit default PCB Layer is tombstoned back to the prior absent state');
		}
		{
			const f = fixture({ secondComponent: true, injectAttributeDefaults: true, injectPcbLayerDefault: true });
			const baseline = [
				['c1', 'Designator', 'R1', 6, 5],
				['c1', 'Name', null, 7, 11],
				['c2', 'Designator', 'R2', 8, 5],
				['c2', 'Name', null, 9, 11],
			].map(([parentId, key, value, ticket, zIndex]) => `${JSON.stringify({ type: 'ATTR', id: `attr-${parentId}-${key}`, ticket })}||${JSON.stringify({ x: 10, y: 20, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value, keyVisible: null, valueVisible: true, key, fillColor: null, parentId, zIndex })}|`);
			f.sourceChange(`${f.source}\n${baseline.join('\n')}`);
			const plan = await mod.getComponentUpdatePlan(f.api, [
				{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } },
				{ primitiveId: 'c2', properties: { otherProperty: { ModuleRole: 'output-divider' } } },
			]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1', 'c2'], 'SDK default serialization is repaired before strict verification');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'Designator')[0].data, { x: 10, y: 20, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value: 'R1', keyVisible: null, valueVisible: true, key: 'Designator', fillColor: null, parentId: 'c1', zIndex: 5 }, 'original Designator data is restored exactly');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'Name')[0].data, { x: 10, y: 20, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value: null, keyVisible: null, valueVisible: true, key: 'Name', fillColor: null, parentId: 'c1', zIndex: 11 }, 'null Name value and its inheritance are restored');
			assert.equal(effectiveAttribute(f.source, 'c1', 'ModuleRole')[0].data.value, 'input-divider', 'requested custom property remains applied');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'PCB Layer'), [], 'new default PCB Layer does not remain effective');
			assert.doesNotMatch(f.source, /"id":"attr-c1-PCB Layer"/u, 'new default ATTR row is removed from the SCH snapshot');
		}
		{
			const f = fixture({ rewriteExistingName: true, injectPcbLayerDefault: true });
			f.sourceChange(realAfterPropertiesSource
				.replaceAll('f2a7b2fabfc5303a', focus.uuid)
				.replaceAll('65c81db3d6520fa9', 'c1'));
			const originalName = effectiveAttribute(f.source, 'c1', 'Name')[0];
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1'], 'real 62 after-properties sourcelog restores attributes successfully');
			const rows = f.source.split(/\r?\n/u).filter(Boolean);
			assert.ok(rows.slice(0, -1).every(line => line.endsWith('|')), 'every intermediate real sourcelog record has its required trailing separator after restore');
			assert.equal(effectiveAttribute(f.source, 'c1', 'PCB Layer')[0].header.id, '914d597f8fda01bf', 'preexisting final-neighbor ATTR is restored in place with its original ID');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'Name')[0], originalName, 'an existing unrequested ATTR changed in place by the SDK is restored even without a new ATTR row');
			assert.ok(effectiveAttribute(f.source, 'c1', 'ModuleRole').some(record => record.data.value === 'input-divider'), 'requested ModuleRole remains updated');
			assert.doesNotMatch(f.source, /"id":"attr-c1-PCB Layer"/u, 'new implicit PCB Layer row is removed');
		}
		{
			const f = fixture({ injectPcbLayerDefault: true, pcbLayerValue: 'Top Layer' });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1'], 'a non-default unsolicited PCB Layer write is actively removed');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'PCB Layer'), [], 'no unsolicited PCB Layer remains effective');
		}
		{
			const f = fixture({ secondComponent: true, injectAttributeDefaults: true, injectPcbLayerDefault: true, nameAttrValue: 'Renamed' });
			const baseline = [
				['c1', 'Designator', 'R1', 6, 5],
				['c1', 'Name', null, 7, 11],
				['c2', 'Designator', 'R2', 8, 5],
				['c2', 'Name', null, 9, 11],
			].map(([parentId, key, value, ticket, zIndex]) => `${JSON.stringify({ type: 'ATTR', id: `attr-${parentId}-${key}`, ticket })}||${JSON.stringify({ x: 10, y: 20, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value, keyVisible: null, valueVisible: true, key, fillColor: null, parentId, zIndex })}|`);
			f.sourceChange(`${f.source}\n${baseline.join('\n')}`);
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1'], 'an SDK Name serialization change is actively restored, not ignored');
			assert.equal(effectiveAttribute(f.source, 'c1', 'Name')[0].data.value, null, 'arbitrary preexisting Name value is restored exactly');
		}
		{
			const f = fixture({ secondComponent: true, injectAttributeDefaults: true, injectPcbLayerDefault: true, failSourceRestore: true });
			const baseline = [
				['c1', 'Designator', 'R1', 6, 5],
				['c1', 'Name', null, 7, 11],
				['c2', 'Designator', 'R2', 8, 5],
				['c2', 'Name', null, 9, 11],
			].map(([parentId, key, value, ticket, zIndex]) => `${JSON.stringify({ type: 'ATTR', id: `attr-${parentId}-${key}`, ticket })}||${JSON.stringify({ x: 10, y: 20, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value, keyVisible: null, valueVisible: true, key, fillColor: null, parentId, zIndex })}|`);
			f.sourceChange(`${f.source}\n${baseline.join('\n')}`);
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), (error) => {
				assert.equal(error.partial, true);
				assert.equal(error.retryable, false);
				assert.deepEqual(error.cause.currentPhases, ['properties-updated-verified', 'unrequested-attribute-restoration-pending', 'unrequested-attribute-restoration-started']);
				assert.match(error.cause.operationError, /restore interrupted/u);
				return true;
			}, 'a failed source restoration is reported as a partial write');
		}
		{
			const f = fixture({ secondComponent: true, injectAttributeDefaults: true, injectPcbLayerDefault: true, inconsistentRequestedAfterRestore: true });
			const baseline = [
				['c1', 'Designator', 'R1', 6, 5],
				['c1', 'Name', null, 7, 11],
				['c2', 'Designator', 'R2', 8, 5],
				['c2', 'Name', null, 9, 11],
			].map(([parentId, key, value, ticket, zIndex]) => `${JSON.stringify({ type: 'ATTR', id: `attr-${parentId}-${key}`, ticket })}||${JSON.stringify({ x: 10, y: 20, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null, italic: null, underline: null, strikeout: false, align: null, value, keyVisible: null, valueVisible: true, key, fillColor: null, parentId, zIndex })}|`);
			f.sourceChange(`${f.source}\n${baseline.join('\n')}`);
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'input-divider' } } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), (error) => {
				assert.equal(error.partial, true);
				assert.equal(error.retryable, false);
				assert.deepEqual(error.cause.currentPhases, ['properties-updated-verified', 'unrequested-attribute-restoration-pending', 'unrequested-attribute-restoration-started', 'unrequested-attributes-restored']);
				assert.match(error.cause.operationError, /请求属性 ModuleRole 的 getter 读回不符/u);
				return true;
			}, 'successful source restoration followed by mismatching requested getter is partial');
			assert.equal(effectiveAttribute(f.source, 'c1', 'ModuleRole')[0].data.value, 'input-divider', 'source restoration succeeded and retained the requested record');
			assert.deepEqual(effectiveAttribute(f.source, 'c1', 'PCB Layer'), [], 'new PCB Layer default was removed before getter mismatch');
		}
		{
			const f = fixture({ freshHostDefaults: freshAfter });
			f.sourceChange(freshBefore);
			f.focusChange({ ...focus, uuid: 'f2a7b2fabfc5303a' });
			f.setDesignator('R4');
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'fresh-inheritance-test' } } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.deepEqual(result.verified, ['c1'], 'fresh host ATTR/component defaults are accepted only when tied to the current device and getter');
			assert.ok(result.acceptedHostNormalizations.some(row => row.recordType === 'COMPONENT' && row.field === 'attrs.DeviceName'), 'the cached DeviceName normalization is reported');
			assert.ok(result.acceptedHostNormalizations.some(row => row.recordType === 'ATTR' && row.field === 'zIndex' && row.after === -6), 'the fresh Unique ID zIndex normalization is reported');
			assert.ok(result.acceptedHostNormalizations.some(row => row.recordType === 'ATTR' && row.field === 'value+rotation' && row.after.value === 'R4' && row.after.rotation === 0), 'the fresh Designator normalization is reported');
			assert.equal(effectiveAttribute(f.source, 'c1', 'ModuleRole')[0].data.value, 'fresh-inheritance-test', 'requested fresh custom property remains applied');
		}
		{
			const withMissingUniqueIdPosition = freshBefore.split(/\r?\n/u).map(line => {
				const separator = line.indexOf('||');
				if (separator < 0) return line;
				const header = JSON.parse(line.slice(0, separator));
				const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
				if (header.type === 'ATTR' && data.parentId === 'c1' && data.key === 'Unique ID')
					data.zIndex = null;
				return `${line.slice(0, separator)}||${JSON.stringify(data)}${line.endsWith('|') ? '|' : ''}`;
			}).join('\n');
			const f = fixture({ injectPcbLayerDefault: true, normalizeAfterSourceRestore: true });
			f.sourceChange(withMissingUniqueIdPosition);
			f.focusChange({ ...focus, uuid: 'f2a7b2fabfc5303a' });
			f.setDesignator('R4');
			const result = await withoutStructuredClone(async () => {
				const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { otherProperty: { ModuleRole: 'restore-stage-host-fill' } } }]);
				return await mod.updateComponents(f.api, plan);
			});
			assert.deepEqual(result.verified, ['c1'], 'host normalization after setDocumentSource is accepted and reaches final verification');
			assert.ok(result.acceptedHostNormalizations.some(row => row.recordType === 'COMPONENT' && row.field === 'attrs.DeviceName'), 'restoration readback accepts the exact DeviceName host fill');
			assert.ok(result.acceptedHostNormalizations.some(row => row.recordType === 'ATTR' && row.field === 'zIndex' && row.after === -6), 'restoration readback accepts the finite Unique ID zIndex host fill');
			assert.equal(effectiveAttribute(f.source, 'c1', 'PCB Layer').length, 0, 'unrequested PCB Layer default remains removed after restore');
		}
		for (const [mode, expected] of [
			['missing-component', /符号、位号、位置、姿态、唯一 ID 或连线相关组件数据发生变化/u],
			['changed-unique-id', /符号、位号、位置、姿态、唯一 ID 或连线相关组件数据发生变化/u],
		]) {
			const transform = source => source.split(/\r?\n/u).flatMap(line => {
				const separator = line.indexOf('||');
				if (separator < 0) return [line];
				const header = JSON.parse(line.slice(0, separator));
				if (header.type !== 'COMPONENT' || header.id !== 'c1') return [line];
				if (mode === 'missing-component') return [];
				const data = JSON.parse(line.slice(separator + 2).replace(/\|$/u, ''));
				data.uniqueId = 'tampered-unique-id';
				return [`${line.slice(0, separator)}||${JSON.stringify(data)}${line.endsWith('|') ? '|' : ''}`];
			}).join('\n');
			const f = fixture({ modifySourceTransform: transform });
			await withoutStructuredClone(async () => {
				const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { name: 'updated' } }]);
				await assert.rejects(mod.updateComponents(f.api, plan), error => {
					assert.equal(error.partial, true);
					assert.match(error.cause.operationError, expected);
					return true;
				});
			});
			assert.equal(f.component.footprint.uuid, 'old-footprint', 'failed source-scope verification leaves the schematic footprint binding unchanged');
		}
		{
			const f = fixture({ secondComponent: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [
				{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } },
				{ primitiveId: 'c2', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } },
			]);
			const result = await mod.updateComponents(f.api, plan);
			assert.equal(f.copies, 1, 'a shared target footprint is copied once for the batch');
			assert.deepEqual(result.verified, ['c1', 'c2']);
			assert.equal(f.second.footprint.uuid, 'project-footprint', 'second schematic instance receives the shared project copy');
		}
		{
			const f = fixture({ existingCopy: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.equal(f.copies, 0, 'stable project-library copy is reused');
			assert.equal(result.copiedResources[0].reused, true);
			assert.equal(result.copiedResources[0].to.libraryUuid, 'project', 'flat project footprint UUID resolves through the project alias');
			assert.deepEqual(f.deviceSearchCalls.map(args => args.slice(0, 6)), [
				['ACE_FP_source-library_target-footprint', 'project-library', undefined, undefined, 20, 1],
			], 'existing project device is queried by exact helper name with search argument positions');
		}
		{
			const f = fixture({ createThrows: true, deviceGetThrows: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.equal(f.copies, 1, 'a lost create response is resolved by one exact-name search without repeating create');
			assert.equal(result.copiedResources[0].helperUuid, 'helper-device');
			assert.equal(result.copiedResources[0].verified, true);
			assert.deepEqual(f.deviceSearchCalls.map(args => args[0]), ['ACE_FP_source-library_target-footprint', 'ACE_FP_source-library_target-footprint'], 'create recovery reuses its single helper-name query');
			assert.ok(f.deviceSearchCalls.every(args => args[1] === 'project-library' && args[2] === undefined && args[3] === undefined && args[4] === 20 && args[5] >= 1), 'search arguments preserve the documented filters, page size, and page');
		}
		{
			const f = fixture({ throwDeviceSearchCall: 2 });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), error => {
				assert.equal(error.partial, true);
				const [resource] = error.cause.copiedResources;
				assert.equal(resource.helperUuid, 'helper-device', 'the create UUID is retained before the post-create name query');
				assert.equal(resource.actualFootprint, null, 'footprint evidence remains unknown until the name query returns');
				assert.equal(resource.generatedSymbolUuid, null, 'symbol evidence remains unknown until the name query returns');
				assert.equal(resource.verified, false);
				return true;
			});
			assert.equal(f.copies, 1, 'a failed post-create search never repeats create');
			assert.equal(f.deviceSearchCalls.length, 2);
			assert.equal(f.component.footprint.uuid, 'old-footprint', 'the schematic remains unchanged when post-create search fails');
		}
		{
			const f = fixture({ existingCopy: true, missingResource: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), error => {
				assert.equal(error.partial, true);
				const [resource] = error.cause.copiedResources;
				assert.equal(resource.helperUuid, 'existing-helper', 'a reused helper UUID is recorded before resource verification');
				assert.deepEqual(resource.actualFootprint, { uuid: 'project-footprint', libraryUuid: 'project' }, 'the flat footprint UUID is retained in partial evidence');
				assert.equal(resource.generatedSymbolUuid, 'symbol-1', 'the top-level symbol UUID is retained in partial evidence');
				return true;
			});
		}
		{
			const f = fixture({ noSymbolMapping: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			const result = await mod.updateComponents(f.api, plan);
			assert.equal(result.copiedResources[0].generatedSymbolUuid, 'generated-symbol', 'the empty-symbol import branch reports its generated symbol UUID');
			assert.equal(f.deviceAssociation.symbolType, 2, 'missing project symbol source selects the approved empty-symbol import branch once');
		}
		{
			const f = fixture({ createThrowsNoWrite: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), error => {
				assert.equal(error.partial, true);
				assert.equal(error.cause.copiedResources.length, 1, 'uncertain helper import remains visible in partial state');
				assert.equal(error.cause.copiedResources[0].helperUuid, null);
				return true;
			});
			assert.equal(f.copies, 1, 'an unproven create is never retried');
			assert.equal(f.component.footprint.uuid, 'old-footprint', 'uncertain helper import stops before changing the schematic');
		}
		{
			const f = fixture();
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { name: 'updated' } }]);
			f.focusChange({ ...focus, uuid: 'page-2' });
			await assert.rejects(mod.updateComponents(f.api, plan), /焦点原理图页或所属工程已变化|原理图源码身份不符/u);
			assert.equal(f.writes, 0, 'stale focus is rejected before write');
		}
		{
			const f = fixture();
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', properties: { name: 'updated' } }]);
			f.sourceChange(f.source.replace('[1,2,3,4]', '[1,2,3,5]'));
			await assert.rejects(mod.updateComponents(f.api, plan), /计划生成后器件、属性或封装源码已变化/u);
		}
		{
			const f = fixture({ failAttributeWrite: true });
			const plan = await mod.getComponentUpdatePlan(f.api, [{ primitiveId: 'c1', footprint: { uuid: 'target-footprint', libraryUuid: 'source-library' } }]);
			await assert.rejects(mod.updateComponents(f.api, plan), (error) => {
				assert.equal(error.partial, true);
				assert.equal(error.cause.partial, true);
				assert.equal(error.cause.copiedResources.length, 1);
				assert.equal(error.cause.currentPrimitiveId, 'c1');
				return true;
			});
		}
		console.log('component-update-regression: passed');
	}
	finally { await rm(resolve(ROOT, bundle), { force: true }); }
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
