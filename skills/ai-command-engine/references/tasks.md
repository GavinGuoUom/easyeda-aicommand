# Choose commands by goal (quick reference)

Choose a command sequence by **what you want to do**, not by object type. **Run the sequence from left to right.** `list*` and `get*` commands are read-only and safe for exploring the current state. See the relevant command reference for parameters; if unsure, query `GET /help?cmd=<name>`.

## A. Read-only inspection and acceptance (does not change the drawing)

| Goal | Command |
| --- | --- |
| Audit a full page for bridges, wrong-net labels, collinear overlaps, duplicate designators, floating labels, isolated wires, crossings, region frames, and components touching or outside their regions | **`schematic.structuralAudit`** (call `editor.openDocument` per page, then this command; `blocking=0` means structural legality, not design intent) |
| Audit the pins connected to a net (final connectivity check) | Compare each net using `schematic.exportNetlist` or `getNetlist` |
| Check all labels for floating, duplicate, reversed, or misplaced labels | `schematic.fixNetLabels` (`dryRun` defaults to `true`; inspect the report first) |
| Finish DRC | `schematic.runDrc` (automatically runs twice to obtain a stable result); use `runDrcDetailed` for details (requires EDA v4.2+) |
| Identify a wire or primitive | `schematic.listWires`, `getPrimitiveAtPoint`, or `getPrimitivesInRegion` |
| Check PCB-version DRC | `pcb.runDrc`, `pcb.runDrcDetailed`, or `pcb.getRealTimeDrcStatus` |
| Check component collisions and board-edge violations after PCB placement | `pcb.checkPlacement` (use `margin` of 10–30 mil for large bodies) |

## B. Draw a new schematic or add a functional block (prefer batch operations)

| Goal | Command |
| --- | --- |
| Draw a functional block from scratch | `schematic.buildBlock` (component list and connection table in one command; inspect `refMap` and `wireAudit`) |
| Batch-add components and wiring to an existing drawing | `schematic.placeDevice` for occasional placement plus `schematic.batchWire` for wiring in one batch |
| Connect one pin to a named net (power/signal stub) | `schematic.labelWire` |
| Physically connect two pins | `schematic.linkWire` |
| Draw special wiring by hand (bus/multiple points) | `schematic.drawWire` (⚠️ do not pass `net`; use `placeNetLabel` to name it, and do not name it in both places) |
| Draw a functional-region frame and title | `schematic.placeRegion` |
| Verify after drawing | Read back with `listWires` and `exportNetlist`, run `runDrc`, then call `schematic.save` |

## C. Organize a messy existing drawing

| Goal | Command |
| --- | --- |
| Rearrange messy components/wires | `schematic.autoLayout` (**run `dryRun` and review `plan` first**, then confirm and run; save first) |
| Remove floating labels | `schematic.pruneFloatingLabels` (run in batches; do not increase `batchSize`) |
| Repair a net fragmented by manually dragging labels | `schematic.repairNet` |
| Clear a historical “multiple net names” warning | `schematic.dedupeWireNets` |
| Delete primitives | `schematic.delete` (hardened with type recognition, post-delete readback, and final reconciliation; keep the default batch size) |

## D. Manage projects and schematic pages

| Goal | Command |
| --- | --- |
| View the project document tree (obtain UUIDs here) | `project.getInfo` or `project.list` |
| Switch projects | ⚠️ Call `schematic.save` first; `project.open` fails when there are unsaved changes. |
| Rename a schematic page | `project.renameSchematicPage` (⚠️ the target page must have been opened and saved once in this window, or the official API may falsely fail; see pitfalls) |
| Delete, copy, or reorder a page | `deleteSchematicPage`, `copySchematicPage`, or `reorderSchematicPages` |
| Back up or migrate a project | `project.exportFile` (save the `.epro2` base64 to disk yourself) |
| Import an external file | `project.importFile` (🔴 overwrites and cannot be rolled back; back up first) |

## E. Convert schematic to PCB

1. Run schematic DRC when the task calls for it and report the result. Ordinary import does not require clearing DRC first. A failed or uncertain import stops dependent work; do not retry automatically.
2. The plugin reads the source schematic and checks component identity, footprint association, and pad nets on the target PCB. If the contents match, `pcb.importChanges` may return success, including when everything was already matched and no changes were needed. If the SDK returns `true` but the changes are not applied, only partly applied, or cannot be confirmed by readback, the result remains `pending-verification`/`unknown`; stop dependent writes and do not automatically retry. The host may still require the user to click “Apply Changes.” This content check still awaits installed-build verification; success does not establish persistence after save/reopen or complete module-layout acceptance.
3. Reconcile pad nets with `pcb.listComponents` and `pcb.getComponentPads` for each component.
4. Placement: use `pcb.groupBySchematicRegions` after `dryRun`, or `pcb.moveComponent`; then run `pcb.checkPlacement`.
5. Routing: use `pcb.routeTrack` and `pcb.placeVia`; query `knowledge.widthForCurrent` first for high-current nets. Use `pcb.pourCopper` for a full-board ground pour.
6. Run `pcb.runDrc`, clear violations, and save with `pcb.save`.

## F. PCB-specific work and manufacturing exports

| Goal | Command |
| --- | --- |
| Query trace width, current capacity, impedance, or length matching | `knowledge.query` or `knowledge.widthForCurrent` (query before drawing) |
| Differential pairs, length-matching groups, or net classes | `pcb.createDiffPair`, `createEqualLengthGroup`, or `createNetClass` (see [commands-net.md](commands-net.md) for the full list) |
| Multilayer stackup | `pcb.applyStackingConfig` or `getStackingConfig` |
| Use autorouting for a large job | Workflow: `exportDsn` → external routing → `importAutoRouteSes` (lock power nets first; see appendix ⑦ in commands-pcb.md) |
| Export manufacturing data | `pcb.exportGerber`, `exportPickPlace`, or `exportNetlist`; for schematic BOM use `schematic.exportBom` |

## G. Reuse blocks, build libraries, and select parts

| Goal | Command |
| --- | --- |
| Save a completed block as a reusable module | `cbb.create`, `cbb.placeSchematicPage`, or `cbb.placePcb` (see [commands-cbb.md](commands-cbb.md)) |
| Create symbols, footprints, or devices | `lib.symbolCreate`, `lib.footprintCreate`, or `lib.deviceCreate` (⚠️ UUID changes after modify; verify by name. See [commands-lib.md](commands-lib.md).) |
| Search JLCPCB parts | `library.searchDevice` or `library.getDeviceByLcsc` |
| Find SMT-assemblable parts | `knowledge.listRules` plus `knowledge.query` |

## H. Troubleshoot and check progress

| Symptom | Action |
| --- | --- |
| Client timed out | A timeout does not mean cancellation. Use `task.list` or `task.get {taskId}` to check background progress and retrieve the result. |
| Command failed | Read `error.message` and `suggestion`, correct the request, then retry. After the same command fails three times consecutively, stop and choose another approach. |
| All creation commands fail, but reads work | The session may be damaged. Do not save; close and reopen the page to restore it. |
| A success response is not trustworthy | Use readback or a source rescan; official APIs can falsely report success or failure. |
| Behavior is uncertain | Run `dryRun` or a read-only `list` first to inspect the current state, then use a write command. |

## I. Report and capture screenshots

| Goal | Command |
| --- | --- |
| Show a canvas screenshot to the user | Use `editor.screenshot` or `editor.zoomToRegion` followed by a screenshot (⚠️ when the window is in the background it captures a cached frame; identical bytes on consecutive captures mean the image is untrustworthy; see pitfalls K9) |
| Export a full-page schematic PNG (**preferred for visual acceptance**) | `schematic.exportPng` (returns a base64 ZIP of every page; unzip first. Works in the background; see K10) |
| Check which pages are open | `editor.listTabs` |
| **Inspect each candidate issue and confirm layout with screenshots** | Recipe: get issues from `schematic.structuralAudit`; for each candidate, send its `coords` to `editor.zoomToRegion {x1,y1,x2,y2}` (coordinates are centered; frame ±150 mil), then save the `editor.screenshot` as evidence. Confirm the window is in the foreground; otherwise use `exportPng` to inspect the full page. For multiple issues, chain zoom/screenshot pairs in one `macro` (`steps` alternates zoom and screenshot), then inspect each image to confirm that components do not collide, wires do not overlap labels, and functional blocks are separated. |
