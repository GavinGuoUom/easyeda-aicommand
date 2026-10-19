import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

async function main() {
	const root = resolve(import.meta.dirname, '..');
	const autoCopperSource = readFileSync(resolve(root, 'src/commands/autoCopper.ts'), 'utf8');
	const sourceLogSource = readFileSync(resolve(root, 'src/pcb/sourcelog.ts'), 'utf8');
	const helperStart = autoCopperSource.indexOf('export function copperConnectionRuleSnapshot(');
	const helperEnd = autoCopperSource.indexOf('\nfunction readArray', helperStart);
	assert.notEqual(helperStart, -1, 'production source diagnostic helper must remain present');
	assert.ok(helperEnd > helperStart, 'production source diagnostic helper boundary must remain present');
	const helperModule = { exports: {} };
	const helperSource = `${sourceLogSource}\n${autoCopperSource.slice(helperStart, helperEnd)}\nmodule.exports = { copperConnectionRuleSnapshot };`;
	runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
		module: helperModule,
		exports: helperModule.exports,
	});
	const { copperConnectionRuleSnapshot } = helperModule.exports;
	function rule(id, ruleContext, ticket = 1) {
		return `${JSON.stringify({ type: 'RULE', id: JSON.stringify(['RULE', 'COPPER', id]), ticket })}||${JSON.stringify({ ruleState: 'DEFAULT', ruleContext })}|`;
	}
	function tombstone(id, ticket) {
		return `${JSON.stringify({ type: 'RULE', id: JSON.stringify(['RULE', 'COPPER', id]), ticket })}||""|`;
	}

	const known = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(rule('copperRegion', {
		unit: 'mm',
		sglPad: { isOpen: true, content: [{ layerId: 1, connType: 'DIVERGENCE', spoSpac: 10, spoWidth: 10, spoAng: 90 }] },
	}))));
	assert.equal(known.status, 'candidates-found');
	assert.equal(known.records.length, 1);
	assert.equal(known.records[0].selector, 'sglPad');
	assert.deepEqual(known.records[0].thermalGap, {
		status: 'known', raw: 10, sourcePath: 'ruleContext.sglPad.content[0].spoSpac',
		unit: { status: 'unknown', reason: 'source spoSpac 存储单位未确认' },
	});
	assert.deepEqual(known.records[0].spokeWidth, {
		status: 'known', raw: 10, sourcePath: 'ruleContext.sglPad.content[0].spoWidth',
		unit: { status: 'unknown', reason: '源码字段单位语义未确认' },
	});
	assert.equal(known.records[0].unitLabel, 'mm', 'unit label is preserved as source text and never used for coordinate conversion');
	for (const [label, expectedLabel] of [['mm', 'mm'], ['mil', 'mil'], [undefined, null]]) {
		const context = { sglPad: { isOpen: true, content: [{ layerId: 1, connType: 'DIVERGENCE', spoSpac: 10 }] } };
		if (label !== undefined)
			context.unit = label;
		const snapshot = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(rule('copperRegion', context))));
		assert.deepEqual(snapshot.records[0].thermalGap, {
			status: 'known', raw: 10, sourcePath: 'ruleContext.sglPad.content[0].spoSpac',
			unit: { status: 'unknown', reason: 'source spoSpac 存储单位未确认' },
		}, `thermal gap unit remains unknown when ruleContext.unit is ${String(label)}`);
		assert.equal(snapshot.records[0].unitLabel, expectedLabel, 'unit label stays an independent source label');
	}

	const missing = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot('')));
	assert.deepEqual(missing, { status: 'missing', records: [] });
	const missingFields = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(rule('copperRegion', { mulPad: { isOpen: true, content: [{ layerId: 1, connType: 'DIRECT' }] } }))));
	assert.equal(missingFields.records[0].thermalGap.status, 'unknown');
	assert.equal(missingFields.records[0].spokeWidth.status, 'unknown');
	assert.equal(missingFields.records[0].spokeAngle.status, 'unknown');

	const multiple = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(rule('copperRegion', {
		unit: 'mm',
		sglPad: { isOpen: true, content: [{ layerId: 1, connType: 'DIVERGENCE', spoSpac: 10, spoWidth: 10, spoAng: 90 }] },
		mulPad: { isOpen: true, content: [{ layerId: 1, connType: 'DIRECT' }] },
		track: { isOpen: true, content: [{ layerId: 1, connType: 'DIRECT' }] },
	}))));
	assert.deepEqual(multiple.records.map(item => item.selector), ['sglPad', 'mulPad', 'track'], 'all selector candidates remain visible without choosing one');
	assert.deepEqual(JSON.parse(JSON.stringify(multiple)), multiple, 'source diagnostics survive plan JSON roundtrip');
	assert.throws(() => copperConnectionRuleSnapshot('{broken source}'), /缺少 \|\| 分隔符/, 'malformed source must fail clearly');
	const replaced = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(`${rule('copperRegion', { sglPad: { content: [{ layerId: 1, connType: 'DIVERGENCE' }] } }, 1)}\n${rule('copperRegion', { track: { content: [{ layerId: 1, connType: 'DIRECT' }] } }, 2)}`)));
	assert.deepEqual(replaced.records.map(item => item.selector), ['track'], 'higher ticket is the effective source record');
	const tombstoneFirst = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(`${tombstone('copperRegion', 2)}\n${rule('copperRegion', { track: { content: [{ layerId: 1, connType: 'DIRECT' }] } }, 1)}`)));
	assert.deepEqual(tombstoneFirst, { status: 'missing', records: [] }, 'a later-seen lower-ticket record must not revive a higher-ticket tombstone');
	const sameTicketReplacement = JSON.parse(JSON.stringify(copperConnectionRuleSnapshot(`${tombstone('copperRegion', 2)}\n${rule('copperRegion', { track: { content: [{ layerId: 1, connType: 'DIRECT' }] } }, 2)}`)));
	assert.deepEqual(sameTicketReplacement.records.map(item => item.selector), ['track'], 'same-ticket later records replace earlier records');

	const commandSource = readFileSync(resolve(root, 'src/commands/autoCopper.ts'), 'utf8');
	assert.match(commandSource, /copperConnectionRules/);
	assert.match(commandSource, /'coverage'\]\)/, 'executePlan compares re-planned coverage, including connection diagnostics');
	assert.match(commandSource, /\{ status: 'not-applicable' \}/, 'fixed fill marks preserveSilos not applicable');
	console.log('auto copper connection regression passed');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
