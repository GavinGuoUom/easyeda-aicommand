# PCB Geometry Commands

# Specialized PCB Geometry Commands

Read this page only for fanout, local copper, pad expansion, or net silkscreen tasks. See [Less frequently used PCB commands](commands-pcb-low.md) for command names. Check parameters, defaults, and return fields in `/help?cmd=<command-name>` for the confirmed version of the selected window.

## Shared Workflow

1. Activate the target PCB and read the current component, pad, or via IDs. A designator cannot substitute for a primitive ID.
2. Run the corresponding read-only planning command. Check `executable`, target, net, layer, geometry, `coverage`, and `warnings`. Do not write if the plan is not executable or coverage is incomplete.
3. Put the **complete `data`** from the planning response, unchanged, in the execution command's `params.plan`. Do not reconstruct or remove plan fields.
4. The plugin writes and reads back each item. If some items fail, retain objects already created, inspect the current board, and do not replay the old plan. These commands do not automatically perform board-level DRC, save, or manufacturing acceptance.
5. Run applicable checks and save. To establish persistence, close and reopen the document, then check it again.

Copper operations share the SDK total time limit. A timeout does not mean an issued call was cancelled; do not start dependent writes or replay the plan until the outcome is clear.

| Task | Plan → execute | Additional confirmation required |
| --- | --- | --- |
| Fine-pitch pad fanout | `pcb.getFanoutPlan` → `pcb.fanout` | Only routes from pads to breakout vias; the remaining nets still need routing. |
| Local copper | `pcb.getAutoCopperPlan` → `pcb.autoCopper` | Distinguish boundary copper `pour` from fixed copper `fill`; confirm the actual fill. |
| Pad expansion | `pcb.getPadExpansionPlan` → `pcb.expandPads` | Creates keep-out-pour, keep-out-fill, or solder-mask regions; does not change pad copper size. |
| Net text silkscreen | `pcb.getNetSilkscreenPlan` → `pcb.generateNetSilkscreen` | Text must be readable and not cover pads; check mirroring on the bottom layer. |

## Fanout Scope

Select targets by component, pad, or net. IDs must come from the current PCB. Set trace width, via copper diameter, drill, escape length, and spacing for the current design, in mil; the drill must be smaller than the copper diameter. For multilayer boards or through-hole pads, explicitly select the top or bottom layer. The current implementation creates through-holes; do not call them blind or buried vias. If the board outline, obstacles, pad shape, or rules cannot be safely parsed, the plan is not executable. Fanout does not prove full-net connectivity, DRC compliance, or manufacturability.

## Local Copper and Filled Copper

`pour` is clipped by copper-pour rules and may leave only a boundary or no fill; `fill` is a fixed conductive shape. The two modes are not interchangeable automatically. Plans are grouped by net and copper layer; do not combine different nets into one copper shape. Current board-outline handling accepts only a verified single closed loop. If the outline has curves, multiple loops, or incomplete obstacle information, do not treat a partial plan as safe geometry.

After creating or rebuilding a copper pour, use `pcb.getPourFillReadback` for a read-only check of the associated fill, parent boundary, net, and layer. A nonempty fill path does not prove that the geometry is correct or meets manufacturing requirements. If readback fails or is unknown, stop relying on the write; a partial failure from an earlier command must not be reported as success.

New copper pours can specify `net`; `modifyPour` is not currently used to change the net or name of an existing pour. Manual operation in the EDA UI remains available; afterward check pour ordering, rebuild, and read back the actual fill. Do not recommend that AI automatically delete and recreate a pour as a lossless net/name change.

The v0.20.40 `pourCopper` single-R path candidate accepts only a one-dimensional path or exactly one wrapper layer and checks all seven items for exact equality; it rejects multiple rings, additional nesting, or changed parameters. Raw and normalized inputs are available for diagnosis. Unified candidate regression and newer-host validation remain pending.

Starting with v0.20.22, `pcb.autoCopper(pour)` independently reads back the actual fill even when the rebuild call returns empty. It reports success only after checking the parent boundary, net, layer, boundary, and valid fill. If there is still no fill, it returns a non-retryable partial write and retains the created boundary ID; inspect the live board first and do not rebuild again or delete automatically. This version has not received positive host acceptance for generating a solid fill.

Starting with v0.20.23, IDs in the rebuild return object are diagnostic only and do not prove that they identify fills newly created by this operation; `createdIds` should list only confirmed newly created boundaries. Before cleanup, check the drawing source and associated IDs; do not delete based directly on rebuild return IDs. An isolated host test on 2026-10-18 confirmed that an old underlying ID was not included in `createdIds`; the new top-level boundary still had no solid fill, so automatic copper has not passed.

Starting with v0.20.24, if foreign-net obstacles reduce the target expansion to zero, the plan warns about the first triggering obstacle and clearance rule. The plan is non-executable only when it can strictly prove that the final contour of a positive-expansion `pour` plan for one standard rectangular pad equals the pad itself. Complex or unprovable shapes are reported as uncertain. `executable=true` means only that plan checks allow execution; it does not guarantee that the host creates fill. Do not infer a larger boundary by increasing `expansion`; check the actual contours in `plannedPrimitives` and `warnings`.

In v0.20.43, the existing standard single-rectangle gate additionally recognizes `Pad` / `ComponentPad`, without changing its conditions. Finite `Number` values are converted through decimal `String` into a local `BigInt` rational model to exactly compare the four corners from center ± half-size and the closed edges; a different start point or winding direction is allowed. This does not change global geometry comparison, use tolerance or rounding, or ignore tiny expansions. If unsupported or strict comparison differs, the result remains uncertain. This method cannot restore precision inside the host or guarantee a fix for all no-fill issues. Candidate local and host validation remain pending. Four small islands that do not touch the pad are assessed separately.

The v0.20.39 `autoCopper` connection-rule candidate preserves original sources and selection state. Unknown selection or inapplicable coverage in `fill` mode is diagnostic information only and does not guarantee fill generation. It does not change the `autoCopper` default of `false`, fixed copper regions, or execution semantics. Final local review and host acceptance remain pending.

- The v0.20.46 candidate retains source `thermalGap.raw` and `sourcePath`, while keeping the unit as `unknown`. `unitLabel` is recorded separately and is not used to infer mm or mil. Copper-rule `selection` remains `unknown`.
- `pcb.getComponentPads` adds a per-pad, read-only `heatWelding` diagnostic with statuses `null`, `config`, `unavailable`, `exception`, and `invalid`. Only an explicit `null` from the getter is recorded as `null`.
- Read exceptions return `{status:"exception",error:{message}}`; invalid values return `{status:"invalid",returnedType,reason}`. If the getter is unavailable, it returns `{status:"unavailable"}`.
- `config.value` lists only `connectionMethod`, `divergenceSpacing`, `divergenceLineWidth`, and `divergenceAngle`. Missing optional fields are not filled with zero. Reading a configuration does not prove override priority or which rule the host actually used.
- No command parameters or write behavior were added. Local and host validation remain pending; this does not mean the four-island geometry issue is fixed.

## Pad Expansion and Net Silkscreen

Pad-expansion modes are keep-out-pour, keep-out-fill, or solder-mask expansion; none adds conductive copper. Plans support only explicitly covered pad shapes. Curves are approximations, and the actual solder-mask openings must still be checked in manufacturing output. Do not remove any complete contours or subdivisions from the plan.

Net silkscreen consists of editable text and does not create electrical connections. Check the target pad's net name, text layer, rotation, and bottom-layer mirroring. After execution, also check visual spacing from pads, the board outline, and other text.

---

# DFM and SMT Checks

# JLCPCB Order Checks (PCB DFM)

> This page describes `pcb.runDfm`, `pcb.runSmtDfm`, `pcb.checkSameNetPadSpacing`, and the PCB menu “JLCPCB Order Checks.”
> Commands use the existing `/command` channel.
> The outer request must still include `instanceId`.

## 1. Compare Process Inputs with the Drawing

`pcb.runDfm` checks support for the copper thickness selected in the current inputs: check 5 uses the selected outer-layer copper thickness, and check 6 uses the selected inner-layer copper thickness.

Checks 12 and 13 use the selected outer- or inner-layer copper thickness, respectively, to obtain thresholds from the original process table, according to the design's copper layers and layer count.

Process-table values and geometry algorithms are unchanged.

Other checks still estimate the number of effective copper layers using the existing copper-primitive heuristic.

The PCB result also includes `reportedCopper`, separate from the DFM verdict. Its `status` is `available`, `partial`, or `unavailable`.

`layers` has the shape `[{layerId:number, thicknessMil:number|null, copperOz:number|null}]`.

`matchesTarget` is a boolean or `null`.

`differences` has the shape `[{layerId, requestedOz, reportedOz}]`.

`messages` is an array of diagnostic strings about collecting copper-thickness sources.

The requested copper thickness is still listed in `inputs`.

Check standard values reflect the current outer/inner copper-thickness inputs and their corresponding thresholds.

If the drawing's copper thickness differs from the current input, an `LAYER_PHYS` record is missing, or the drawing thickness cannot be parsed, represent this only in `reportedCopper`. Do not add it to `issues` by itself or treat DFM as failed for this reason.

If a source-read error affects required geometry, identity, or API data, it must still be added to `issues` under the existing rules and make the check incomplete.

Copper-thickness corroboration does not exempt it.

The drawing's outer/inner 1 oz values in the v0.10.91 field report are source readings; they do not mean the user requested 1 oz for the order.

A discrepancy alone is not a DFM failure.

## 2. Run Applicable Checks

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.runDfm` | Run PCB process checks. | After material, board thickness, and copper thickness are determined. | Covers only the 18 checks returned. |
| `pcb.runSmtDfm` | Run SMT assembly checks. | After selecting the assembly process. | Covers only the 7 checks returned. |
| `pcb.checkSameNetPadSpacing` | Check spacing between pads on the same net. | When checking same-net process spacing. | Covers only this spacing check. |

- `material` accepts `FR4`, `HDI board`, `high-frequency board`, `aluminum substrate`, or `copper substrate`.
- `thickness` uses mm and must be a finite positive number.
- `outerCopperOz` must be the number `1` or `2`.
- `innerCopperOz` must be the number `1`.
- The user must provide the copper thickness for the current order requirements.
- Do not fill in the requested copper thickness from the drawing or a default value.
- `standard` accepts `economy` or `standard`.
- `minSpacingMm` uses mm and must be a finite positive number.
The supported material enum is defined by `JLC_SUPPORTED_MATERIALS`, exported from the reused upstream core.

The check implementation reuses [the upstream project](https://github.com/easyeda/eext-jlc-order-dfm-checker) v1.0.4, source commit `afd538786d510f537ad4fa47c6329e6a99dc7625`, under the Apache-2.0 license.

No dependencies were added.

The process parameter table and geometry algorithms come from this upstream version. They are not necessarily synchronized with current process options on the JLCPCB website.

The original upstream v1.0.4 interface accepts only material and board thickness.

`outerCopperOz` and `innerCopperOz` are local enhancement fields.

This implementation supports only outer-layer 1/2 oz and inner-layer 1 oz; these are not all manufacturer options.

`pcb.runSmtDfm` and `pcb.checkSameNetPadSpacing` do not add copper-thickness inputs.

The PCB DFM form in the menu requires the user to select outer-layer 1 or 2 oz and inner-layer 1 oz explicitly.

These options apply only to PCB DFM.

Before use, confirm that v0.10.92 or a later version containing this enhancement is installed, and that online command help shows both copper-thickness parameters.

Older v0.10.91 does not support these parameters and may ignore the extra fields.

Adding parameters to a request sent to an older version does not prove that the check used the requested copper thickness.

The new report must echo `inputs.outerCopperOz`, `inputs.innerCopperOz`, and `reportedCopper`.

## 3. Interpret Results and Completeness

The `data` in a successful command response retains `results`, `expectedCount`, `issues`, and `coverage`.

Each `issues` item contains `code`, `message`, and an optional `item`.

`data` also contains `documentUuid`, `checkType`, `inputs`, `timestamp`, `upstream`, and summary fields `upstreamPassed`, `complete`, and `passed`.

`upstreamPassed` is a field name retained for compatibility. It indicates whether every adapted and reused result is `success`.

It does not mean the official online service passed, nor that the algorithm is identical line by line.

The menu and TXT label this “all individual checks passed.”

Passing an individual check is not the same as passing the full check.

Report a pass within the command's coverage only when `complete:true` and `passed:true`.

When `complete:false`, `passed` must also be `false`.

A command response with `ok:true` means only that the handler returned successfully; it does not mean `data.passed:true`.

The three check types retain the expected 18, 7, and 1 raw results, respectively.

If required input for the current check is incomplete, reading failed, or a fallback/inferred value was used, the adapter marks the check incomplete.

Do not report a complete pass.

For example, failed source reads, partially readable net data, missing pad dimensions, or a fallback used because there is no board outline cannot produce a passing verdict.

Copper-thickness request parameters have no defaults.

Copper thickness read from the drawing is handled separately in the next section.

Review `coverage`, completeness flags, and the `upstream` description; do not look only at `passed` or the number of issues.

## 4. Check What Is Not Covered

These checks reuse the upstream plugin's parameter table and algorithms. They are not a full JLCPCB online DFM check or manufacturing approval.

Geometry coverage has explicit approximations: track spacing checks only positive gaps for `Line`; it does not cover contact, overlap, `Arc`, or `Polyline`.

Oblong and non-circular annular rings are approximated using their major axis.

Same-net pad spacing uses capsule and inscribed-circle approximations.

Effective copper layers are estimated heuristically from layers that contain copper primitives.

EIA/BGA types are identified by name.

Location IDs are matched partly by indices in two lists, so issue locations may be inaccurate.

Menu location is for viewing assistance only.

It cannot modify the drawing automatically.

Have an engineer review the raw results together with `coverage`.

## 5. Menu Location and Report Export

The PCB top menu “JLCPCB Order Checks” provides the three checks above and shares the same check processing and result aggregation as AI commands.

The menu can display individual results and issue locations.

When the user clicks “Export TXT” or “Export JSON,” the host save dialog lets them choose where to save the report.

AI commands do not open dialogs, clear logs, or write reports automatically.

Command execution itself does not save, repair, upload, or place an order.

Location is provided for viewing assistance.

It does not modify the drawing.

If the active focus or PCB identity changes after a menu or command starts, subsequent reads and report delivery stop.

Before locating an issue, confirm that the target PCB is the current board.

Do not use coordinates from another board for locating it.

If an old DFM window session expires, close the old window and reopen it from the PCB menu.

The menu form, AI command, and TXT/JSON export should show the same `inputs`, outer/inner thresholds, and `reportedCopper` comparison.

---

# Networks and Manufacturing Exports

# Net Classes, Differential Pairs, and Manufacturing Exports (PCB)

> The tables on this page preserve use cases and limitations. Use `/help?cmd=<command-name>` for parameters, return fields, and examples, for the confirmed version of the selected window.
> A `/command` request must include `cmd`, top-level `instanceId`, and the required `params` in the outer request.
> A macro routes only the outer request; steps inherit the instance.
> See [setup](setup.md) for complete examples.

This page describes network constraints and manufacturing exports.

## Net Classes and Differential Pairs

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.createNetClass` | Create a net class (apply rules/colors consistently to a group of nets) | When managing rules by net group. | If the write outcome is unknown, stop further writes. |
| `pcb.listNetClasses` | List net classes | When managing rules by net group. | Confirm available parameters using help for the target instance. |
| `pcb.deleteNetClass` | Delete a net class | When managing rules by net group. | Confirm the target and make a backup first. |
| `pcb.renameNetClass` | Rename a net class | When managing rules by net group. | If the write outcome is unknown, stop further writes. |
| `pcb.addNetToClass` / `removeNetFromClass` | Add or remove a net-class member | When managing rules by net group. | Confirm the target and make a backup first. |
| `pcb.createDiffPair` | Create a differential pair (such as USB D+/D-) | When configuring or checking differential signals. | If the write outcome is unknown, stop further writes. |
| `pcb.listDiffPairs` / `deleteDiffPair` | List or delete differential pairs | When configuring or checking differential signals. | Confirm the target and make a backup first. |
| `pcb.getNetRules` | Read net rules in the current design rules (trace width/spacing, etc.; **read-only**—the write interface is not exposed because its structure is complex) | When checking current trace-width and spacing rules. | Reads rules only; does not provide a rule-writing operation. |
| `pcb.getNetLength` | Total routed length of a net (for equal-length checks) | When comparing actual routed lengths. | Confirm available parameters using help for the target instance. |
| `pcb.getNetInfo` / `getNetPrimitives` | Detailed net information / all primitives on a net (tracks/vias/pads) | When analyzing connected objects on a specified net. | Confirm available parameters using help for the target instance. |
| `pcb.highlightNet` | Highlight or unhighlight a net (for troubleshooting) | When locating objects or troubleshooting connections. | Confirm available parameters using help for the target instance. |

## Selection and Cross-Probing

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.select` / `pcb.clearSelection` / `pcb.getSelection` | Select by ID, clear selection, or read current selection | When reading or changing the current selection. | Confirm available parameters using help for the target instance. |
| `pcb.crossProbe` | Cross-probe: locate designators/pins/nets between schematic and PCB (highlight and select) | When locating objects or troubleshooting connections. | Confirm available parameters using help for the target instance. |

## Schematic No-Connects, Attributes, and Images

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `schematic.setPinNoConnect` | Add or remove an X no-connect marker on a pin (clear floating-pin DRC warnings) | When marking a legally unconnected pin. | A pin marked NC cannot be wired further. |
| `schematic.getAttributes` / `setAttribute` | Read or change primitive attributes (keys such as Designator/Value/Footprint) | When checking or updating an existing primitive attribute. | Can modify existing primitive attributes only. |
| `schematic.getSelection` | Read currently selected primitives | When reading or changing the current selection. | Confirm available parameters using help for the target instance. |
| `schematic.exportBom` | Export a BOM (xlsx/csv, base64) | For backup, delivery, or independent review. | Successful export does not mean the contents have passed acceptance. |
| `schematic.exportPng` | Export schematic PNG (maximum 4096 px on one side) | For backup, delivery, or independent review. | Neither side may exceed 4096 px. |
| `schematic.listNets` | List all schematic nets (`detail:true` includes wire details) | When checking the scope of existing nets. | Confirm available parameters using help for the target instance. |

## Manufacturing Exports (Save the Base64 Data Locally)

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.exportGerber` | Gerber board-manufacturing files (usually zip) | For backup, delivery, or independent review. | Successful export does not mean the contents have passed acceptance. |
| `pcb.exportPickPlace` | Pick-and-place coordinates | For backup, delivery, or independent review. | Successful export does not mean the contents have passed acceptance. |
| `pcb.exportDsn` | Specctra DSN (first step for external autorouting: `exportDsn` → external router → import with `importAutoRouteSes`) | When handing off to an external autorouter; if the filename is omitted, `board` is used. | Successful export does not mean the contents have passed acceptance. |
| `pcb.exportNetlist` | PCB netlist.<br>Since v0.10.104, rejects zero-byte files and empty base64; parse and check the export anyway. | For backup, delivery, or independent review. | Since v0.10.104, rejects zero-byte files and empty base64; parse and check the export anyway. |
