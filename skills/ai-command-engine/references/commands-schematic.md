# Schematic workflow

First use [Connection and setup](setup.md) to verify the window, project, and active schematic page. Choose commands from [high-frequency](commands-schematic-high.md) and [low-frequency](commands-schematic-low.md). Read parameters, return fields, and examples from `/help?cmd=<command-name>` for the verified selected window version; `/help` is not routed by the `instanceId` on a write request.

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

## Modify, organize, and delete

- Verify changes such as `schematic.moveComponent`, `modifyComponent`, `modifyWire`, and `modifyNetLabel` by independent readback, not an SDK boolean. `modifyComponent` submits the complete property object; preserve existing `otherProperty` and do not overwrite project-instance properties with library-device defaults.
- Use `schematic.autoLayout` only to organize an existing functional block. Limit the target and run `dryRun` first; save before executing. Old wires do not follow a moved component; `rewire` deletes and rebuilds related wires. Check wires not reconnected, skipped complex wires, and partial movement. On partial failure, inspect `error.cause.moved` and the current state; do not assume automatic rollback.
- Before `schematic.delete`, verify target IDs and dependencies; rescan after deletion. If a timeout or readback is unknown, stop later deletions. `task.get` can query long-running tasks; a timeout does not mean cancellation. Confirm persistence by saving, closing, and reopening.

## Check and save

Compare expected pins and nets with `schematic.listNets`, `listWires`, `getNetlist`, or `exportNetlist`, then run DRC. Use `structuralAudit` to investigate drawing and connectivity structure; verify the identity of candidate findings such as a frame. On hosts that do not support detailed output, `runDrcDetailed` may return only an aggregate result.

`getNetlist` and `exportNetlist` may cause the host to update designators or Unique IDs, so do not assume they are read-only. Parse any non-empty export. After saving, inspect the full page with `schematic.exportPng` and decode it according to its actual file type; multi-page exports may be ZIP files. Background `editor.screenshot` may be a cached frame. To prove persistence, save, close, reopen, and verify identity, properties, nets, and untouched content.

## Complete component replacement

There is currently no single reliable command that completes every part of a replacement. Combine the existing commands in this order. If any step has an unknown result, stop and inspect read-only first.

1. Back up the native `.epro2` project with `project.exportFile`. Activate the target page and record the old component's ID, designator, position, mirror state, pins, nets, and project properties to preserve. When reading source, verify the active page's `DOCHEAD.uuid`; split header and body at the first `||`; for each `(type,id)`, use the highest `ticket`; an empty body is a deletion tombstone. Do not treat an old record as current state or pass source Y coordinates directly to the public API.
2. Look up the new component's Device, Symbol, Footprint, pins, and part information. The model, manufacturer, and supplier part number must come from the new component; do not inherit them from the old one.
3. Place a new instance at a location that does not reuse the old designator or association IDs. Verify the new resource source, footprint and per-pin numbers, absolute positions, and net mapping. Do not delete the old component if old and new pins cannot be mapped one to one.
4. If business properties must be transferred, use `schematic.modifyComponent` based on the new instance's complete properties. Preserve the new component's resources and system properties; overlay only explicitly required project properties. Preserve existing custom keys in `otherProperty`.
5. Delete the old ID only after the new instance, connections, and required properties are confirmed. Restore only project identities that must be retained, such as the designator, Unique ID, Channel ID, Group ID, or Reuse Block. `setAttribute` cannot fabricate Device, Symbol, or Footprint associations.
6. Recheck the schematic netlist and untouched objects; save, close, and reopen for verification. The user initiates and confirms PCB updates in the EDA interface; AI performs read-only checks before and after.

## Error repair and macros

For label problems, first locate them read-only, then choose `pruneFloatingLabels`, `fixNetLabels`, `repairNet`, or `dedupeWireNets` as appropriate. Use `dryRun` first when supported. A canvas view alone cannot establish whether labels are floating, net names duplicated, or nets fragmented; check the netlist and DRC after repairs. Source rewrite fallback is not a prerequisite for ordinary repairs; consider it only when explicitly needed and after backing up.

Use `macro` only when all steps are known and do not require an intermediate decision. If any step fails or has an unknown result, stop dependent writes. The macro response key for the step collection is `steps`. Submit steps separately when the next action depends on readback.
