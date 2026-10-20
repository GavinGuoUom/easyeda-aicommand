# Schematic workflow

First use [Connection and setup](setup.md) to verify the window, project, and active schematic page. Choose commands from [high-frequency](commands-schematic-high.md) and [low-frequency](commands-schematic-low.md). Read parameters, return fields, and examples from `/help?cmd=<command-name>` for the verified selected window version; `/help` is not routed by the `instanceId` on a write request.

Before writing, read [Schematic operating requirements](原理图操作要求.md) and plan component layout, short-stub spacing, and label direction.

## Inspect and place

1. Use `schematic.getPageInfo`, `schematic.listComponents`, and `schematic.listPins` to identify the page, components, and actual pins.
2. Use `schematic.placeDevice` for a single component; consider `schematic.buildBlock` only for a complete functional block. After placement, verify instance identity, footprint resource, pin numbers, and pad numbers before wiring.
3. Immediate `placeDevice` readback does not prove the component is saved. Without a footprint association or electrical mapping, do not treat successful placement as PCB-ready. A failed post-create check may leave a component behind; inspect the current state and do not replay the creation.
4. For resource anomalies, use `schematic.getPlacementResourcesDiagnostic` to inspect an existing instance. A read-only diagnostic does not prove placement succeeded and does not authorize recreating the component.

## Wires and labels

| Goal | Command | Key limitation |
| --- | --- | --- |
| Connect one pin to a named net | `schematic.labelWire` | Use the actual designator and pin number. Stop if the pin is already occupied by a differently named net. |
| Connect exactly two pins directly | `schematic.linkWire` | Exactly two pins; do not also specify a net name. |
| Make a batch of known connections | `schematic.batchWire` | Check each item and the final netlist; failed items are not automatically repaired. |
| Specify a path or label position | `schematic.drawWire`, `schematic.placeNetLabel` | If `drawWire` already names the wire, do not add a same-name label on top. |

Do not wire NC pins. Manual routes must not cross unrelated pins or overlap collinearly with differently named wires; the host may merge touching wires. A net-label anchor must actually attach to a wire; visual proximity is not an electrical connection. If `placeNetLabel` returns unknown or floating attachment, preserve the current state and stop dependent writes. Source Y coordinates have the opposite sign from public API coordinates; do not pass source coordinates directly to drawing commands.

`schematic.batchWire` does not currently forward `stubLen` from `label` items; the field is ignored. It uses the `labelWire` default stub length of 60 schematic units. To specify a length, call `schematic.labelWire` for each connection and pass `stubLen`; its minimum is 20. Collision handling may still change stub direction or path. These parameter behaviors were checked against v0.20.51 source.

`schematic.linkWire` uses a U-shaped candidate for pins in the same row or column, and an L-shaped candidate when they are in different rows and columns. It checks third-party pins and some collinear wire overlaps, but not component-body boundaries, so a route may cross a component. Inspect the returned `route` and canvas. To explicitly avoid a component, use `schematic.drawWire` with a specified path and verify the netlist and DRC. A passing connectivity audit does not prove that the drawing is unobstructed.

## Modify, organize, and delete

- Verify changes such as `schematic.moveComponent`, `modifyComponent`, `modifyWire`, and `modifyNetLabel` by independent readback, not an SDK boolean. `modifyComponent` submits the complete property object; preserve existing `otherProperty` and do not overwrite project-instance properties with library-device defaults.
- Use `schematic.autoLayout` only to organize an existing functional block. Limit the target and run `dryRun` first; save before executing. Old wires do not follow a moved component; `rewire` deletes and rebuilds related wires. Check wires not reconnected, skipped complex wires, and partial movement. On partial failure, inspect `error.cause.moved` and the current state; do not assume automatic rollback.
- Before `schematic.delete`, verify target IDs and dependencies; rescan after deletion. If a timeout or readback is unknown, stop later deletions. `task.get` can query long-running tasks; a timeout does not mean cancellation. Confirm persistence by saving, closing, and reopening.

## Check and save

Compare expected pins and nets with `schematic.listNets`, `listWires`, `getNetlist`, or `exportNetlist`, then run DRC. Use `structuralAudit` to investigate drawing and connectivity structure; verify the identity of candidate findings such as a frame. On hosts that do not support detailed output, `runDrcDetailed` may return only an aggregate result.

`getNetlist` and `exportNetlist` may cause the host to update designators or Unique IDs, so do not assume they are read-only. Parse any non-empty export. After saving, inspect the full page with `schematic.exportPng` and decode it according to its actual file type; multi-page exports may be ZIP files. Background `editor.screenshot` may be a cached frame. To prove persistence, save, close, reopen, and verify identity, properties, nets, and untouched content.

## Complete component replacement

AI Command Engine has no single command that completes every part of a replacement. The separate module-reuse plugin provides a synchronized replacement workflow. Combine ACE commands only when needed and stop for read-only inspection if any result is unknown. The revised plugin connects only to a bridge whose source-check revision matches and uses the address returned by the module skill; it does not fall back to the old service.

1. Back up the native `.epro2` project with `project.exportFile`. Activate the target page and record the old component's ID, designator, position, mirror state, pins, nets, and project properties to preserve. When reading source, verify the active page's `DOCHEAD.uuid`; split header and body at the first `||`; for each `(type,id)`, use the highest `ticket`; an empty body is a deletion tombstone. Do not treat an old record as current state or pass source Y coordinates directly to the public API.
2. Look up the new component's Device, Symbol, Footprint, pins, and part information. The model, manufacturer, and supplier part number must come from the new component; do not inherit them from the old one.
3. Place a new instance at a location that does not reuse the old designator or association IDs. Verify the new resource source, footprint and per-pin numbers, absolute positions, and net mapping. Do not delete the old component if old and new pins cannot be mapped one to one.
4. If business properties must be transferred, use `schematic.modifyComponent` based on the new instance's complete properties. Preserve the new component's resources and system properties; overlay only explicitly required project properties. Preserve existing custom keys in `otherProperty`.
5. Delete the old ID only after the new instance, connections, and required properties are confirmed. Restore only project identities that must be retained, such as the designator, Unique ID, Channel ID, Group ID, or Reuse Block. `setAttribute` cannot fabricate Device, Symbol, or Footprint associations.
6. Recheck the schematic netlist and untouched objects; save, close, and reopen for verification. The user initiates and confirms PCB updates in the EDA interface; AI performs read-only checks before and after.

## Error repair and macros

For label problems, first locate them read-only, then choose `pruneFloatingLabels`, `fixNetLabels`, `repairNet`, or `dedupeWireNets` as appropriate. Use `dryRun` first when supported. A canvas view alone cannot establish whether labels are floating, net names duplicated, or nets fragmented; check the netlist and DRC after repairs. Source rewrite fallback is not a prerequisite for ordinary repairs; consider it only when explicitly needed and after backing up.

Use `macro` only when all steps are known and do not require an intermediate decision. If any step fails or has an unknown result, stop dependent writes. The macro response key for the step collection is `steps`. Submit steps separately when the next action depends on readback.

**Version-specific checks and command details**

For `schematic.drawWire`, the host may merge adjacent segments into an existing wire. Since v0.20.20, `primitiveIds` means the surviving wire IDs covering the requested path, while `segments` means the number of simple segments executed; also inspect `created`, `reused`, and `removed`. Do not equate segment count or SDK-returned IDs with the number of new wires. v0.20.21 fixed a false pre-write rejection caused by WIRE records without geometry and an associated LINE whose native Y axis is opposite the SDK's. In one adjacent-collinear sample on the current EDA 4.1.78 host, a change to an old wire's geometry and style returned a non-retryable partial result, listed the reused ID, and stopped. The merged state remained after save and reopen.

When the SDK returns `number[]` or `number[][]`, preserve and parse the original grouping; do not flatten first. Use a candidate segment only when it agrees in both directions with the source LINE associated with the same WIRE. Do not infer connectivity across groups. For a simple append that keeps the same WIRE ID, all old LINE records, and adds only requested LINE records, preserve every existing `ATTR` except `zIndex`. Existing `zIndex` values may either remain unchanged as a group or all increase by the number `n` of added LINE records. `n` must be a finite integer; preserve the relative order of existing ATTR records by zIndex and record `drawingOrderChanges`. Continue strict checks of the WIRE itself and all non-target objects; reject other differences. In a v0.20.34 host sample adding a third adjacent segment, the original LINE records, net, and style were preserved; `drawingOrderChanges` matched the observed change, and effective records matched after save, close, and reopen. This covers only that simple append shape.

The v0.20.35 candidate accepts an SDK-added empty NET plus Relevance on a new WIRE only when no `net` was passed to `create` and geometry and style have already passed. The ATTR header ID must be valid, `parentId` must be the new WIRE, and the key must be NET. Only the NET value and `getter.net` must be empty strings; verify Relevance under its separate rules. Continue strict checks for old WIRE records. Explicitly named segments must match request, source, and getter. `named:false` remains unnamed. An echoed `net` is only an input echo; it does not prove that a separate segment belongs to a net. Do not add a name or label and do not retry. Source and real-fixture regressions passed expert review; host acceptance of the candidate remains pending.

If post-write source IDs and SDK IDs disagree during A08, only resample read-only within the command's remaining total time. On every sample, verify focus, source, and model together. After timeout or a late result, do not read or write again. Bound both initial and later reads. Do not retry create, modify, or delete, and do not continue with later segments. Once IDs agree, still verify all geometry, nets, and styles. If they remain inconsistent, return `partial` with both ID sets and sample times. Check the actual page; do not redraw automatically. Other wire paths require separate acceptance.

**Modify and delete safeguards**

Before changing wires, verify the full target batch and source. Distinguish missing NET attributes, empty NET attributes, and non-empty NETs. In a single SDK call, pass the complete color, width, and line type, using verified original values for properties not requested. Explicitly pass `net:''` for an existing empty NET, and do not add a net name to a wire with no NET attribute. If the getter reports a source NET under the same ID as `Name`, accept it only after checking ID, value, and parent ownership. Reject true Name-only records, duplicate attributes, and conflicts before writing. After each wire and at the end of the batch, verify the objects, source NET attributes, and each LINE's ID, endpoints, and style. On failure, stop and attempt full-page recovery; if recovery is unconfirmed, stop relying on that result. On the current host, v0.20.18 empty-NET single-wire and two-explicitly-same-name batch color changes passed save/reopen. Since v0.20.19, active line-type changes accept only the pre-write-verified values `0/SOLID`, `1/SHORT_DASH`, and `2/DOT`; verify the target code after writing. Single named-wire solid-to-dash-to-dot-to-solid changes each passed save/reopen on the current EDA 4.1.78 host. Complex multi-segment wires have not been accepted. In a P4 host batch sample, only the `strokeStyle` of two named A wires changed from dotted to dashed; a third empty-NET wire and other non-target content remained unchanged, including after save and reopen. The current API cannot express a strict getter filter for `net` on a mix of empty and non-empty NETs; this is not applicable and is not counted as an untested check.

For `schematic.autoLayout`, use it only to arrange an existing functional area. Limit its scope, run `dryRun`, and save before execution. Wires do not move with components; `rewire` deletes and rebuilds related wires. Check wires that were not reconnected, skipped complex wires, and partial movement. On partial failure, inspect `error.cause.moved` and the current state; do not assume rollback.

Before `schematic.delete`, verify target IDs and dependencies and rescan afterwards. On timeout or uncertain readback, stop further deletes. `task.get` can query long-running tasks; a timeout does not mean cancellation. Save, close, and reopen to check deletion persistence.

**Input validation, DRC, and exports**

`schematic.listComponents.allPages` and `schematic.structuralAudit.allPages` must be booleans. `schematic.structuralAudit.ncExempt` must be a string array. `schematic.structuralAudit.deviceMargin` defaults to 10 mil and, when supplied, must be a finite number greater than or equal to 0.

`schematic.exportPng` width and height must be integers from 1 to 4096; omitted values use the command defaults.
`schematic.pruneFloatingLabels.dryRun` and `schematic.fixNetLabels.dryRun` accept booleans only. If omitted, `pruneFloatingLabels` performs cleanup, while `fixNetLabels` previews only.

Since v0.20.29, the candidate also validates `listNets.detail`, `pruneFloatingLabels.allowSourceRewrite`, and `repairNet.dryRun` strictly as booleans, rejecting other values before reading or writing. The existing default behavior of each parameter is preserved. These new checks still await acceptance on a newer host.

Compare expected pins and nets with `schematic.listNets`, `listWires`, `getNetlist`, or `exportNetlist`, then run DRC. `structuralAudit` helps investigate drawing and connectivity; verify the identity of candidate findings such as frame objects. `runDrcDetailed` may report each finding or aggregate it according to the structure actually returned by the host; individual findings were tested on EDA 4.1.78 and must not be inferred from version alone. One initial frame sample also returned `strikeout:false` on 10 ATTR records; keep this as a separate observation and do not relax checks for other objects. The closing audits in `runDrc`, `runDrcDetailed`, and `buildBlock` return “result cannot be determined” for a non-array or unknown DRC structure. `buildBlock` places the reason in `auditError`; do not treat that as a pass. If counts differ between two checks immediately after save, wait for topology refresh and query again.

For `schematic.exportBom(fileType=csv)`, preserve the host's original file bytes. Read returned `format`, `encoding`, and `delimiter` before parsing. On EDA 4.1.78, `.csv` was actually UTF-16LE tab-delimited text, not UTF-8 comma-separated CSV. `fileName` may include the matching suffix or omit it; the plugin avoids adding a duplicate suffix. Confirm XLSX files by their ZIP header. If the format cannot be confirmed, inspect the original file using the returned `note`.

On EDA 4.1, `listNets` uses PADS netlist and named-wire fallbacks. Automatically named nets may be listed, but `detail:true` cannot always associate unnamed wires with the matching auto-net; use `getNetlist` to verify pins. If fallback is unavailable, the command returns an error. Point and region primitive queries require EDA 4.2 or later.

On EDA 4.1.78, `schematic.modifyText` may read back successfully immediately, but its content and position revert after save and reopen. The plugin rejects this command on 4.1.78. It requires EDA 4.2 or later; persistence on 4.2 has not been verified. Region and point primitive queries also require 4.2; see [the low-frequency command list](commands-schematic-low.md#eda-version-limitations) for the exact names.

`getNetlist` and `exportNetlist` may cause the host to update designators or Unique IDs, so do not assume they are read-only. A non-empty export still needs to be parsed. After saving, inspect the full page with `schematic.exportPng` and decode it according to the actual file type; multi-page exports may be ZIP archives. Background `editor.screenshot` may show an old frame. To establish persistence, save, close, reopen, then verify identities, properties, nets, and untouched content.

**Complete component replacement: workflow scope**

AI Command Engine has no single command that completes every part of a component replacement. The replacement model, footprint, and pin mapping must be confirmed jointly by AI and a person. The separate module-reuse plugin performs synchronized schematic and PCB replacement. Its `prepareReplacement`, `executeReplacement`, and `getReplacementOperation` methods use `module-reuse:rpc:v1`, not ACE HTTP commands. Versions with a built-in Gateway start the bridge in the module skill in the background; they do not require separately installing Gateway or AI Command Engine. Copper, keepouts, and custom openings are finishing repairs after reuse. The numbered process above describes using ACE commands alone; if any step has an unknown outcome, stop and inspect read-only first.
