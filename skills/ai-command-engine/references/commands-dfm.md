# JLC Order Checks (PCB DFM)

> P11 version note: version 0.10.90 had a DFM entry-point issue. Version 0.10.91 was rechecked on a specified PCB through command invocation and produced 18 results; the menu iframe and export still awaited host acceptance. Source parsing in 0.10.91 reported 1 oz for both outer and inner copper. These were drawing values and could not substitute for the order copper-thickness inputs added in 0.10.92.

> This page describes `pcb.runDfm`, `pcb.runSmtDfm`, `pcb.checkSameNetPadSpacing`, and the PCB menu “嘉立创下单检查”. Commands use the existing `/command` route and must include top-level `instanceId`.

## AI commands

| Command | Required parameters | Coverage |
| --- | --- | --- |
| `pcb.runDfm` | `material`, `thickness`, `outerCopperOz`, `innerCopperOz` | 18 PCB checks. `material` must be exactly one of `FR4`, `HDI板`, `高频板`, `铝基板`, or `铜基板`. `thickness` is a finite positive number in mm. Outer copper must be numeric `1` or `2`; inner copper must be numeric `1`. Missing inputs and other copper values are rejected. Copper is selected from this order's inputs; it is not filled from the drawing or a default. |
| `pcb.runSmtDfm` | `standard`, `thickness` | 7 SMT checks. `standard` is `economy` or `standard`; thickness is a finite positive number in mm. |
| `pcb.checkSameNetPadSpacing` | `minSpacingMm` | 1 same-net pad-spacing check. Spacing is a finite positive number in mm. |

The material list comes from the reused upstream core export `JLC_SUPPORTED_MATERIALS`. The check implementation reuses [upstream project](https://github.com/easyeda/eext-jlc-order-dfm-checker) v1.0.4, commit `afd538786d510f537ad4fa47c6329e6a99dc7625`, licensed under Apache-2.0. No dependency was added. Its process table and geometry algorithms do not mean that the data is synchronized with JLC's current website. Upstream v1.0.4 originally accepted only material and thickness; `outerCopperOz` and `innerCopperOz` are local enhancements. This implementation supports only outer 1/2 oz and inner 1 oz, not every manufacturer option.

`pcb.runSmtDfm` and `pcb.checkSameNetPadSpacing` do not add copper-thickness inputs. The PCB DFM menu form asks the user to select outer 1 or 2 oz and inner 1 oz; those options apply only to PCB DFM.

Before use, confirm that version 0.10.92 or a later version with this enhancement is installed, and that online command help shows both copper-thickness parameters. Version 0.10.91 does not support them and may ignore extra fields. Merely adding parameters to an old-version request does not prove that the selected thickness was checked. New reports must echo `inputs.outerCopperOz`, `inputs.innerCopperOz`, and `reportedCopper`.

## Results and completeness

A successful command response retains `results`, `expectedCount`, `issues`, and `coverage` in `data`; each issue contains `code`, `message`, and optional `item`. `data` also contains `documentUuid`, `checkType`, `inputs`, `timestamp`, `upstream`, and summary fields `upstreamPassed`, `complete`, and `passed`. The legacy field name `upstreamPassed` means all adapted results from the reused implementation are `success`; it does not mean the official online service passed or that the algorithm is line-by-line unchanged. The menu and TXT label this “all individual checks passed.” Individual passing checks do not mean the whole check passed. Report success within the command's coverage only when `complete:true` and `passed:true`. `complete:false` must also have `passed:false`. A response with `ok:true` means only that the handler returned; it does not mean `data.passed:true`.

The three checks retain their expected 18, 7, and 1 raw results. If a required input is incomplete, reading fails, or a fallback/inferred value is used, the adapter marks the result incomplete; do not report full success. Examples include source-read failure, partially readable net data, missing pad dimensions, or using a fallback when no board outline is available. Copper-thickness inputs are never defaulted; drawing source thickness is handled separately below. Read `coverage`, completeness flags, and `upstream` details; do not rely only on `passed` or the issue count.

## Order inputs and drawing copper readout

`pcb.runDfm` checks support using the copper selections in the current request: check 5 evaluates the selected outer copper thickness, check 6 evaluates the selected inner thickness, and checks 12/13 select thresholds from the original process table according to design copper layers and layer count, using the selected outer or inner thickness. Process-table values and geometry algorithms are unchanged. The effective copper-layer count in other checks still uses the existing heuristic based on copper primitives.

The PCB response also includes `reportedCopper`, separately from DFM decisions: `status` is `available`, `partial`, or `unavailable`; `layers` is `[{layerId:number, thicknessMil:number|null, copperOz:number|null}]`; `matchesTarget` is a boolean or `null`; `differences` is `[{layerId, requestedOz, reportedOz}]`; and `messages` is an array of diagnostic strings about collecting source copper thickness. Requested thickness remains in `inputs`; check thresholds reflect the current outer/inner inputs.

If drawing copper differs from the current input, lacks `LAYER_PHYS` records, or cannot be parsed, report that only in `reportedCopper`; do not add an issue solely for that or fail DFM on that basis. If a source-read error affects required geometry, identity, or API data, existing rules still require an issue and an incomplete result; copper readout does not waive it. The 1 oz outer/inner values in the 0.10.91 host report were source readings, not evidence that the user requested 1 oz. A difference alone is not a DFM failure.

## PCB menu behavior

The PCB top-bar “嘉立创下单检查” menu provides the three checks above and shares their check handler and result summarization with AI commands. It can show individual results and issue locations. When the user selects “导出TXT” or “导出JSON”, the host save dialog lets the user choose the report path. AI commands do not open dialogs, clear logs, or write reports automatically. A command does not save, repair, upload, or place an order. Location navigation is for viewing and does not edit the drawing.

If focus or PCB identity changes after the menu or command starts, later reads and report delivery stop. Before locating an issue, confirm that the target PCB matches the active board; do not navigate using coordinates from another board. If an old DFM window session expires, close it and reopen from the PCB menu. The menu form, AI command, and TXT/JSON exports should show the same `inputs`, outer/inner thresholds, and `reportedCopper` comparison.

## Coverage limits

These checks reuse an upstream plugin's process table and algorithms. They are not a full JLC online DFM service or manufacturing release. Current geometry coverage uses explicit approximations: line spacing checks only positive gaps between `Line` objects, not contacts, overlaps, `Arc`, or `Polyline`; obround and unequal annular rings use the maximum axis approximation; same-net pad spacing uses capsule and inscribed-circle approximations; effective copper layers are inferred from layers containing copper primitives; EIA/BGA types are identified by name. Location IDs are matched approximately using indexes from two lists, so issue locations may be inaccurate. Menu navigation is only a visual aid and does not modify the drawing. Have an engineer review raw results and `coverage` together.

Version 0.10.90 passed local regression suites for core (20/20), command/menu (8/8), owner (17/17), and client (32/32), plus type checking; the real host then exposed the P11 entry-point defect. Version 0.10.91 reran and passed command/menu (8/8), owner (17/17), and type checking for the lexical SDK entry; unchanged core/client results relied on earlier evidence. On 2026-10-09, the installed command was rechecked on PCB3_1 with FR4/1.6 mm: 18 results returned, source copper read as 1 oz outer and inner, the silkscreen check failed, and 25 pad nets were unresolved, so `complete=false` and `passed=false`. Non-DOCHEAD source content matched before and after the check. Those drawing values were not order inputs. Copper-thickness input and drawing comparison in 0.10.92 passed local core (31/31), command/menu (8/8), owner (17/17), and type checks, followed by independent review; the real-host command comparison was completed below. At that time the menu form, navigation, and export dialog had not been accepted on the host.

On 2026-10-09, installed version 0.10.92 passed a read-only comparison on PCB3_1 (FR4, 1.6 mm, four design layers): with outer 2/inner 1, line width/spacing thresholds were 0.15/0.09 mm and the spacing check reported 21 violations; with outer 1/inner 1, both thresholds were 0.09 mm and the spacing check passed. Both runs returned 18 results and separately reported source copper as 1 oz. The 25 unresolved pad nets and silkscreen issue remained, so `complete=false` and `passed=false`. Non-DOCHEAD source content matched before and after both runs. Menu navigation and the export dialog had not been accepted on the host.
