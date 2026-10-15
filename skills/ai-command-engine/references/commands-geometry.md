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

### Purpose and when to use

Fanout draws short traces from selected component pads to the outside and places same-net vias at the trace ends. Use it for MCUs, fine-pitch ICs, or specified pads after component placement and before full-board routing; it can also be used for selected pads when some routing already exists. The result preserves each pad's net and avoids the currently parseable board outline, keepouts, and existing copper. Fanout completes only the pad-to-exit-via segment; continue routing the rest of each net afterward.

### Workflow and usage

1. Select the target PCB through the skill's connection workflow and activate it with `editor.openDocument`.
2. Use `pcb.listComponents` to obtain component IDs. For selected pads, call `pcb.getComponentPads {"primitiveId":"component ID"}` to obtain pad IDs; use `pcb.listVias` when targeting vias.
3. Call `pcb.getFanoutPlan` and inspect targets, nets, layer, and `executable`.
4. Pass the complete `data` object from the planning response unchanged as `params.plan` to `pcb.fanout`.
5. The plugin creates traces and vias and reads each back. `createdIds` and `verifiedIds` identify this operation's results.
6. Run `pcb.runDrc`, save with `pcb.save`, and continue routing.

Choose exactly one target selector: `componentIds` for a whole component, `padIds` for selected pads, or `net` to select pads by net. IDs must come from the current PCB; a designator such as `U1` is not a primitive ID. Explicitly set fanout length, trace width, via outer diameter, drill diameter, and copper clearance.
| Parameter | Meaning and usage |
| --- | --- |
| `direction` | Defaults to `auto`; compares eight directions automatically, or accepts `N/NE/E/SE/S/SW/W/NW` |
| `lineLength` | Trace exit length, in mil |
| `lineWidth` | Width of each new trace, in mil |
| `viaDiameter` | Via copper outer diameter, in mil |
| `holeDiameter` | Via drill diameter, in mil; must be smaller than the copper diameter |
| `clearance` | Minimum copper-to-copper clearance, in mil |
| `staggerLength` | Optional alternating offset, in mil; defaults to 0 |
| `layer` | For multilayer or through-hole pads, specify `top` or `bottom`; ordinary SMT pads keep their current copper layer |

Example dimensions below come from a tested MCU fixture; choose values for the current design and replace the window and component IDs with current query results:

```json
{"instanceId":"current window ID","cmd":"pcb.getFanoutPlan","params":{"componentIds":["current MCU primitive ID"],"direction":"auto","lineLength":80,"lineWidth":5,"viaDiameter":14,"holeDiameter":7,"clearance":4}}
```

The execution request passes the complete plan returned above:

```javascript
const request = { instanceId: currentInstanceId, cmd: "pcb.fanout", params: { plan: planResponse.data } };
// POST /command with request as the JSON body.
```

Planning and execution are separate commands; users do not need to draw each trace or verify each primitive manually. For batches, execute one batch before planning the next so the next plan includes the new traces and vias. If a plan is non-executable, adjust targets or dimensions based on its reason and re-plan. If execution is uncertain, inspect read-only before avoiding duplicate creation.
Exactly one of `padIds`, `componentIds`, or `net` must be specified. `direction` can be `auto`, `8directions`, or `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`; it defaults to `auto`. Both `auto` and `8directions` try eight directions and select a shorter available route. `staggerLength` is an optional alternating offset along the perpendicular to the exit direction, following target traversal order: `+staggerLength/2`, then `-staggerLength/2`; it defaults to 0 mil. It does not change `lineLength` or reorder adjacent package pins. An excessive offset can crowd neighboring traces or vias.

Explicitly provide `lineLength`, `lineWidth`, `viaDiameter`, `holeDiameter`, and `clearance`, all in mil. No DRC rule field has been verified as universally applicable, so the plugin will not guess defaults from the rule structure. If any value is missing, the hole diameter is not smaller than the via outer diameter, geometry/net/layer data is incomplete, or route search finds no result, the plan is not executable. Multilayer or through-hole pads require an explicit `layer: "top"` or `"bottom"`; top/bottom SMT pads retain their actual copper layer. The current tool creates through vias; do not treat its result as blind or buried via fanout.

Supported oval, obround, and rounded-rectangle pads are sampled at angular steps no greater than 10 degrees and conservatively expanded outward according to sagitta error. This does not mean all curved pads are supported. Curves (`C`/`ARC`/`CARC`) in complex pad polygons, curved copper surfaces or regions, and arc-shaped board outlines or board-interior boundaries cannot currently be parsed safely and make the plan non-executable. A standalone arc track can be treated as an obstacle after expansion by sagitta error.

The plan reports actual target-pad coordinates, net and layer, route groups, proposed traces/vias, candidate search count, and any limitations. Endpoint rings and route-offset attempts are calculated from the actual maximum offset and sampling interval; they are not fixed at eight rings or six attempts. There is no fixed candidate-count cap. Search covers the current geometric candidate range and remains subject to the shared command-time budget. `checkedCandidates` counts line-path candidates actually checked, not candidates rejected by endpoint-via checks. If obstacle, board-outline, keepout, or target-shape data is incomplete, do not treat partial geometry as a safe route. Selecting a net means fan out target pads on that net; it does not mean that the entire net is connected.

Execution creates new traces and vias segment by segment and reads back net, layer, coordinates, and dimensions by primitive ID. A successful receipt includes `createdIds`, `verifiedIds`, per-item `readback`, and `saved:false`. This confirms only that new primitives match the plan; it does not mean DRC passed, the net is fully connected, or manufacturing requirements are met.

### Implementation and test notes

Fanout history: v0.10.129 was tested after installation: planning/creation took about 249/267 seconds for 100 top-layer pads and 203/185 seconds for 100 bottom-layer pads at 90°. All 435 primitives on both sides were read back and remained consistent after save-close-reopen; existing components and nets were preserved. DRC still found two via-hole clearances of 11.211 mil, below the board-level 11.8 mil requirement, so the full-board DRC did not pass. A complete top-layer plan in v128 exhausted the budget; v129 skips candidates that cannot outperform the current best before collision calculation while preserving the original selection rule, complete sampling, and candidate counts.

Version 0.10.130 reads the current default via-hole clearance rule, converts units, and checks candidate via endpoints against both actual drill radii. It does not change the input copper clearance, checks same-net vias too, and does not apply hole spacing to bends without drills. If the rule is missing or non-default, it keeps the original plan and reports that hole spacing was not verified instead of guessing zero; if the configured default cannot be interpreted, it reports the specific error. Coverage is limited to through-via-to-through-via spacing; it does not establish checks for PTH pads, NPTH, slots, blind/buried vias, or every manufacturing rule.
In 0.10.130, the full 100-pad MCU test passed for top 0° and bottom 90°: planning, creation, per-item read-back, and save-close-reopen matched across 442 primitives, with zero DRC violations before and after. The actual minimum hole-edge clearance was 12.4 mil, above the then-current 11.8 mil default; the two hole-spacing issues from v129 were gone. This applies to that isolated MCU fixture only, not other rotations, obstacle combinations, or every manufacturing rule.

On 2026-10-12, version 0.10.125 was tested on a real 100-pad MCU. Top-layer `auto` planning took about 134 seconds and execution 144 seconds; 113 traces and 100 vias passed item-by-item readback and save/close/reopen. Bottom-layer 90° `8directions` planning for 100 pads took about 132 seconds and produced a complete plan; combined geometry checks for both sides passed. During execution at U2_P075, the host merged two same-direction collinear segments and invalidated a returned ID, so execution stopped with 55 primitives remaining. The bottom side was partial; acceptance of a complete 200-pad write did not pass. The partial state was inspected, saved after reopen, and backed up. The 0.10.127 candidate merges same-direction collinear segments on the selected final route and rechecks the original obstacles and clearance; execution retains strict ID verification. Host testing of that candidate was pending. Unsupported shapes and curves below remain non-executable.

Version 0.10.143 completed a post-placement boundary matrix on a new copy. Planning in all eight directions, including `auto`/`8directions`, and the vertical ±4 mil meaning of `stagger` passed. A 45° case and an opposite-net board-edge obstacle case passed creation, independent geometry checks, zero-violation DRC, and save/close/reopen. Twelve malformed-input cases, tampering, wrong-document use, changed baselines, replay, and non-executable plans were rejected before writing. After reopening the 45° case, the only source addition was one component Name display property; traces, vias, component angle, and 200 pad nets were unchanged. This does not claim byte-for-byte equality of the whole source. The original board was unchanged.

Version 0.10.124 reuses exact directed-segment checks only within one route search, without coordinate rounding. Cache hits still consume the search budget; failures and interruptions are not cached. Results are not shared across directions, targets, or batches. Version 0.10.121 checks each candidate endpoint via once and returns early for a valid non-degenerate straight route in one of eight directions when it reaches that endpoint with minimum length and segment count. Other segments still check board outline, keepouts, and obstacles. `auto` and `8directions` still compare all eight directions. `checkedCandidates` counts actual line-path candidates, excluding those rejected by endpoint-via checks. There is no fixed candidate-count ceiling; search remains within the current geometry candidate range and shared command budget.
## Automatic local copper

### Purpose and when to use

Add a local same-net copper area to selected pads, vias, or components for local connection, current carrying, or heat dissipation. Use after component placement where extra copper is needed; existing tracks participate in planning. `pour` creates an outline and rebuilds fill under current PCB rules. `fill` creates fixed copper geometry. A small `pour` can be entirely removed by thermal isolation, keepouts, or island rules; adjust the area based on the reported reason or explicitly choose `fill`. Do not switch modes automatically.

### Workflow and usage

1. Activate the target PCB and obtain target IDs with `pcb.listComponents`, `pcb.getComponentPads`, or `pcb.listVias`.
2. Call `pcb.getAutoCopperPlan` with `targetIds`, `layer`, `expansion`, and the required mode.
3. Pass the complete response `data` unchanged as `params.plan` to `pcb.autoCopper`.
4. The plugin creates geometry and reads it back; for `pour`, it also rebuilds and checks the actual fill.
5. Run `pcb.runDrc`, then save with `pcb.save`.

Example: `{"targetIds":["current pad or via ID"],"layer":"top","expansion":30,"generationType":"pour"}`. For fixed copper, explicitly set `generationType:"fill"`. The request is `{"cmd":"pcb.autoCopper","params":{"plan":planResponse.data}}` and still requires top-level `instanceId`. Sizes are in mil and must be chosen for the current design.

On 2026-10-12, fixed copper fill on a new 0.10.130 copy passed creation read-back, save-close-reopen, and DRC with zero violations. In installed 0.10.131, a false coverage rejection caused by rounding a single-via circular outline was fixed. Same-net copper-pour outline creation, actual fill rebuild, and independent read-back passed. After save-close-reopen, outline and fill remained complete, all 773 existing records were unchanged, and DRC had zero violations both before and after.

`targetIds` is required and must contain unique primitive IDs; IDs can refer to pads, vias, or components. Components are expanded to their pads. `layer` must explicitly be `top` or `bottom`. Optional `net` filters targets by net. `expansion` is the outward expansion in mil and defaults to 5. `generationType` is `pour` or `fill` and defaults to `pour`. Chamfer options are `enableChamfer` (default `false`), `chamferType` (default `straight`), and `chamferWidth` (default 5 mil).

The plan groups targets by net and target copper layer, then creates separate polygons; it does not merge different nets into one region. Ordinary SMT pads are not projected onto the opposite side. The plan lists selected and excluded targets, each group's geometry, actual boundary/spacing/clipping handling, rule information, diagnostics, and degradation notes. Incomplete object or rule data, unresolved geometry, or conflicts make the plan non-executable. Boundary generation and clearance reuse the relevant geometry pipeline from `JLCEDA/eext-auto-copper-shape`, but the plan is not a complete board-level DRC conclusion: if an untreated arc is near a target, the plan is non-executable. Only a verified single-loop board outline is accepted (native straight segments or the supported rectangle above); multi-loop or arc outlines are not executable. Read `coverage` and `warnings`; do not describe limited coverage as a complete manufacturing check.

The default `generationType: "pour"` creates copper-pour outlines per group, rebuilds the fills, and reads back the new fill primitives. Success results distinguish geometry read-back, copper-pour ordering source read-back, and fill read-back. `generationType: "fill"` creates and reads back fixed-fill geometry without rebuilding copper-pour outlines. Execution does not automatically run DRC or save. Partial failure does not automatically undo primitives already created.

## Single-loop geometry read-back (0.10.98)

Only after-creation geometry read-back allows a single straight closed loop to differ by a changed start vertex, full reversal, or one-/two-dimensional single-loop wrapping. It still requires finite coordinates, explicit closure, and at least three distinct vertices, and compares ordered vertices exactly. No tolerance, resampling, or collinear-point removal is added. Multi-loop geometry continues to use strict comparison; support for holes or curves is not expanded. Net, layer, and complete pre-write plan checks are unchanged.

Read-back evidence retains the planned source, actual source, and comparison method. If actual coordinates, edges, net, or layer differ, later writes still stop and partial execution is reported; do not resubmit the old plan. In 0.10.98, real-host comparison and ordered read-back after outline reversal passed, and rebuild returned success. A subsequent actual-fill SDK adaptation check failed, so the original command remained incomplete.

## Actual fill read-back (0.10.99)

The fill primitive's associated Pour ID is used to read its parent outline independently and check ID, net, and layer; the result states that net and layer come from the parent outline. A fill subregion's `path` is a complex polygon object, whose original path is read with `getSource()`. The check verifies a `fill:true` subregion, a non-empty path array, and scalar structure. It does not prove that fill geometry is correct or meets manufacturing requirements. Exceptions preserve evidence and stop later writes; success is reported only after all checks complete. Actual fill may be clipped by copper-pour rules, so it is not required to exactly match the parent outline, and source coordinate units are not inferred.

`pcb.getPourFillReadback` and post-execution checks share the same read-back logic. Given a known outline `primitiveId`, expected `net`, and `layer`, it can inspect an existing fill without creating, rebuilding, saving, or unprotecting anything. It supports read-only recovery checks and cannot reclassify a partial failure of an earlier command as success. On 2026-10-10, read-only inspection on an isolated 0.10.99 host passed for the same copper area created and rebuilt in 0.10.98. Testing confirmed that Poured has no net/layer getter and `path.getSource()` returns a non-empty path; the parent outline matched the boundary checked earlier. After save-close-reopen, the parent outline, associated fill, path, and fanout primitives remained consistent, and DRC reported 0 errors/0 warnings. This evidence covers the new shared read-back logic and persistence. The full copper-creation command was not rerun on 0.10.99, and the 0.10.98 record of the original command's partial failure remains unchanged.

## Pad expansion (0.10.103)

### Purpose and when to use

Create a manufacturing region around a selected pad to control nearby copper pours, fixed fills, or solder-mask openings. This does not change the pad's copper size or add conductive copper. Use it when pours or fills must be kept away from a pad, or a local solder-mask opening must be expanded.

### Workflow and usage

1. Activate the target PCB and obtain pad IDs with `pcb.listComponents` or `pcb.getComponentPads`.
2. Call `pcb.getPadExpansionPlan` with `targetIds`, `expansion`, and `generationType`.
3. Pass the complete response `data` unchanged as `params.plan` to `pcb.expandPads`.
4. The plugin creates the region and checks its path, layer, and rules. Inspect the result and save with `pcb.save`.

Example: `{"targetIds":["current pad ID"],"expansion":3,"generationType":"noPours"}`. Use `noFills` to prohibit fixed fill and `solderMask` for solder-mask expansion. Requests require top-level `instanceId`; execution is `{"cmd":"pcb.expandPads","params":{"plan":planResponse.data}}`. Expansion is in mil; inspect actual solder-mask openings in manufacturing output.

On 2026-10-12, in a new 0.10.130 PCB copy, two regions each were created for keepout-of-pour and keepout-of-fill; top and bottom solder mask each received one annular fill. Creation/read-back, save-close-reopen, and DRC passed; existing components and pad nets were preserved. On save, empty association fields in the two solder-mask fills normalized from `[null]` to `null`; paths, layer, net, line width, and other attributes remained unchanged.

`targetIds` specifies pad or component IDs. A component expands to its pads, and each pad is processed only once. `expansion` is a positive mil value. `generationType` must be explicitly one of `noPours` (keep out of copper pours), `noFills` (keep out of fills), or `solderMask` (solder-mask expansion geometry).

Output is an annulus formed by subtracting the original pad outline from the expanded outer outline; it does not modify original pad attributes. Top- or bottom-layer pads generate on that side; multilayer pads generate on both top and bottom. The initial version supports oval, obround, and rectangular (including rounded-corner) shapes. Shapes that vary by layer, custom polygons, and regular polygons whose orientation has not been verified make the entire plan non-executable. Curved shapes are approximated by sampling; inspect the actual boundary in the host.

Keepout output splits each side's annulus into two hole-free polygons; their union must equal the original annulus. Solder-mask output remains a double-ring fill with an inner hole. The plan retains the complete annulus and each piece; do not remove pieces before submission.

Primitive line width is explicitly 0.2 mil and is used for creation and read-back. `expansion` is the outward offset of the path outline. The effect of line width on the final solder-mask or keepout boundary has not been verified; do not use it to promise a manufacturing opening size.

Before execution, targets are read again and the complete plan is recalculated. After creation, primitive type, layer, rules, and geometry are checked by ID, and the complete path is checked against current project source. Coordinates allow only a 0.0001 mil serialization difference. Immediate source read-back does not prove the data persists after saving. If the result is uncertain, stop and inspect the current state before proceeding. The command does not automatically save, delete old results, or retry.

Pad expansion in 0.10.101 did not pass. Keepout immediate source showed inner and outer rings, but only the outer ring remained after save-close-reopen; solder-mask double-ring fill persisted. It was also found that the SDK polygon getter returns only the outer ring, zero line width becomes 0.2 mil in practice, and the empty-net getter diagnostic was normalized to `null` without distinguishing the original value type at the time. The failed sample is not a qualified expansion result. Fixing only read-back checks would not prove the persistence issue resolved.

Real-host testing on EDA 4.1.71 in 0.10.102 showed that the single-ring split paths and attributes for 8 keepout regions persisted after save-close-reopen; the original components, pad nets, and 8 net labels were unchanged. Solder-mask double-ring fills and empty net values in source persisted, but the SDK empty-net check still failed. Version 0.10.103 only added compatibility for a null empty-net value and recorded the SDK net-value type; it still requires `netName` in source for the same ID to be strictly empty. Version 0.10.103 real-host testing confirmed the SDK's empty-net type is `null`. After save-close-reopen, a total of 16 keepout pieces and 6 solder-mask fills retained complete paths, layers, rules, line widths, and nets; original components/pad nets/8 silkscreen labels were unchanged. For one bottom-layer rotated rectangle sample, the Gerber outer boundary matched the planned path with a maximum coordinate difference of about 0.000001 mm. Do not generalize this result to every shape or to the actual effectiveness of keepout areas.
## Net-name silkscreen

### Purpose and when to use

Generate editable text from pad net names to identify connection points, test points, and interfaces. Use this when asked to label pads with net names or generate net silkscreen. It is typically used after component placement while arranging silkscreen, and supports top and bottom layers. Output remains editable text; font, position, rotation, and mirroring can be set.

### Workflow and usage

1. Activate the target PCB and obtain pad IDs with `pcb.getComponentPads`.
2. Call `pcb.getNetSilkscreenPlan` with `targetIds`, the silkscreen layer, and placement.
3. Pass the complete response `data` unchanged as `params.plan` to `pcb.generateNetSilkscreen`.
4. The plugin creates text and reads its attributes back. Check legibility and overlap with pads, then save with `pcb.save`.

Example: `{"targetIds":["current pad ID"],"layer":"top-silk","position":"right","offset":30,"fontSize":25,"lineWidth":3}`. For the bottom layer use `layer:"bottom-silk"`; explicitly set `mirror:true` if mirroring is needed. Use `rotation` for rotation. Positions and sizes are in mil; rotation is in degrees. The execution request is `{"cmd":"pcb.generateNetSilkscreen","params":{"plan":planResponse.data}}`, with top-level `instanceId`.

On 2026-10-12, on a new 0.10.130 PCB copy, creation and independent read-back passed for two top-layer labels and two bottom-layer labels mirrored and rotated 90°. All text attributes remained after save-close-reopen; existing components and nets were unchanged and DRC had zero violations.
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
- Local regressions do not establish host or manufacturing acceptance; see the evidence and limitations above.
- Pad expansion reference: [eext-pad-expand-helper](https://github.com/easyeda/eext-pad-expand-helper/tree/de5b2eb6bd6817bb25025d621c2f6010bc110cab), Apache-2.0.
- Net silkscreen reference: [eext-generate-silkscreen](https://github.com/easyeda/eext-generate-silkscreen/tree/f87bf3c725dea2dcb2b825a9faa90cb869dba86b), Apache-2.0. This implementation uses native text only.



