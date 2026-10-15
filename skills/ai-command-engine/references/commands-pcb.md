# PCB Command Reference

> The tables and parameter objects on this page describe commands and `params`; they are not complete HTTP requests. A `/command` request must include outer `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

**① Placement → ② Routing → ③ Structure and layers → ④ Checks, import, and export → ⑤ Primitive read/write**, with **⑥ Less common topics (length-matching groups, stackup, real-time DRC) → ⑦ Autorouting workflow** in the appendices. See [pitfalls.md](pitfalls.md) for pitfalls.

## ① Placement

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.listComponents` | List components | `layer?` |
| `pcb.moveComponent` | Move/rotate by ID or designator (atomic internal steps + readback verification) | `primitiveId` or `designator`, `x?`, `y?` |
| `pcb.getComponentPads` | Read pads (number/net/coordinates/shape); **verify nets after import** | `primitiveId` |
| `pcb.checkPlacement` | Check spacing by pad bounding boxes; report overlap/insufficient spacing and body dimensions. ⚠️ DRC does not detect body collisions; always run after placement. | `minClearance?`, `margin?`, `designators?` |
| `pcb.groupBySchematicRegions` | **[Macro; only automatic placement command]** Group PCB components using schematic regions (since 0.10.55, replaces removed `autoPlace`; append-only source pipeline) | `pageUuid?`, `dryRun?`, `origin?`, `boardSize?`, `gap?`, `groupGap?` |
| `pcb.sourceRollback` | List/restore source backups | `list?`, `backupId?` |
| `pcb.delete` | Delete primitives (hardening equivalent to `schematic.delete`) | `primitiveIds`, `batchSize?` |

- **DRC checks copper clearances, not component bodies or silkscreen overlap.** Large bodies such as connectors and electrolytic capacitors can collide even when DRC passes. `checkPlacement` uses pad bounding boxes; approximate large bodies with `margin` (10–30 mil).
- `pcb.checkPlacement` uses conservative enclosing boxes for rotated rectangles, ellipses (including circles), and capsule pads. NGON uses its circumcircle's bounding box. Bounding boxes retain fractional values. If a shape is unsupported or pad data is invalid, the entire component is skipped and listed in `skippedUnsupported`, with `complete:false`. Components without pads are listed in `skippedNoPads` and also make the check incomplete.
- **`groupBySchematicRegions`:** Reads regions from all pages (or only `pageUuid`), assigns components by designator-text position, and assigns overlapping regions to the smallest area. Within groups, designator prefixes are placed in rows (U>R>C>L>D>Q>other). Shelf packing forces groups inside the board outline; if they do not fit, it errors with diagnostics (board width/height, usable width, `rowLimit`, and each group's bbox). The layout engine is a port of the original official algorithm (validated on an X86 motherboard): groups are shelf-packed horizontally in ascending estimated area (rowLimit=min(official value, usable width), 120 group gap), with greedy obstacle avoidance at gap 10/15; R/C/L are forced to angle=0. Existing components are obstacles using measured bboxes; if they cannot be avoided, `blockedBy` is recorded and the gate errors. Measurement uses a three-tier chain (footprint source → measured → fallback); placements include `measured/measureSource` (fallback dimensions may be inaccurate). Group borders and names are generated on the document layer with `spg_` prefix (layerId=13); repeated runs clear previous output, then audit source readback. **Five-step pipeline:** versioned backup (keep five files under `backups/<project>/<timestamp>.txt`) → write source → compare readback (tolerance 0.001) → restore the whole source on failure → save only if all checks pass. **`dryRun` defaults to true.** ⚠️ Before calling, focus the PCB; during execution the tool briefly switches to the schematic to read it, then switches back. (Since 0.10.55 this is the only automatic placement command; `autoPlace` was removed.)
- **`sourceRollback`:** `list:true` lists backups; otherwise restore the latest or the selected `backupId`. It verifies `pcbUuid` before restoring, then reads back and saves.
- **`pcb.delete`:** Hardening equivalent to `schematic.delete` (type identification + post-delete readback + 8 s circuit breaker + circuit break after 3 consecutive failures + `batchSize` 10 + 100 s budget + final reconciliation + `sessionHealth` probe + progress query via `taskId`).

## ② Routing

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.routeTrack` | Route tracks (automatically split polyline segments) | `net`, `points`, `layer?`, `width?` or `currentA?` |
| `pcb.placeVia` | Place a via | `net`, `x`, `y`, `holeDiameter`, `diameter` |
| `pcb.pourCopper` | Create a rectangular copper-pour boundary; does not guarantee fill synchronization | `net`, `layer?`, `x`, `y`, `width`, `height` |
| `pcb.getFanoutPlan` / `pcb.fanout` | Read-only planning, then create pad fanout tracks and through vias from the plan | Planning parameters; execute with the full `plan`; see [geometry command reference](commands-geometry.md) |
| `pcb.getAutoCopperPlan` / `pcb.autoCopper` | Read-only planning, then create local copper pour or fixed fill from the plan | Planning parameters; execute with the full `plan`; see [geometry command reference](commands-geometry.md) |
| `pcb.rebuildPour` | Rebuild copper-pour fill and read it back | `primitiveId?` (omitted = whole board) |
| `pcb.listLines`/`listVias`/`listPours` | Read back for inspection (`listPours` accepts `withFill:true` to read fill status) | `net?` |
| `pcb.listNets` | List all nets | None |
| `pcb.importAutoRouteSes` | Import and apply autorouting results from SES | `base64` (required Base64 SES contents), `fileName?` (default `autoroute.ses`) |

- With `pcb.listPours` and `withFill:true`, the result includes `filled:boolean|null`, `fillStatus:filled|empty|unknown`, and may include `fillRegions`, `fillPrimitiveId`, and `fillReadError`. No fill regions, or an empty `PourFills` array on a valid fill object, returns `false/empty` with zero regions. Return `true/filled` only when a valid fill object has a non-empty region array. Read failure, timeout, invalid object structure, or invalid array elements return `null/unknown` with an error; do not interpret `null` as unfilled.
- A successful `pcb.routeTrack` returns `segmentIds`. If a segment error after writing starts is caught by the handler, `error.cause.partial=true` includes `segmentIds`, one-based `failedSegmentIndex`, `failedSegmentAttempted`, `unprocessedSegments`, and `phase`. `failedSegmentAttempted:true` means the failed segment was sent and may have taken effect; `unprocessedSegments` counts only later segments. `false` means it was not sent and the count includes that segment. The outer generic circuit breaker may return only generic `partial`, without segment fields. Even when the final segment returns a valid ID, shared-budget exhaustion may conservatively return `partial`; known IDs are retained, which does not prove a segment is missing or was not applied. Failure does not auto-rollback or retry; the macro stops. Read back the actual state before deciding on further writes.
- Fanout and local auto-copper both require a read-only planning command first, then the full returned object as execution command `params.plan`. See [geometry command reference](commands-geometry.md) for both plans, execution details, limits, and evidence.
- **0.10.87 live-test scope (2026-10-08):** On an isolated PCB, verified copper fill empty→filled, 45° rectangular and circular pad bounding boxes, and three-segment routing. Tracks and fill persisted after save, close, and reopen; existing components and tracks were unchanged. Non-circular ellipses, OVAL, NGON, unknown shapes, and fault/timeout branches have only local simulated regression coverage. This does not establish support for all shapes or production acceptance.
- **`rebuildPour` (0.10.82 source):** Single-pour, whole-board, and per-pour rebuilds share the existing total budget. Timeout, rejection, or unknown post-write readback returns failure with `error.cause.partial=true` and stops later rebuilds and macro writes; old fill cannot be used to conceal this error. `completed` means only that the call returned without error and a valid readback showed fill; `freshnessVerified:false` means freshness, saved state, and manufacturing suitability are unverified. Timeout does not mean cancellation: inspect read-only first and do not retry blindly. Host installation verification must be reported separately.
- For high current, use `knowledge.widthForCurrent` to calculate trace width (`currentA?` lets the plugin calculate from IPC-2221); prefer a full-layer pour for GND.
- See Appendix ⑦ for the autorouting workflow (lock power nets → FreeRouting → apply results).
- See Appendix ⑥ for length-matching groups.
- Routing practice: inspect autorouted tracks; repair unsuitable local sections with `pcb.delete` + `routeTrack`.

## ③ Structure and layers

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.drawOutline` | Draw a rectangular board outline (⚠️ `x,y` are the **lower-left corner**; the official API uses the upper-left and the plugin converts internally) | `x`, `y`, `width`, `height` (mil) |
| `pcb.getPrimitivesInRegion` | Scan a region (semantics: left<right, top>bottom) | `left/right/top/bottom` |
| `pcb.getPrimitiveAtPoint` | Query at a point | `x`, `y` |
| `pcb.listLayers` | List all layers | None |
| `pcb.getCurrentLayer` / `pcb.selectLayer` | Read/select the active layer | select: `layer` (layer ID, `top`/`t`, `bottom`/`b`, and broad layer aliases such as `inner2`/`inner-2`/`inner_2`; numeric inputs retain existing behavior) |
| `pcb.setCopperLayers` | Set copper-layer count (2/4/6…; ⚠️ affects stackup; use care) | `count` |
| `pcb.setLayerVisible` / `setLayerLocked` | Show/hide or lock layers | `layers[]`, `visible?`/`locked?` |
| `addCustomLayer` / `removeCustomLayer` / `modifyLayer` / `setPcbType` | Custom layers and board type (rigid NORMAL / flexible FPC; ⚠️ adding/removing layers reloads the document; call `openDocument` again; the guard recovers automatically) | Layer name/board type |

- Do not assume the board outline is a Region. In the 2026-10-10 isolated live test, `drawOutline` created a Polyline on the outline layer, source type POLY. Before handling duplicate outlines, verify the actual type and primitive ID, then operate only on confirmed objects.
- `getPrimitivesInRegion` **does not return silkscreen text** (it returns copper primitives such as Line/Via/Pad/Region).
- **Layer parameters are strict:** unknown layer names/IDs error and list legal values; there is no silent fallback. Defaults apply only when omitted. Legal values: top(1)/bottom(2)/top-silk(3)/bottom-silk(4)/top-mask(5)/bottom-mask(6)/top-paste(7)/bottom-paste(8)/top-assembly(9)/bottom-assembly(10)/outline(11)/multi(12)/document(13)/mechanical(14)/inner1~32(15~46)/custom1~200(71~270). Numeric strings are also recognized.
- See Appendix ⑥ for multilayer stackup configuration.

## ④ Checks, import, and export

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.runDrc` | DRC | |
| `pcb.runDrcDetailed` | Per-item details (official tree groups are flattened into type/rule/message/net/primitiveId/x/y; `raw` is preserved; aggregates `fatalCount/warnCount`) | |
| `pcb.runDfm` | JLCPCB order DFM check (18 items; material, board thickness, and selected outer/inner copper weight are required) | `material`, `thickness`, `outerCopperOz`, `innerCopperOz` |
| `pcb.runSmtDfm` | JLCPCB SMT order DFM check (7 items; economy/standard option and board thickness are required) | `standard`, `thickness` |
| `pcb.checkSameNetPadSpacing` | Same-net pad spacing check (1 item) | `minSpacingMm` |
| `pcb.importChanges` | Existing native import command. For this workflow, the user must start and confirm the import in the EDA interface; AI must not call this command or the official import API. | |
| `pcb.save` | Save (⚠️ the official API returns false when there are no changes; this is not a failure) | |

See [JLCPCB order DFM notes](commands-dfm.md) for parameters, copper-weight inputs and drawing comparison, result completeness, and limits. Copper-weight parameters in 0.10.92 were checked against local and live commands; menu location and export dialog remain pending live acceptance.

- Run schematic DRC when the task calls for it and report the result; an ordinary import does not require clearing DRC first. The user starts and confirms schematic-to-PCB import in the EDA interface. AI does not call `pcb.importChanges` or the official import API. Before and after the user action, AI may perform read-only checks, including component identity, footprint association, pad nets, and netlist. The user action is required even when the plugin command exists in the installed API.
- After the user confirms import, compare pad nets and netlist using `listComponents` plus `getComponentPads` for each component. Read-only checks do not apply changes, and a successful readback does not by itself prove save/reopen persistence or acceptance of a complete module layout.
- Earlier candidate notes said the new content check awaited installation testing; that was the status before version 0.10.150 host acceptance. Installed version 0.10.150 passed the normal matching-content case on 2026-10-15 (details below), but this did not test newly applied changes. Version 0.20.0 remains uninstalled and has not been host-tested.
- `runDrcDetailed` sometimes recovers after a single timeout; retry before deciding the plugin failed. The same applies to occasional `editor.openDocument` page-switch timeouts.
- `project.renameBoard` matches by name and can change the wrong board when names collide. Run `project.getBoardInfo` before renaming.

## ⑤ Primitive read/write

| Command | Description |
| --- | --- |
| `pcb.modifyLine`/`modifyVia`/`modifyPour`/`modifyString` | Modify tracks/vias/pours/silkscreen (separate steps + readback verification) |
| `pcb.placeString`/`listStrings` | Place/read silkscreen text |
| `pcb.getPrimitivesInRegion`/`getPrimitiveAtPoint` | ⚠️ Do not find silkscreen text; region semantics are left<right, top>bottom |

- **`modifyPour` `order` (0.10.89 candidate):** After each item is written, independently read PCB source and verify `sourceOrder`; acceptance requires the source readback to match the requested value. `apiPriority` is auxiliary only. The host API's positive `setOrder` is an insertion position, not a direct source `order` setter: applying priority 1 to original order `[2,3]` can still read back `3`. When querying with `get`/`getAll`, source `order:0` falls back to `maxOrder+1`; switching to these query methods cannot fix that behavior. Source readback can verify `order:0`, but arbitrary order cannot be guaranteed.
- If any item throws, returns empty, has failed source readback, or mismatches, stop subsequent items immediately and return `error.cause.partial=true` with `attemptedFields`, `verifiedFields`, `unverifiedFields`, `notAttemptedFields`, `readback`, and `sourceOrders`. `readbackStatus` / `sourceOrdersStatus` of `lastKnown` refers only to an earlier observation. If post-write readback fails or arrives late, do not retain a current “verified” flag. The command uses its existing total timeout; a timeout cannot cancel a modification already sent, but no later reads or writes are issued. Do not auto-retry; inspect read-only using the returned fields first. The candidate does not guarantee arbitrary `order`, repair the host sorting algorithm, auto-delete/recreate, normalize or reorder other pours, or auto-save. Local simulated regression passed. On 2026-10-09, an isolated project verified source order 0/1, nonzero→0, stop on inconsistent combined fields and macro stop, plus persistence after save/close/reopen. A priority of 99 that read back as 3 returned partial; this does not mean arbitrary order values are attainable. The current host's `getCurrentLayer` is an empty implementation. This run verified `inner2` and numeric 15 through an independent UI-active marker; a `null` result alone cannot indicate selection failure.

Calls still use the ordinary `/command` envelope; the plugin independently reads source after writing:

```json
{
  "instanceId": "current PCB window ID",
  "cmd": "pcb.modifyPour",
  "params": { "primitiveId": "target pour ID", "pourPriority": 1 }
}
```

The plugin checks `sourceOrder` using an independent source readback. If `error.cause.partial=true` is returned, the macro has stopped. Use `project.getDocumentSource` to inspect the current state read-only; do not resubmit.

## ⑥ Less common topics (consult when needed)

### Length-matching groups

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.createEqualLengthGroup` | Create a length-matching group | Group/net name |
| `pcb.listEqualLengthGroups` | List all length-matching groups | None |
| `pcb.addNetToEqualLengthGroup` / `removeNetFromEqualLengthGroup` | Add/remove nets in a group | `name*`, `nets*` |
| `pcb.renameEqualLengthGroup` | Rename a group | `oldName*`, `newName*` |
| `pcb.deleteEqualLengthGroup` | Delete a group | `name*` |

### Stackup configuration (multilayer-board stackup entry point)

Read/modify/write: read back with `getStackingConfig` → modify the `configuration` object → write with `applyStackingConfig`.

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.listStackingConfigs` | List all stackup configurations (including active and default names) | None |
| `pcb.getStackingConfig` | Read a full configuration (layer order/thickness/dielectric; omit `name` for active configuration; ⚠️ on a two-layer board, empty `list` and `get` returning null are official behavior) | `name?` |
| `pcb.applyStackingConfig` | Apply a configuration object to the current PCB | `configuration*` |
| `pcb.saveStackingConfig` | Save as a named configuration | `configuration*`, `name*`, `allowOverwrite?` |
| `pcb.renameStackingConfig` / `deleteStackingConfig` / `setDefaultStackingConfig` | Rename/delete/set default | rename: `oldName*`,`newName*`; delete/setDefault: `name*` |

### Real-time DRC

| Command | Description |
| --- | --- |
| `pcb.startRealTimeDrc` | Start real-time DRC (report violations while routing; ⚠️ official `@beta`) |
| `pcb.stopRealTimeDrc` / `getRealTimeDrcStatus` | Stop/read status (requires EDA v4.2+; older versions always return `enabled:false`) |

## ⑦ Autorouting workflow (FreeRouting)

⚠️ **Standard sequence (power first):** ① AI routes main power paths with `pcb.routeTrack`/`pourCopper` according to the knowledge base → ② lock power nets with `pcb.setNetLock` (when `autoRouteStatus` completes, automatic SES application clears all **unlocked** tracks, arcs, and vias; unlocked power routes will be removed) → ③ start with `pcb.autoRouteStart` → ④ poll `pcb.autoRouteStatus` (completion automatically applies SES and runs DRC) → ⑤ AI reviews tracks; repair unsuitable local sections with `pcb.delete` + `routeTrack`. This clearing scope applies only to this autoroute-status workflow; it does not mean ordinary `importAutoRouteSes` manually clears tracks.

Prerequisite: run a local FreeRouting V2.2.3+ service on port 37864. Run `bridge/start-freerouting.bat` to start it.

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.setNetLock` | Lock/unlock all tracks/vias/arcs on selected nets (protect power traces before routing) | `net` or `nets`, `locked?` |
| `pcb.autoRouteStart` | Start autorouting (export DSN → FreeRouting service → start job) | `maxPasses?`, `viaCosts?`, `maxThreads?`, `skipDrc?` |
| `pcb.autoRouteStatus` | Read progress; on COMPLETED automatically clears unlocked tracks, applies SES, runs DRC, and returns statistics | `jobId?`, `noImport?` |
| `pcb.autoRouteStop` | Stop a job (keep current result) | `jobId?` |

- **0.10.106 candidate:** `autoRouteStart` returns only `outcome:start-request-submitted,stateVerified:false`; it no longer describes a submitted request as RUNNING. If the start call fails, it still retains `jobId` and returns partial, `retryable:false`; do not resubmit. First query the original job or cancel it and verify its state. Use `autoRouteStatus` with `noImport:true` to read actual status first; allow applying results only after confirming the target and contents. Local regression passed; the candidate is not installed yet.
- In this run, a DSN from EDA 4.1.71 containing existing routes caused stack overflow in FreeRouting 2.2.3 and was not applied. Do not treat a native host autorouter fix as proof that this plugin workflow passed.


## Footprint identity checks and historical acceptance

Footprint verification requires the netlist project's footprint UUID, the PCB's effective `Footprint` property, and the epro resource `HEAD.uuid` to agree. An SDK reference must fully match either the project footprint UUID and current project UUID, or the source-footprint UUID and source-library UUID in the resource record. Names or matching geometry do not establish resource association. Reject a wrong library, conflicting property, or missing resource. Do not create a mapping for unrelated resources that lack a valid `HEAD`/source; they do not block this check.

Version 0.10.150 corrected a comparison that mixed project-footprint UUIDs with source-library UUIDs. Its final source dated 2026-10-15 passed 14 regression checks, type checking, targeted lint, expert review, and read-only checks of five real components through the official API.

On 2026-10-15, installed version 0.10.150 passed the formal `pcb.importChanges` command in a dedicated test project: `contentsVerified` and `completionVerified` were true, all five managed components matched individually, `differences` was empty, and PCB-only items were retained. This tested the normal matching case for synchronized content; it did not show newly applied changes. After `save:true` and a real close/reopen, all valid record fields matched except the DOCHEAD time/version; the R2 pad and net remained. The earlier F09 partial result and five rule/display observations remain. Full-page visuals, rule semantics, and manufacturing output were not accepted. The test page was closed, and the 0.10.150 package retained its original SHA without repacking the same version.

Version 0.20.0 removes `schematic.getComponentUpdatePlan` and `schematic.updateComponents`. Those commands are unavailable in this version; complete replacement uses existing atomic commands and the workflow described by the current installed help. The 0.10.150 host evidence above applies only to that earlier installation and does not establish host testing of 0.20.0.
