# Schematic Command Reference

> The tables and parameter objects on this page describe commands and `params`; they are not complete HTTP requests. A `/command` request must include outer `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

Four groups: **① batch generation and organization (primary entry) → ② basic commands → ③ repair and maintenance → ④ query, inspection, and export**. See [pitfalls.md](pitfalls.md) for the complete pitfalls list.

## ① Batch generation and organization (primary entry)

### Replace a footprint in place and batch-update properties

Use these commands to retain schematic components while updating their footprint association, part identity, or purchasing attributes. They support changes such as 0603 to 0402, batch updates to resistance/rating/manufacturer/part number, and edits to module instances already placed in the project.

A footprint update preserves the component ID, designator, unique ID, symbol, and schematic position; it does not delete and recreate the component. Changing the entire part or symbol also requires handling pins and wires, which these two commands do not do.

Testing history: v134 verified batch property updates to two existing components, loading an external 0805 resource, in-place association, and save-close-reopen; actual PCB pad dimensions and net mapping were correct. In v136, a new component property update returned full success and passed save-close-reopen. In v138, the in-place footprint change and two property writes passed save-close-reopen; after native confirmation for PCB import, actual pad dimensions, nets, and save-close-reopen passed. The final check falsely reported failure because the host added a footprint name; v139 accepts only UUIDs and names matching the verified resource. v142 passed default-configuration checks and the 0805 association plus two properties passed save-close-reopen, but final receipt stopped because the host retained the old footprint name. In v143, updates to two components and a real combined 0402-to-0805 update returned success; names were correct and save-close-reopen passed. `footprintNameRepairs` was empty because the host refreshed the name normally. The new old-name fallback branch passed regression only and was not triggered separately on the host. A native confirmation dialog during PCB import was applied manually and does not count as automatic synchronization success.

| Command | Purpose | Parameters |
| --- | --- | --- |
| `schematic.getComponentUpdatePlan` | Read-only listing of footprint and property changes | `items:[{primitiveId,footprint?,properties?}]` |
| `schematic.updateComponents` | Execute and read back each item | `plan`: the complete `data` object from the planning response |

Workflow: activate the target schematic → inspect components and target footprints → create the plan → execute → save. To update the PCB, separately synchronize with the existing `pcb.importChanges` and verify actual footprints, pad nets, and tracks.

The plan does not import library resources. During execution, the plugin creates or reuses helper devices in the current project library to load the target footprint; it does not delete, recreate, or add helper devices to the schematic. Helper library devices and any required empty symbols remain in the project library; the result reports their UUIDs. `copiedResources[].normalizedDefaultRecords` lists known default settings excluded from comparison; all other records are still checked. `footprintNameRepairs` records old cached names before and after repair, source writes, and read-back state.

`primitiveId` must come from the current schematic. `footprint` is an explicit `{uuid,libraryUuid}` from footprint search or a target library device's footprint association. Pass only fields to change in `properties`; the plugin preserves all other properties. Supported fields are `manufacturer`, `manufacturerId`, `supplier`, `supplierId`, `name`, `designator`, `addIntoBom`, `addIntoPcb`, and `otherProperty`. Put custom fields such as resistance, tolerance, and voltage rating in `otherProperty`; these fields are merged rather than replacing the full property object. One item may change its footprint and properties together, and one plan can include multiple items.

Example plan parameters:

```json
{"items":[{"primitiveId":"current resistor ID","footprint":{"uuid":"target 0402 footprint UUID","libraryUuid":"target library UUID"},"properties":{"otherProperty":{"Resistance":"10k","Tolerance":"1%"}}},{"primitiveId":"another device ID","properties":{"manufacturerId":"new manufacturer part number"}}]}
```

Build the execution request as `{instanceId:currentInstanceId,cmd:"schematic.updateComponents",params:{plan:planResponse.data}}`. A successful result confirms the schematic update and immediate read-back only; persistence and PCB synchronization require separate checks. `copiedResources` retains its existing field names and reports imported or reused footprints, helper devices, source, and verification scope. Library-source content, project-resource presence, and old-format serialized geometry are reported separately; resource presence does not prove arbitrary pin mapping. Partial failure identifies imported resources, updated items, and skipped items. If a write is unknown, inspect read-only before retrying; do not reuse the old plan.
### `schematic.buildBlock` — Generate a functional block from scratch

Components list + connection table → auto region frame (default origin 0,0, black dashed; `color`/`lineType` can override) → row/column placement (cw32 template: 60 horizontal spacing, 90 row spacing; title centered at the bottom of the frame, font size 20) → wire from `nets` → netlist and DRC self-check.

| Parameter | Description |
| --- | --- |
| `components` | Component list (`lcscId` + custom `ref`) |
| `nets` | Connection table. Refer to pins by the list's `ref` (for example, `"U1.7"`; **not the EDA-generated designator**). The plugin maps `ref` to designators and returns `refMap`. |
| `region?` `title?` `color?` `skipAudit?` | Region origin/title/color/skip netlist audit |

- User refs are automatically assigned as actual designators (`"R?"` is rewritten and read back; failures include `designatorNote`).
- Wiring uses the `batchWire` engine: two-pin non-power nets use an unnamed U-shaped `link`; nets with ≥3 pins, power nets (VDD/VCC/GND and suffixes after underscores that are **all uppercase**, e.g. VDD_T, VOUT_5V; lowercase suffixes count as signal nets), or explicit `style:"label"` use a short label stub per pin. Per-net color is passed through.
- Errors are collected per item without stopping; a single unified netlist audit runs at the end (details in `wireAudit`). **Always inspect:** `refMap`, `designatorNote`, `incomplete`/`failed`/`wireAudit`.
- Rule-based grid placement is roughly 80/100 visually; use `moveComponent` to refine after generation.

### `schematic.autoLayout` — Organize an existing functional block

Rearrange placed components and rebuild their wiring. Select components using exactly one of `designators` or `region`.

Flow: export netlist and derive connections (skip NC/floating pins) → greedily sort network clusters and place in rows/columns (60 horizontal spacing, 90 row spacing; `template` can change this) → safely move components (read back geometry and check other state) → **rewire (on by default):** delete wires touching old pins (labels are cascade-deleted) + remove floating labels + convert connection table to `batchWire` rebuild.

- **`dryRun` defaults to true:** return a plan only (`plan` old→new coordinates; `connections` connection table + link/label styles). Only `dryRun:false` performs changes after review. Save the project before a real run. Auto-layout does not automatically restore moves already made.
- Live testing showed that old wires/labels do not follow components moved by the official API; rewire deletes and recreates them rather than translating them.
- On move failure, `stateDifferences` preserves actual values such as `undefined`, `null`, and empty strings and is passed through `autoLayout`; non-geometric state protection remains active. The cause of in-place property changes is unconfirmed.
- The root cause of the missing first bad netlist snapshot is unconfirmed. External per-page scripts supplement and retain evidence; they do not prove that the `getNetlist` algorithm is fixed.
- Rewire details: rebuild direct links before labels. Before deleting wires, classify pins across the whole page: delete purely internal wires; after deleting a wire with one external pin, automatically restore the net (`externalRewired`); retain complex long wires passing through ≥3 pins (`skippedWires`), which may leave dangling wires requiring manual review; if link reconstruction crosses a third-party pin, fall back to labels at both ends (`fallbacks`); anything still unrestored is in `rewireFailed` (old wire was deleted and the net is broken; repair manually).
- After the run, inspect `moved` and failure `error.cause` fields `partial`, `moved`, `phase`, `stateDifferences`/`rewired` (including `wireAudit`)/`drc`. If any moves partially fail, stop later writes, inspect the state identified by `error.cause.moved`, restore in a controlled way from backup, and visually inspect the canvas.
- Scope: **`buildBlock` generates from scratch; `autoLayout` organizes existing content.**

### `schematic.batchWire` — Batch wiring

Submit mixed label/link items in one call: `items:[{type:"label",pin,net,color?},{type:"link",pins,color?,jogDir?}]`.

- Execute and collect errors item by item, then run one unified netlist audit; this is several times faster than issuing separate calls.
- Netlist is a cached snapshot: if any item fails, wait 800 ms and re-export, up to 5 attempts; use the last result.
- **Reports only; does not auto-repair.** Handle audit failures according to `audit.detail`, then rerun the affected item.
- An item that fails audit is listed in `failed` with its actual net name, even if execution returned `ok`.
- Optional: `continueOnError?`, `skipAudit?`.

## ② Basic commands (secondary entry)

### Semantic wiring (also suitable for a single wire)

| Command | Description | Key parameters |
| --- | --- | --- |
| `schematic.labelWire` | **Connect one pin to a named net:** draw a short stub outward along the pin direction and place a same-name label (guarded + attachment-verified). Requires a net name and exactly 1 pin. | `pin` ("U1.7"), `net`, `color?`, `force?`, `stubLen?` |
| `schematic.linkWire` | **Physically connect exactly 2 pins:** orthogonal U-shaped route with dynamic horizontal-leg avoidance to prevent collinear merging. Requires 2 unnamed pins (use `labelWire` for a named net). | `pins` (["U1.7","C1.1"]), `color?`, `jogDir?`, `force?` |

- These commands are mutually exclusive (one named pin vs two unnamed pins), preventing the incident where a short wire already had a net name and an identical label was added on top.
- Default stub length is 60 (fits long names such as STATUS_LED extending right without overlapping the component); `stubLen` overrides it, minimum 20; it does not adapt automatically.
- **Label rotation is always 0; its anchor is always at the end of the stub.** Attachment is determined by the anchor, which must lie on the wire; more than 5 units off-wire is floating. Rotation 180 produces reversed text (confirmed on the installed system). For left-facing cases, offset the position; do not rotate.
- Estimated text width is **4.4 × character count + 5 units** (digits/underscores are slightly wider; overestimate).
- **Occupancy preflight:** reuse a pin already on the same named net; reject a pin occupied by another net (prevent shorting); `force:true` forces the merge.
- **Avoid the whole path:** if any pin is within 8 units of any part of a stub/horizontal leg, change direction. `linkWire` checks every candidate segment-by-segment (8 U-shaped layers + 2 L-shaped variants, endpoints exempt); if none works, throws `PIN_CROSSING_FALLBACK`.
- **Do not wire NC pins:** preflight reports an error in Chinese; it will not force a wire.
- If attachment verification fails, return promptly with `attached:false` (up to two 500 ms retries).

### Placement and drawing

| Command | Description | Key parameters |
| --- | --- | --- |
| `schematic.placeDevice` | Place a component and verify project footprint resource and pad numbering (included in BOM and PCB by default) | `lcscId` or `deviceUuid`+`libraryUuid`, `x`, `y`, `rotation?`, `addIntoBom?`, `addIntoPcb?` |
| `schematic.connectPin` | Low-level single-pin wire: from 30 units outside the pin tip to the pin origin; an endpoint at the origin connects. **Prefer `labelWire` for ordinary use.** | `primitiveId`, `pin`, `net` |
| `schematic.drawWire` | Draw wires (array of vertices; auto-split, deduplicate, and intelligently name; supports color/lineWidth/lineType) | `points`, `net?`, `color?`, `lineWidth?`, `lineType?` |
| `schematic.placeNetLabel` | Place a net label (**automatically verify attachment**; guard against duplicate names) | `net`, `x`, `y`, `noVerify?`, `force?`, `rotation?` |
| `schematic.placeText` | Non-electrical annotation | `x`, `y`, `content`, `fontSize?` |
| `schematic.placeRegion` | Create region and title in one step (title automatically placed at inner top-left; returns `span`) | `x`, `y`, `width`, `height`, `title`, `color?`, `lineType?`, `fontSize?` |
| `schematic.moveComponent` | Move/rotate/mirror (internal atomic steps + readback verification) | `primitiveId`, `x?`, `y?`, `rotation?`, `mirror?` |
| `schematic.moveLabel` | Move a net label/attribute | `primitiveId`, `x`, `y` |

- **When `drawWire` receives `net`, it automatically places a NET attribute label at the wire midpoint.** This and `placeNetLabel` are separate mechanisms; using both on one net duplicates the name. The NET attribute belongs to the wire and the official API cannot delete it separately. To finish with a label, **omit `net` from `drawWire` and place a label with `placeNetLabel`; do not name it in both places.** Successful naming returns `namingNote`.
- `drawWire` uses intelligent naming: if the net already exists on the page, it automatically draws an unnamed segment.
- With `connectPin`, do not extend a wire into the component body (an endpoint on the middle of the pin segment creates a T-junction red dot and the EDA warning “单网络” (“single network”)). EDA requires non-zero overlap with a pin segment. Endpoint-to-endpoint overlap or placing a net label directly on the pin both produce fatal “引脚端点重叠且未连接” (“pin endpoints overlap but are not connected”).
- **Collinear merge pitfall:** the official app automatically merges geometrically collinear overlapping/touching wires. Do not draw a long straight wire through an intermediate pin (it will join that pin to the net); do not overlap different nets' wires/stubs/horizontal legs collinearly (short circuit). Batch commands guard against this; manual `drawWire` must avoid it too.
- `placeNetLabel`: labels placed on the wire body are rejected (automatic ±2-unit offset retries). Return `attached:true` and `wireId` only when readback agrees at all three levels: this label's ID, parent wire, and parent-wire attribute. Ghost labels use the same verification. If readback is unknown or confirms a floating label, return a partial error and retain the label and ID; do not delete it automatically. `noVerify:true` does not prove attachment. Nearby same-name wires or negative coordinates do not prove attachment. A wire with that net name already present is still rejected (`force:true` forces placement). Default `rotation` is 0; if explicitly provided, the plugin attempts to set and read it back.
- Grid snapping: coordinates must be multiples of 10 or DRC reports “网络图元不在格点上” (“network primitive is off-grid”).

#### `placeDevice` footprint verification (0.10.94 candidate)

- First read all library-device associations, create once using the official UUID references, then independently read the instance, project footprint resources, and pins. Missing associations and duplicate placement are not auto-fixed.
- If the library device has an associated footprint, the instance footprint must point to the target project resource; the resource origin must match the library footprint and library UUID; and each pin number on the current instance must exist among the footprint PAD numbers. The 0.10.96 candidate uses public full-project epro export for verification and reads exact `FOOTPRINT/<instance footprint UUID>.efoo`, retaining HEAD.uuid and origin checks; the host must permit project download. Only line-array FOOTPRINT resources are supported; unsupported format or missing evidence errors.
- Success retains `primitiveId`, `designator`, and adds `readback.footprint` (including `projectUuid`, `resourceSource`, `resourceVerified`) and `pinPadMapVerified`. `pinPadMap` maps pin numbers to PAD primitive IDs. `pinMapScope:"placed-instance-only"` covers only this subcomponent; it does not verify other subcomponents or the whole device.
- A library device without a footprint association can still be placed and returns `libraryFootprint:"none"`. If it has no electrical pins and numbered pads, it returns `electricalMapping:"none"`, `pinPadMapVerified:false`; do not treat that as verified electrical mapping.
- Verification failure after an attempted create includes `partial:true`, `retryable:false`, the phase, and any obtained `primitiveId`. Inspect the current state; do not auto-retry or delete. Execution also stops if the schematic page or project focus changes.
- `readback.verified:true` means only that these immediate checks passed. `persistenceVerified:false` explicitly means save/close/reopen has not yet been checked. Netlist, DRC, and persistence require separate verification.

Live diagnosis in 0.10.95 confirmed that the current page-resource API returned an empty array while the target resource existed in the full project package. Based on this, the 0.10.96 candidate changed the verification source and checks page/project identity and instance references before and after export. It adds `resourceOrigin:"project-export-epro"` and `resourcePath`; this still does not prove persistence. On 2026-10-10, placement of a new test point in an isolated 0.10.96 project passed footprint-origin and pin/PAD mapping checks. After save, close, and reopen, the footprint reference, BOM/PCB flags, designator, and unique ID remained, and the netlist matched. This covers only the tested component; the historical footprint-loss root cause was not reproduced.

#### Read-only footprint-resource diagnostic (0.10.96 candidate)

`schematic.getPlacementResourcesDiagnostic` requires an existing component's `primitiveId`. It reads current schematic-page and project identity, instance footprint UUID, and resource count plus per-item summaries from `getDocumentFootprintSources()` (original `footprintUuid`, source length, DOCTYPE, HEAD.uuid, parse errors). It does not return full source, create/modify components, or save.

The 0.10.96 candidate additionally returns `projectResource`, using the same full-project reader as placement verification to provide target path, HEAD/origin, and pad-number summary. Results retain `diagnosticOnly:true`, `placementVerified:false`. Parse/export errors or focus changes count as incomplete; do not retry component creation from this diagnostic. The 0.10.95 empty-array behavior was confirmed in testing. In the isolated 0.10.96 host on 2026-10-10, projectResource path, HEAD, origin, and PAD numbers for existing TP2 and new TP3 were correct after save/close/reopen. A read-only diagnostic alone still does not mean a newly placed component passed all checks.

### Modification commands

| Command | Description | Key parameters |
| --- | --- | --- |
| `schematic.setWireNet` | Change a wire net name (force readback after modify; returns `readback:{net,verified}`) | `primitiveId`, `net` |
| `schematic.modifyComponent` | Modify full component properties and read back independently | `primitiveId`, complete `property`; see below |
| `schematic.modifyWire` | Change color/width/type/net (can batch by net, e.g. make all 3V3 wires red) | `primitiveId` or `net`, `color?`, `lineWidth?`, `lineType?`, `newNet?` |
| `schematic.modifyNetLabel` | Change color/position/name/**text orientation** (can batch by net) | `primitiveId` or `net`, `color?`, `newNet?`, `x?`, `y?`, `rotation?` |
| `schematic.modifyText` | Change annotation text | `primitiveId` |
| `schematic.modifyRect` | Change position/size/style (`y` is also the top edge) | `primitiveId`, `x?`, `y?`, `width?`, `height?` |

- Combining multiple fields in the official modify call can make the entire operation fail (observed: passing position + rotation changed nothing). The plugin **splits fields into atomic steps** with readback after each; mismatches are moved to `failed` with actual values. Callers may still pass multiple fields.
- Official modify operations can fail falsely or succeed falsely. For every modification, use readback/source rescanning to determine success.
- Mirroring and rotation 180 both reverse text. Keep ordinary labels at rotation 0 with the anchor on the wire. The official attribute API does not support `mirror`; a mirrored label must be corrected or deleted and placed again.

#### Full `modifyComponent` properties and system aliases (0.10.94 candidate)

`property` must explicitly include all 14 fields: `x`, `y`, `rotation`, `mirror`, `addIntoBom`, `addIntoPcb`, `designator`, `name`, `uniqueId`, `manufacturer`, `manufacturerId`, `supplier`, `supplierId`, `otherProperty`. `otherProperty` must include all custom properties already on the instance so the SDK does not clear keys omitted from the request.

The host stores nine system keys in dedicated fields: `Add into BOM`→`addIntoBom`, `Convert to PCB`→`addIntoPcb`, `Designator`→`designator`, `Name`→`name`, `Unique ID`→`uniqueId`, `Manufacturer`→`manufacturer`, `Manufacturer Part`→`manufacturerId`, `Supplier`→`supplier`, `Supplier Part`→`supplierId`. The plugin reads each back through the corresponding field.

- If `otherProperty` repeats any of these keys, values must match the top-level fields. Boolean aliases accept only `"yes"` / `"no"`, corresponding to `true` / `false`. Conflicts error before writing.
- A top-level string value of `null` or an alias value of an empty string means clear the field. Actual readback may be `null`, `undefined`, or an empty string. Other strings and booleans use strict comparison.
- `readback.otherProperty` preserves actual readback and may omit the system keys above. Do not treat their absence there as a failed write.
- A real mismatch, readback failure, or focus change still errors. A failure after an attempted write includes `partial:true`, `retryable:false`; inspect the current state and do not resend directly.
- Do not use default library-device properties directly as a project-instance modification request. In-project footprint, symbol, and device references may differ from library UUIDs.

This fix passed local regression and an isolated 0.10.94 host test: BOM=false, PCB=true, designator and unique ID changes read back correctly; after save/close/reopen the properties persisted and the netlist was text-identical. This covers only the tested fields and component, not every property combination.

## ③ Repair and maintenance (use when problems occur)

| Command | Description | Key parameters |
| --- | --- | --- |
| `schematic.pruneFloatingLabels` | **[Macro] Remove floating labels** (attachment remnants and labels orphaned by wire deletion) | `dryRun?` (default `false`; explicitly pass `true` to preview), `batchSize?`, `allowSourceRewrite?` (controls only the source-rewrite fallback for floating-label handling) |
| `schematic.fixNetLabels` | **[Macro] Full label check:** ① floating ② duplicate ③ reversed ④ misplaced | `dryRun?`, `angle?`, `net?` |
| `schematic.repairNet` | **Broken-net repair macro:** audit → adopt unnamed leftover wires → add labels → compare netlist before/after | `net`, `adoptWireIds?`, `dryRun?` |
| `schematic.dedupeWireNets` | Clear “导线多个网络名” (“wire has multiple net names”) warnings (historical drawings only) | None |
| `schematic.delete` | Delete primitives in batches (identify type first + immediate post-delete readback + final reconciliation; if still present, recheck at existing intervals; unknown readback returns partial and stops later writes) | `primitiveIds`, `batchSize?` |

- **Official deletion gap for floating labels (`parentId=$$root`):** attribute primitives do not support deletion (`@internal`). Primary path: attach the label to a temporary wire by modifying `parentId`, delete the wire to cascade-delete the label, then verify by rescanning source. Official `modify` of `parentId` can falsely fail; trust the final source rescan.
- `pruneFloatingLabels`: dry run returns world coordinates for every floating label (**Y is converted to API coordinates**) as a manual-selection fallback. 8 s circuit breaker per item; three consecutive failures break the whole batch; default `batchSize` 5 (300 ms between batches; review `batches`/`unprocessed` before continuing in batches; **do not increase it for a forced run**). **Run large batches in separate calls.**
- **The third fallback—source rewrite for floating-label handling—is disabled by default** (live incident: offline byte-level validation did not establish runtime safety; official writeback was rejected by a format-validation dialog). Attempt only with explicit `allowSourceRewrite:true`; result includes `warning`; save the project first. This switch is separate from the internal snapshot path for ordinary `TEXT` deletion. If all methods fail, return a world-coordinate list in `manualDelete`.
- **Signs of a damaged session:** creation commands (`drawWire/placeNetLabel/placeText/placeDevice/labelWire/linkWire`) suddenly all return `create failed!` or time out while read commands work → treat the session as damaged. Do not keep retrying (the plugin circuit-breaks after 3 consecutive failures); **close and reopen the page without saving** to recover, then continue in batches.
- `fixNetLabels`: **`dryRun` defaults to true** and returns only a four-category report (id/net/world coordinates/problem/recommendation). After review, `dryRun:false` repairs; errors are collected per item; it then runs `pruneFloatingLabels` for verification. Categories: floating (`parentId=$$root`, source of DRC); duplicate (>1 label with same net on same wire or anchor distance <10); reversed (`rotation` 180); misplaced (anchor >20 from wire or wire extends into a dangling endpoint).
- Use `repairNet` after manually dragging a label breaks a net; see `pitfalls.md` for the workflow.
- **Hardened `delete`:** identify primitive type first; immediately read back after deletion, recheck at existing 400/600/1000 ms intervals only if still present, then perform final reconciliation. SDK boolean return does not prove success. On write timeout or unknown readback, keep partial and stop later items and health probes; do not use a “target absent at final scan” to clear an unknown write. `unprocessed` means only not processed; inspect state and write-protection first. On known paths, the health probe performs only one serial create/cleanup; it cannot replace save/close/reopen. `taskId` can query the original task; timeout does not mean cancellation. When `deletedBy` includes `text`, use `schematic.delete` for routine deletion and do not auto-save; verify persistence separately per task with save→close→open.
- NET attribute labels at wire midpoints **cannot be deleted separately** (`delete` reporting “删后仍在” (“still present after delete”) is expected); delete and redraw the whole wire.

## ④ Query, inspection, and export

| Command | Description | Key parameters |
| --- | --- | --- |
| `schematic.getPageInfo` | Page info and frame size (`titleBlock` width/height in 10 mil units; `titleBlockData` keys determine what `modifyTitleBlock` can change) | `pageUuid?` |
| `schematic.listComponents` | List components | `allPages?` |
| `schematic.listPins` | List pins (number/name/coordinates) | `primitiveId` |
| `schematic.listWires` | List wires for readback checks | `net?` |
| `schematic.listNetLabels` | List all net labels (including attachment and color; floating labels cause DRC “没有连接导线” (“no connecting wire”); since 0.10.46, use this for labels; `listLabels` was removed) | `net?` |
| `schematic.listTexts` | List annotation text (since 0.10.46 includes `offGrid` marker, replacing deleted `listLabels` for “不在格点” (“off-grid”) checks) | None |
| `schematic.listRects` | List all rectangles (returns normalized `span:{x1,y1,x2,y2}`; use `span` for all layout calculations) | None |
| `schematic.checkRectOverlap` | Pairwise rectangle-overlap check (includes `span`) | None |
| `schematic.getComponentsInRect` | Components in a region (by anchor; use `rectId` or explicit span; supports expanded `margin`) | `rectId` or `x1,y1,x2,y2`, `margin?` |
| `schematic.getPrimitivesInRegion` / `getPrimitiveAtPoint` | Query primitives by region/point | ⚠️ Region queries may omit text |
| `schematic.runDrc` | Schematic DRC (internally runs twice to obtain a stable result) | None |
| `schematic.runDrcDetailed` | Per-item DRC details (**requires EDA v4.2+**; v4.1 returns aggregate structure only and marks `aggregated:true`; do not claim support or retry repeatedly) | None |
| `schematic.structuralAudit` | **[0.10.60] Read-only whole-page structure/layout acceptance:** union-find tree construction + official net reconciliation. `blocking` = bridges (LABEL_NET_MISMATCH/multiple net names within a tree)/collinear overlap between different nets/duplicate designators; `candidate` = isolated trees/floating labels/pin crossings/orthogonal crossings/overlapping regions/components outside regions/component collisions (approximate pin clouds; visual check required); `info` = zero-length segments/dangling ends/same-net overlap. Call once per page for a nine-page review. | `ncExempt?` (exempt list such as ["U2.2"]), `deviceMargin?` (collision filter expansion in mil; default 10) |
| `schematic.exportNetlist` | Export netlist (base64; parse and check pins on each net) | `fileName?`, `netlistType?` |
| `schematic.getNetlist` | Read netlist string; generation may update duplicate designators/Unique IDs and save the project, so it is not a read-only source query | `netlistType?` |
| `schematic.save` | Save schematic | None |

- On 2026-10-12, host-source inspection and testing confirmed that netlist generation may first update duplicate Designators/Unique IDs and save the project. Do not use `getNetlist` or `exportNetlist` to inspect a source as a read-only operation. Use them only when the isolated target permits such changes, then verify the actual source identity.
- Since 0.10.104, netlist file export rejects zero-byte files and empty base64; `getNetlist` rejects whitespace-only text. Non-empty data still needs parsing and actual pin verification; export success alone is insufficient.
- The official single-object `get()` permanently returns a cached old object for a deleted ID. Check existence with a full list/source rescan, not `get()`.
- **`structuralAudit` host semantics (confirmed in 0.10.61):** ① The host merges physically touching wires with different net names into one wire and assigns one of the names; bridges are actually caught by LABEL_NET_MISMATCH[blocking]. MULTI_NET_TREE may not occur unless fields can be forged; that is normal. ② A wire drawn through a pin is snapped/split by the host, making the pin an endpoint and a legal connection; PIN_INTERIOR_LANDING usually does not trigger on host data but remains as a defensive rule. ③ The frame at (0,0) may be reported as COMP_OUTSIDE_REGION[candidate]; it is not a component and can be ignored.
- Official `getAll(net)` filtering is unreliable; the plugin now retrieves all items and filters manually.
- **Dragging a net label in the EDA UI can detach or delete it and break a net.** After dragging, check `attached` with `listNetLabels` and audit membership completeness.
- **Source and API Y axes have opposite signs** (API y=-600 ↔ source y=+600); invert Y when comparing them.
- `createNetLabel` can falsely fail (empty return even though an attached label was created). Verify by **attribute values + coordinates**; do not rely on asynchronous propagation of the wire's net name.

## ⑤ Macro commands (combine commands)

Use `cmd:"macro"`; `steps` execute in order. After assigning a step `id`, later steps can reference its result using `$id` or `$id.field`. **The response key is `steps`** (⚠️ not `result` or `data`; parse accordingly). Any failed step stops the macro (`stopOnError:false` disables this behavior).

```json
{
	"cmd": "macro",
	"instanceId": "<verified instance ID>",
	"params": {
		"steps": [
			{ "id": "u1", "cmd": "schematic.placeDevice", "params": { "lcscId": "C25804", "x": 200, "y": 200 } },
			{ "cmd": "schematic.connectPin", "params": { "primitiveId": "$u1.primitiveId", "pin": "VDD", "net": "3V3" } },
			{ "cmd": "schematic.save" }
		]
	}
}
```






