# PCB Fanout, Local Copper, Pad Expansion, and Net Silkscreen

> These operations first generate a read-only plan, then pass the complete plan object to the corresponding execution command. The outer `/command` request still needs the top-level `instanceId` of the current PCB window. See [setup.md](setup.md) for connection and request formats. All lengths and coordinates are in mil.

## Rectangular board-outline reading (0.10.97)

Existing straight closed loops remain supported. The board-outline `Polyline` layer now also supports a strict seven-item `R` path, provided the coordinates and dimensions are valid, width and height are positive, and rotation and corner radius are both 0. The SDK's `R` coordinates specify the top-left corner; the rectangle's bottom edge is `y-height`. Unknown paths, incomplete reads, or abnormal coordinates block execution; an unknown board outline cannot be ignored just because another valid rectangle exists.

Fanout retains the existing closed-loop handling and spacing checks against geometric boundaries; no extra board-outline stroke half-width margin was added. Local copper still accepts only one closed loop, and all four rectangle edges participate in the board-interior and existing board-edge width/spacing checks. This adaptation does not expand support to multiple loops, rotated rectangles, rounded rectangles, or curves.

Isolated test on 2026-10-10: both read-only plans in 0.10.97 recognized the rectangular board outline; creation of fanout traces and vias, item-by-item read-back, and save/close/reopen verification passed. A local copper outline was created, but the host returned the same loop in reverse order and strict array comparison rejected it; fill was not executed, so this cannot be considered complete.

## Commands

| Command | Purpose | Parameters |
| --- | --- | --- |
| `pcb.getFanoutPlan` | Read-only plan for pad fanout traces and vias | Choose exactly one of `padIds?`, `componentIds?`, or `net?`; direction, layer, and size parameters below |
| `pcb.fanout` | Execute a fanout plan | `plan`: the complete object returned by `pcb.getFanoutPlan` |
| `pcb.getAutoCopperPlan` | Read-only plan for local copper pour or fixed fill | Required: `targetIds`, `layer`; optional: `net?`, `expansion?`, `generationType?`, and chamfer options |
| `pcb.autoCopper` | Execute an automatic local-copper plan | `plan`: the complete object returned by `pcb.getAutoCopperPlan` |
| `pcb.getPourFillReadback` | Read-only verification of actual fill for a specified outline | Required: `primitiveId`, expected `net`, and `layer: top or bottom` |
| `pcb.getPadExpansionPlan` | Read-only plan for pad expansion rings | Required: `targetIds`, `expansion`, `generationType` |
| `pcb.expandPads` | Execute a pad-expansion plan | `plan`: the complete object returned by `pcb.getPadExpansionPlan` |
| `pcb.getNetSilkscreenPlan` | Read-only plan for editable net-name silkscreen text | Required: `targetIds`, `layer`, and placement method; optional font parameters |
| `pcb.generateNetSilkscreen` | Execute a net silkscreen plan | `plan`: the complete object returned by `pcb.getNetSilkscreenPlan` |

Plan first and inspect `executable`, targets, nets, layers, geometry, warnings, and coverage. Do not send an execution command when `executable:false`. Plans include fields such as `documentUuid`, `operation`, `units`, `inputs`, design-source and DRC-rule `baseline`, `targets`, `groups`, `plannedPrimitives`, `coverage`, `warnings`, and `provenance`. Execution commands require the complete plan exactly as returned; do not construct a partial object by copying selected fields.

Before execution, the plugin checks PCB focus, document identity, source and rule baselines, and recalculates targets and geometry from current objects. It rejects a write if these differ from the submitted plan. SDK operations run sequentially with focus checks. Written items are read back one by one. On failure, later steps stop, and the receipt identifies created/verified items and steps not executed. Commands do not automatically save, roll back, or retry. After failure, inspect the current state read-only before deciding whether to save or continue.

## Pad fanout

Exactly one of `padIds`, `componentIds`, or `net` must be specified. `direction` can be `auto`, `8directions`, or `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`; it defaults to `auto`. Both `auto` and `8directions` try eight directions and select a shorter available route. `staggerLength` is the stagger distance between adjacent targets and defaults to 0 mil.

Explicitly provide `lineLength`, `lineWidth`, `viaDiameter`, `holeDiameter`, and `clearance`, all in mil. No DRC rule field has been verified as universally applicable, so the plugin will not guess defaults from the rule structure. If any value is missing, the hole diameter is not smaller than the via outer diameter, geometry/net/layer data is incomplete, or route search finds no result, the plan is not executable. Multilayer or through-hole pads require an explicit `layer: "top"` or `"bottom"`; top/bottom SMT pads retain their actual copper layer. The current tool creates through vias; do not treat its result as blind or buried via fanout.

Supported oval, obround, and rounded-rectangle pads are sampled at angular steps no greater than 10 degrees and conservatively expanded outward according to sagitta error. This does not mean all curved pads are supported. Curves (`C`/`ARC`/`CARC`) in complex pad polygons, curved copper surfaces or regions, and arc-shaped board outlines or board-interior boundaries cannot currently be parsed safely and make the plan non-executable. A standalone arc track can be treated as an obstacle after expansion by sagitta error.

The plan reports actual target-pad coordinates, net and layer, route groups, proposed traces/vias, candidate search count, and any limitations. Search checks at most 20,000 candidates per direction. When the limit is reached, `coverage.searchLimited` and the group status show the limit. If obstacle, board-outline, keepout, or target-shape data is incomplete, do not treat partial geometry as a safe route. Selecting a net means fan out target pads on that net; it does not mean that the entire net is connected.

Execution creates new traces and vias segment by segment and reads back net, layer, coordinates, and dimensions by primitive ID. A successful receipt includes `createdIds`, `verifiedIds`, per-item `readback`, and `saved:false`. This confirms only that new primitives match the plan; it does not mean DRC passed, the net is fully connected, or manufacturing requirements are met.

## Automatic local copper

`targetIds` is required and must contain unique primitive IDs; IDs can refer to pads, vias, or components. Components are expanded to their pads. `layer` must explicitly be `top` or `bottom`. Optional `net` filters targets by net. `expansion` is the outward expansion in mil and defaults to 5. `generationType` is `pour` or `fill` and defaults to `pour`. Chamfer options are `enableChamfer` (default `false`), `chamferType` (default `straight`), and `chamferWidth` (default 5 mil).

The plan groups targets by net and target copper layer, then creates separate polygons; it does not merge different nets into one region. Ordinary SMT pads are not projected onto the opposite side. The plan lists selected and excluded targets, each group's geometry, actual boundary/spacing/clipping handling, rule information, diagnostics, and degradation notes. Incomplete object or rule data, unresolved geometry, or conflicts make the plan non-executable. Boundary generation and clearance reuse the relevant geometry pipeline from `JLCEDA/eext-auto-copper-shape`, but the plan is not a complete board-level DRC conclusion: if an untreated arc is near a target, the plan is non-executable. Only a verified single-loop board outline is accepted (native straight segments or the supported rectangle above); multi-loop or arc outlines are not executable. Read `coverage` and `warnings`; do not describe limited coverage as a complete manufacturing check.

The default `generationType: "pour"` creates copper-pour outlines per group, rebuilds the fills, and reads back the new fill primitives. Success results distinguish geometry read-back, copper-pour ordering source read-back, and fill read-back. `generationType: "fill"` creates and reads back fixed-fill geometry without rebuilding copper-pour outlines. Execution does not automatically run DRC or save. Partial failure does not automatically undo primitives already created.

## Single-loop geometry read-back (0.10.98)

Only after-creation geometry read-back allows a single straight closed loop to differ by a changed start vertex, full reversal, or one-/two-dimensional single-loop wrapping. It still requires finite coordinates, explicit closure, and at least three distinct vertices, and compares ordered vertices exactly. No tolerance, resampling, or collinear-point removal is added. Multi-loop geometry continues to use strict comparison; support for holes or curves is not expanded. Net, layer, and complete pre-write plan checks are unchanged.

Read-back evidence retains the planned source, actual source, and comparison method. If actual coordinates, edges, net, or layer differ, later writes still stop and partial execution is reported; do not resubmit the old plan. In 0.10.98, real-host comparison and ordered read-back after outline reversal passed, and rebuild returned success. A subsequent actual-fill SDK adaptation check failed, so the original command remained incomplete.

## Actual fill read-back (0.10.99)

The fill primitive's associated Pour ID is used to read its parent outline independently and check ID, net, and layer; the result states that net and layer come from the parent outline. A fill subregion's `path` is a complex polygon object, whose original path is read with `getSource()`. The check verifies a `fill:true` subregion, a non-empty path array, and scalar structure. It does not prove that fill geometry is correct or meets manufacturing requirements. Exceptions preserve evidence and stop later writes; success is reported only after all checks complete. Actual fill may be clipped by copper-pour rules, so it is not required to exactly match the parent outline, and source coordinate units are not inferred.

`pcb.getPourFillReadback` and post-execution checks share the same read-back logic. Given a known outline `primitiveId`, expected `net`, and `layer`, it can inspect an existing fill without creating, rebuilding, saving, or unprotecting anything. It supports read-only recovery checks and cannot reclassify a partial failure of an earlier command as success. On 2026-10-10, read-only inspection on an isolated 0.10.99 host passed for the same copper area created and rebuilt in 0.10.98. Testing confirmed that Poured has no net/layer getter and `path.getSource()` returns a non-empty path; the parent outline matched the boundary checked earlier. After save/close/reopen, the parent outline, associated fill, path, and fanout primitives remained consistent, and DRC reported 0 errors/0 warnings. This evidence covers the new shared read-back logic and persistence. The full copper-creation command was not rerun on 0.10.99, and the 0.10.98 record of the original command's partial failure remains unchanged.

## Pad expansion (0.10.103)

`targetIds` specifies pad or component IDs. A component expands to its pads, and each pad is processed only once. `expansion` is a positive mil value. `generationType` must be explicitly one of `noPours` (keep out of copper pours), `noFills` (keep out of fills), or `solderMask` (solder-mask expansion geometry).

Output is an annulus formed by subtracting the original pad outline from the expanded outer outline; it does not modify original pad attributes. Top- or bottom-layer pads generate on that side; multilayer pads generate on both top and bottom. The initial version supports oval, obround, and rectangular (including rounded-corner) shapes. Shapes that vary by layer, custom polygons, and regular polygons whose orientation has not been verified make the entire plan non-executable. Curved shapes are approximated by sampling; inspect the actual boundary in the host.

Keepout output splits each side's annulus into two hole-free polygons; their union must equal the original annulus. Solder-mask output remains a double-ring fill with an inner hole. The plan retains the complete annulus and each piece; do not remove pieces before submission.

Primitive line width is explicitly 0.2 mil and is used for creation and read-back. `expansion` is the outward offset of the path outline. The effect of line width on the final solder-mask or keepout boundary has not been verified; do not use it to promise a manufacturing opening size.

Before execution, targets are read again and the complete plan is recalculated. After creation, primitive type, layer, rules, and geometry are checked by ID, and the complete path is checked against current project source. Coordinates allow only a 0.0001 mil serialization difference. Immediate source read-back does not prove the data persists after saving. If the result is uncertain, stop and inspect the current state before proceeding. The command does not automatically save, delete old results, or retry.

## Net-name silkscreen (0.10.101 candidate)

`targetIds` specifies pad or component IDs. Separate silkscreen text is generated for different pads, even if they share a net. Duplicate pads are deduplicated; pads with empty nets are listed in `excludedTargets` and skipped. `layer` must explicitly be `top-silk` or `bottom-silk`.

Choose one placement method:

- Use `position: top|bottom|left|right` with a non-negative `offset`. The anchor is calculated from the SDK-returned rotated pad boundary.
- Use `placements: [{padId,x,y,align}]` to specify an anchor for each pad. `align` is `left|center|right`, and every target pad with a net name must be covered.

Optional parameters are `fontFamily`, `fontSize`, `lineWidth`, `rotation`, and `mirror`. Defaults are `Arial`, 50 mil, 8 mil, 0°, and `false`, respectively. The lower layer is not automatically mirrored; set it explicitly as needed. Text remains editable; this version does not convert text to an image.

The plan returns `plannedStrings`, targets, and exclusion reasons. After execution, text attributes are read back independently. No global collision check is performed, and `offset` does not guarantee clearance between rotated text and a pad. Check spacing among silkscreen, solder-mask openings, and existing primitives. Re-plan after success or partial failure; generating text again at the same location can still cause overlap.

On 2026-10-10, after installing 0.10.101 on EDA 4.1.71, creation and independent read-back of eight net labels passed. Text persisted after save/close/reopen, covering top/bottom silkscreen, separate labels for pads on the same net, bottom-layer mirroring, and 90° rotation. Re-executing the old plan was rejected before writing and added no text. Default relative placement may overlap reference designators or other text; visual inspection is still required.

Pad expansion in 0.10.101 did not pass. Keepout immediate source showed inner and outer rings, but only the outer ring remained after save/close/reopen; solder-mask double-ring fill persisted. It was also found that the SDK polygon getter returns only the outer ring, zero line width becomes 0.2 mil in practice, and the empty-net getter diagnostic was normalized to `null` without distinguishing the original value type at the time. The failed sample is not a qualified expansion result. Fixing only read-back checks would not prove the persistence issue resolved.

Real-host testing on EDA 4.1.71 in 0.10.102 showed that the single-ring split paths and attributes for 8 keepout regions persisted after save/close/reopen; the original components, pad nets, and 8 net labels were unchanged. Solder-mask double-ring fills and empty net values in source persisted, but the SDK empty-net check still failed. Version 0.10.103 only added compatibility for a null empty-net value and recorded the SDK net-value type; it still requires `netName` in source for the same ID to be strictly empty. Version 0.10.103 real-host testing confirmed the SDK's empty-net type is `null`. After save/close/reopen, a total of 16 keepout pieces and 6 solder-mask fills retained complete paths, layers, rules, line widths, and nets; original components/pad nets/8 silkscreen labels were unchanged. For one bottom-layer rotated rectangle sample, the Gerber outer boundary matched the planned path with a maximum coordinate difference of about 0.000001 mm. Do not generalize this result to every shape or to the actual effectiveness of keepout areas.

## Sources

- Fanout algorithm source: `JLCEDA/eext-pad-fanout`, commit `7c88e571457e6d63463b7cb391e1e62bdbdd02d7`.
- Automatic local-copper algorithm source: `JLCEDA/eext-auto-copper-shape`, commit `98317b6b5941977a3ae90948a05295f9d8b1169f`, licensed under Apache-2.0. Planning reuses boundary, rule, and clipping handling; the original extension UI and its SDK write path are not used for this command's execution.
- Current 0.10.99 is a local candidate; see the above for verified scope and pending items. Local regressions do not establish host or manufacturing acceptance.
- Pad expansion reference: [eext-pad-expand-helper](https://github.com/easyeda/eext-pad-expand-helper/tree/de5b2eb6bd6817bb25025d621c2f6010bc110cab), Apache-2.0.
- Net silkscreen reference: [eext-generate-silkscreen](https://github.com/easyeda/eext-generate-silkscreen/tree/f87bf3c725dea2dcb2b825a9faa90cb869dba86b), Apache-2.0. This implementation uses native text only.
