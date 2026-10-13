# Standard workflow

## Prepare functional-block layout and pin wiring

- For a drawing with multiple functional blocks, plan their locations, reading order, and title space first.
- Size each block boundary to leave room for the actual symbols, pin leads, labels, and property text.
- Reserve space separately for large modules and components with many pins, based on their actual footprint in the schematic.
- Adjust component spacing for symbol size; do not reuse fixed coordinates from another project.
- Before batch placement, organize part numbers, expected designators, and the pin-to-net table.
- Reuse component data already obtained for the same part number. Prefer batch queries when the current command supports them.
- Identify each pin in the pin-to-net table by component identity and pin number. For multi-unit components, distinguish the unit as well.
- Check the `refMap` returned by `buildBlock`, then compare it with the actual designators and pin wiring.
- List power, ground, signals, and valid NC pins separately. Verify the purpose of any unassigned pin first.
- Prefer direct wires between nearby pins on the same net. When a label is needed, draw a short lead outward from the actual pin connection point.
- Set label spacing based on the current units, text, and nearby pins. Do not apply the upstream 10-unit offset everywhere.
- After generation, check that components, labels, and text stay inside their functional-block boundaries. Adjust the layout or enlarge the boundary as needed.

These requirements guide planning and readback checks. They do not mean `buildBlock` already avoids collisions based on symbol size.
Adjust an existing drawing only within the authorized scope. Do not rearrange the entire drawing just to apply functional-block frames.

Adapted from the [official schematic placement and net lead skill](https://github.com/easyeda/easyeda-enhanced-schematic-skill/blob/main/SKILL.md) (checked 2026-10-10). Only its layout and batch-preparation methods are used here; execution still uses this plugin's commands and existing save/acceptance workflow.

## Draw schematics (prefer batch operations)

1. Run `GET /connections` and verify the window. Include the top-level `instanceId` in every request. Activate the page with `editor.openDocument`; include `params.__docUuid` in page-level requests; read the frame with `schematic.getPageInfo`.
2. **Prefer `buildBlock` for component placement:** use one command per functional block. Use `placeDevice` only for occasional additions. Group components that serve the same function.
3. **Prefer `batchWire` for wiring:** submit a batch in one request. For a single repair, use `labelWire` for one pin or `linkWire` for two pins. Use `connectPin`, `drawWire`, or `placeNetLabel` only for special cases such as buses, multi-point direct connections, or batch recoloring.
4. **Read back and audit:** use `listWires` and `exportNetlist` to audit the pin membership of every net. Do not assume that drawing a wire connected it.
5. Run `runDrc` (it automatically obtains a stable result) and clear all fatal errors. For historical drawings with “multiple net names” warnings, run `dedupeWireNets`.
6. Save with `save`.

## Organize an existing schematic

- Messy components or wires: run `autoLayout` with `dryRun` first and review `plan` and `connections`. Save before the actual run. Afterwards, inspect `moved`, `error.cause` (`partial`, `moved`, `phase`, and `stateDifferences`), `rewired`, and DRC. If some moves fail, stop later writes and inspect the current state. Use `moved` and a backup for controlled recovery; UI undo is not guaranteed.
- Label issues: run `fixNetLabels` as a full check (`dryRun` defaults to `true`). For floating remnants, use `pruneFloatingLabels` (`dryRun` defaults to `false`; explicitly set `true` to preview, then inspect `batches` and `unprocessed`).
- Fragmented nets, such as after manually dragging labels: finish with `repairNet`.

## Component placement and schematic representation (follow project and component requirements)

1. The schematic should make the related power pin or power domain recognizable for each decoupling capacitor. Determine actual connections, capacitance, quantity, and PCB distance from the specific component data and project conditions. A schematic arrangement alone does not imply that same-named power pins must be on separate nets.
2. Clearly show the relationship between input/output capacitors and the related pins. Verify near-component placement on the PCB itself.
3. Prefer actual wires within one functional block and labels across blocks as needed. Mark valid unconnected pins as NC. Do not add an unrequested connection just to remove a visual stub.
4. Avoid wires through symbol bodies, labels over pins, and overlapping text. After moving anything, recheck the nets and intended endpoints.
5. This skill is self-contained; it does not require the user to install the author's separate schematic-layout skill.

## Convert a schematic to PCB

1. Run schematic DRC when the task calls for it and report the result. Ordinary import does not require clearing DRC first.
2. The plugin reads the source schematic and checks component identity, footprint association, and pad nets on the target PCB. If the contents match, `pcb.importChanges` may return success, including when everything was already matched and no changes were needed. If the SDK returns `true` but the changes are not applied, only partly applied, or cannot be confirmed by readback, the result remains `pending-verification`/`unknown`; stop dependent writes and do not automatically retry. The host may still require the user to click “Apply Changes.” This content check still awaits installed-build verification; success does not establish persistence after save/reopen or complete module-layout acceptance.
3. After import, compare pad nets with the netlist using `listComponents` and `getComponentPads` for each component.
4. Placement: move individual components with `moveComponent`; group functional blocks with `groupBySchematicRegions` after checking `dryRun`. ⚠️ DRC does not detect body/silkscreen crowding. After placement, run `checkPlacement`; add `margin` (10–30 mil) for components with large bodies, such as connectors and inductors.
5. Routing: use `routeTrack`; for high-current nets, query `knowledge.widthForCurrent` first. Use `placeVia` and `pourCopper` for a full-board ground pour. For large jobs, use the autorouting workflow; lock power nets first (see appendix ⑦ in commands-pcb.md).
6. Run `runDrc`, report violations, and save.

## Closeout discipline

Save at each stage. Before a destructive operation, verify the target ID and keep a backup (the proxy automatically backs up `.epro`, or manually use `project.exportFile`). Treat readback as the source of truth for all changes; even a response containing `readback` should not be trusted from a single value alone.

## Full operating rules

1. **Inspect before drawing:** before changes, use `project.getInfo` and `listComponents` to understand the current state.
2. **Verify the target before activation:** include the top-level `instanceId` in every request; do not use `/select` as a substitute. Call `editor.openDocument` before `schematic.*` or `pcb.*`.
3. **Batch with `macro`:** combine more than two steps into one macro.
4. **Always read back after drawing:** audit wires with `listWires`, nets with `exportNetlist`, and PCB nets with `getComponentPads` item by item. Do not assume success.
5. **Save at each stage.**
6. **Run DRC when required and report it truthfully.** DRC reports design issues; it is not an extra prerequisite for ordinary import commands.
7. **Do not blindly retry:** read `error.message` and `suggestion`, correct the request, then send it. After the same command fails three times consecutively, stop and choose another approach.
8. **Check the knowledge base first for engineering guidance:** query `knowledge.query` for impedance, length matching, or current capacity, then follow its `constraints` and `guidance`.
9. **Handle extension development separately:** use this plugin's commands for ordinary drawing. Native API debugging is not part of this skill's installation workflow. The 49620 gateway once used by the author is not included in this repository; do not assume the user has it or run code through it.
10. **Stay within the command's authorization scope:** do not repair, delete, or restore beyond the scope of the invoked command. If `dedupeWireNets` or `autoRouteStatus` fails after writing, it attempts a full-page snapshot restore and readback; if recovery fails or is unconfirmed, the command still reports an error and does not guarantee recovery. `autoLayout` does not recover automatically. Some official creation APIs can falsely fail (return empty even though the object was created); trust the document's actual contents, not just the response.
