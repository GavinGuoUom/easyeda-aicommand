---
name: ai-command-engine
description: Operate, inspect, and verify EasyEDA Pro schematics, PCBs, projects, and libraries, or query JLC SMT parts through the AI Command Engine. Use for drawing, modifying, checking, or searching parts in EasyEDA Pro.
---

# AI Command Engine — EasyEDA Pro commands

[简体中文](SKILL_ZH.md)

## Development requirements

When developing, modifying, or reviewing plugin commands, follow [development requirements](references/插件开发要求.md). They apply to plugin development, not ordinary command use.

## Connect and operate

Send JSON over HTTP to `http://localhost:49720`. Do not invent `eda.*` APIs. The EasyEDA Pro extension must be installed and enabled with “Allow external interaction” checked, and the `bridge/command-proxy.mjs` proxy must be running. By default, start the proxy manually; automatic launch requires registering the local URL scheme first. For first-time setup, see [setup](references/setup.md).

Before operating, run `GET /health`, then `GET /connections` to confirm the target project and obtain a fresh `instanceId`. Send commands using `POST /command` with top-level `cmd`, `instanceId`, and optional `params`; `/select` is not a request route. If unsure about parameters, use `GET /help?cmd=<name>`. Before `schematic.*` or `pcb.*` commands, activate the document with `editor.openDocument` and the UUID from `project.getInfo`.

Inspect before drawing. Prefer batch commands. Read back after drawing because apparent success can be false. Save often and back up before major changes. A timeout does not mean cancellation: if a `taskId` is returned, check progress and verify with read-only commands; do not blindly resend or automatically clear write protection. Include the top-level `instanceId` in every command and do not cache it.

If an instance is rejected as “paused by the user,” it was paused from the EDA “AI Command” menu. The command was not sent to a window. Do not reconnect by yourself or replay an old module. Ask the user to choose “连接指令代理” (“Connect Command Proxy”); since 0.10.69, resuming requires a token and only the menu action clears the pause. The instance shows `paused:true` in `/connections`. After every instance is paused and disconnected, the proxy exits after 300 seconds idle.

Schematic coordinates use 10 mil per unit (A4 is approximately 1170 × 825 units); PCB coordinates use mil (1 mm ≈ 39.37 mil). Mixing them causes a tenfold error. For visual acceptance use `schematic.exportPng`: a background `editor.screenshot` may capture a cached frame; identical consecutive bytes mean the canvas did not redraw. See [setup](references/setup.md) and [pitfalls](references/pitfalls.md).

## Choose commands by task

Start with [tasks](references/tasks.md) to map a goal directly to a command sequence. Common tasks:

| Goal | Command |
| --- | --- |
| Audit a full schematic page | `schematic.structuralAudit` |
| Draw a functional block | `schematic.buildBlock` |
| Wire in batches | `schematic.batchWire` (`labelWire` for one pin; `linkWire` for two pins) |
| Organize a schematic | `schematic.autoLayout` (run `dryRun` first) |
| Reconcile connectivity | `schematic.exportNetlist` |
| Switch projects | `schematic.save`, then `project.open` |
| Transfer a schematic to PCB | The user starts and confirms the transfer in EDA; AI only performs read-only checks before and after. Do not call the plugin or official import API. |
| Export manufacturing data | `pcb.exportGerber` / `exportPickPlace` plus `schematic.exportBom` |

For a complete component replacement, place a temporary instance of the new part, verify its identity, pins, connections, and required properties, then remove the old component and restore selected attributes on the new instance. Use `project.getDocumentSource` only for read-only checks of the mirror and project properties. There is no single automatic replacement command. Follow [component replacement](references/commands-schematic.md#complete-component-replacement) and the current installed command help. Do not use removed `schematic.getComponentUpdatePlan` or `schematic.updateComponents` commands.

## Command risk levels

**Recommended:** Batch commands such as `buildBlock`, `autoLayout`, `batchWire`, and `macro` provide progress heartbeats. Use `labelWire` and `linkWire` for semantic connections. Read-only checks include `structuralAudit`, `list*`, `get*`, and `runDrc*`. Use `dryRun` before repair commands.

**Allowed but slower:** Sending mutations one at a time (`placeDevice`, `drawWire`, `labelWire`, or one `delete`) works, but combine multiple operations into `batchWire` or `macro` where appropriate. Serial requests are fine. The proxy queues concurrent requests one by one since 0.10.50, reducing throughput to about three seconds per command. Since 0.10.51, failed batch items include a truncated `error` stack with its name and stack.

**Risky if misused:** If `autoLayout` partially fails, inspect `error.cause.moved` and verify the current state. It does not roll back; recover under control from a backup. There is no general undo API, and UI undo is not guaranteed. A repair without `dryRun` may remove a label that must then be redrawn. `delete` has no undo. `importFile` overwrites and cannot be rolled back. `groupBySchematicRegions` cannot be rolled back without a backup. When the user starts an import in EDA, `importChanges` with nonzero DRC errors syncs those errors to the PCB. Changing a designator can misalign it, and the host may normalize it again.

## Geometry and ordering checks

For MCU or fine-pitch fanout, select the target PCB and pads, call `pcb.getFanoutPlan`, pass its complete `data` unchanged as `params.plan` to `pcb.fanout`, then run `pcb.runDrc` and save with `pcb.save`. The plugin reads back each created item; use routing commands for board-wide connectivity. See [geometry commands](references/commands-geometry.md#pad-fanout) for target selection, dimensions, and examples.

For local copper, pad expansion, or net-name silkscreen, call the planning command first and pass its complete `data` unchanged as `params.plan` to the execution command: `pcb.getAutoCopperPlan` → `pcb.autoCopper`, `pcb.getPadExpansionPlan` → `pcb.expandPads`, or `pcb.getNetSilkscreenPlan` → `pcb.generateNetSilkscreen`. These commands read back created geometry. Read the result and save. See [geometry commands](references/commands-geometry.md).

JLC ordering checks are available through `pcb.runDfm`, `pcb.runSmtDfm`, and `pcb.checkSameNetPadSpacing`. See [DFM commands](references/commands-dfm.md) for coverage and inputs. `pcb.runDfm` requires explicit local options `outerCopperOz` and `innerCopperOz`; report drawing source copper thickness separately. A difference or missing source value alone is not a failure. Command success does not mean the checks passed. Do not report a pass unless all required checks completed.

For less common behavior, see [project/board commands](references/commands-project.md) for `project.copyPcb` default ownership and uncertain-result handling, and [PCB commands](references/commands-pcb.md) for layer aliases, `modifyPour` readback priority, and stop rules. `modifyPour` 0.10.89 passed local simulation and isolated-project checks for priorities 0/1, stopping on partial failure, and save/reopen; arbitrary order values remain constrained by the host.

## Command references

| Area | File |
| --- | --- |
| Schematic, including macros | [commands-schematic.md](references/commands-schematic.md) |
| PCB, including low-frequency commands and autorouting | [commands-pcb.md](references/commands-pcb.md) |
| PCB fanout, local copper, pad expansion, and net silkscreen | [commands-geometry.md](references/commands-geometry.md) |
| JLC ordering checks (DFM/SMT/same-net spacing) | [commands-dfm.md](references/commands-dfm.md) |
| Nets, differential pairs, and manufacturing exports | [commands-net.md](references/commands-net.md) |
| Projects, boards, and schematic pages | [commands-project.md](references/commands-project.md) |
| Reusable blocks | [commands-cbb.md](references/commands-cbb.md) |
| Standalone module-reuse extension RPC | [commands-module.md](references/commands-module.md) |
| Custom libraries and in-project part selection | [commands-lib.md](references/commands-lib.md) |
| Knowledge base and SMT parts | [commands-knowledge.md](references/commands-knowledge.md) |
| Low-frequency commands | [commands-misc.md](references/commands-misc.md) |
| Goal-based command lookup | [tasks.md](references/tasks.md) |
| Connection, coordinates, activation, timeout, and screenshots | [setup.md](references/setup.md) |
| Standard workflow and operating rules | [workflow.md](references/workflow.md) |
| Field notes for troubleshooting | [pitfalls.md](references/pitfalls.md) |
| Development and historical verification | [插件开发要求](references/插件开发要求.md), [历史验证记录](references/历史验证记录.md) |
| Reporting plugin issues | [issue-reporting.md](references/issue-reporting.md) |

The standalone `module.*` commands are forwarded to the separately installed module-reuse extension. Its current limitations and test history are in [commands-module.md](references/commands-module.md). Do not treat those commands as part of this extension.

Schematic auto-wiring was removed starting with 0.10.100. Draw schematics from explicit connection relationships using `drawWire`, `batchWire`, `labelWire`, `linkWire`, or `buildBlock`. PCB autorouting is unaffected.

## Standalone installation

This skill is published with the extension in the [AI Command Engine GitHub repository](https://github.com/quhuii-lgtm/easyeda-aicommand). Download the companion skill ZIP from the latest formal release, extract it, and install the complete `ai-command-engine/` folder in the AI tool's skill directory. Keep `references/` and `scripts/`; do not copy only `SKILL.md`.

Install the extension, proxy, and skill separately. The extension package does not install the local proxy or skill. See the repository [installation guide](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md) for proxy installation, enabling the extension, and checking the connection target.

## Reporting plugin issues

For an actual plugin issue, collect and redact only the necessary information described in [issue reporting](references/issue-reporting.md). The user may choose GitHub CLI as the submitting identity. Before submitting, tell the user which repository, title, body, and evidence will be made public. If the creation result is unknown, check GitHub first; do not submit again. This workflow is not triggered automatically by EDA commands and does not scan or upload the whole project.
