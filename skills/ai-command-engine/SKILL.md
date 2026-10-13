---
name: ai-command-engine
description: Operate, inspect, and verify EasyEDA Pro schematics, PCBs, and projects, or query JLC SMT-assemblable parts through the AI Command Engine. Use when a user asks an AI to draw, modify, or check these documents, or search for SMT-assemblable parts.
---

# AI Command Engine — EasyEDA Pro command set

[Chinese fallback version](SKILL_ZH.md)

## Development requirements

When developing, modifying, or reviewing plugin commands, follow these requirements before the operating workflow below:

- Implement the feature and make its normal workflow work before reviewing whether safeguards and limits are necessary.
- Do not let extra restrictions or development checks block feature implementation.
- A command must perform the operation it promises, and the plugin must check the result itself.
- Do not turn development notes, test steps, or acceptance procedures into prerequisites for ordinary use.
- Do not add unnecessary restrictions for development convenience, historical issues, or host behavior differences.
- Adapt the plugin to host behavior differences; do not substitute new restrictions for a fix.
- Checks that the plugin can perform must stay inside the plugin instead of being delegated to the user.
- Keep only checks needed to prevent changing the wrong project, incorrect connections, duplicate writes, or clear runtime errors.
- For every new restriction, state the specific error it prevents and prefer handling it inside the plugin.
- When a result can be confirmed, report success or failure clearly instead of always returning “pending verification.”
- When a result truly cannot be confirmed, explain why and stop dependent operations; do not automatically retry an uncertain write.
- Before delivery, verify that the normal workflow completes; a successful build alone is not sufficient.

Starting with 0.10.116, project layout requirements and short-marker features were removed and are no longer developed. Existing properties and markers in old projects are not removed automatically.

This skill can be installed on its own. It does not depend on other skills or a debugging gateway on the author's machine. To use it, the AI Command Engine extension must be installed and enabled in EDA with “Allow external interaction” checked, and the `bridge/command-proxy.mjs` proxy must be running. The proxy is started manually by default; automatic launch requires prior registration of the local URL scheme. See [setup](references/setup.md) for first-time setup.

Send JSON over HTTP to `http://localhost:49720` to operate EasyEDA Pro. Do not invent `eda.*` APIs.

JLC ordering checks are available through `pcb.runDfm`, `pcb.runSmtDfm`, and `pcb.checkSameNetPadSpacing`. See [ordering-check coverage](references/commands-dfm.md) for coverage limits. `pcb.runDfm` requires explicit local options `outerCopperOz` and `innerCopperOz`. Report the drawing's source copper thickness separately; a difference or missing value alone is not a failure. A successful command does not mean the checks passed; do not report a pass unless all required checks completed. See the reference page for the 0.10.91 P11 live result. The 0.10.92 copper-thickness inputs were compared locally and against live commands; menu navigation and the export dialog still await live acceptance.

For less common behavior, consult the reference first: see [project/board guidance](references/commands-project.md) for the default ownership and uncertain-result handling of `project.copyPcb`; see [PCB guidance](references/commands-pcb.md) for PCB layer aliases, `modifyPour` readback priority, and stop rules. `modifyPour` 0.10.89 passed local simulation and isolated-project checks for priority values 0/1, stopping on partial failure, and save/reopen. Arbitrary order values remain constrained by the host.

The 0.10.93 local candidate added commands to fan out pads and plan/execute local copper pours. The five fanout dimensions must be entered explicitly, and curve geometry has explicit coverage limits. See [geometry commands](references/commands-geometry.md) for interface, input rules, geometry coverage, and failure handling. Host acceptance status is recorded in the change log.

`modifyComponent` system-property readback passed save/reopen validation in an isolated host in 0.10.94. In 0.10.95, the page-resource API was confirmed to return an empty array. The 0.10.96 candidate changed `placeDevice` verification to use a full-project export and added `getPlacementResourcesDiagnostic` as a read-only summary of target resources. On 2026-10-10, existing TP2 diagnostics, new TP3 placement, and save/close/reopen checks passed in an isolated host running 0.10.96. This result applies only to the tested components. See [schematic commands](references/commands-schematic.md) for parameters, results, and verification scope.

## Read this before your first operation

- **Connect:** Run `GET /health` as a self-check. If it fails, start the proxy as described in [setup.md §1a](references/setup.md); if it responds but has no instances, see [setup.md §1b](references/setup.md). Check the project identity with `GET /connections`. Send commands with `POST /command`; the top-level request has `cmd`, `instanceId`, and optional `params`. `/select` does not route a request. If unsure, use `GET /help?cmd=<name>`. See [setup.md §§1–5](references/setup.md).
- **Rejected as “paused by the user”:** The user paused that instance by choosing “断开指令代理” (“Disconnect Command Proxy”) from the EDA “AI Command” menu. The command was not sent to any window, protecting the project. Do not reconnect by yourself. Replaying an old module or invoking external recovery is rejected by the proxy's resume-token check. Ask the user to choose “连接指令代理” (“Connect Command Proxy”) from the menu (since 0.10.69, recovery requires a token and only the menu action can clear the pause). That instance has `paused:true` in `/connections`. After every instance is paused and disconnected, the proxy exits after 300 seconds of idle time.
- **Coordinates:** Schematic coordinates use 10 mil per unit (A4 is approximately 1170 × 825 units; use multiples of 10). PCB coordinates use mil (1 mm ≈ 39.37 mil). Mixing them causes a tenfold error. See [setup.md §6](references/setup.md).
- **Activate a document:** Before `schematic.*` or `pcb.*` commands, call `editor.openDocument` with the UUID from `project.getInfo`. See [setup.md §7](references/setup.md).
- **Operating rules:** Inspect before drawing. Include the top-level `instanceId` in every command, freshly obtained from `GET /connections`; do not cache it. Prefer batch commands. Always read back after drawing because apparent success can be false. Save often and back up before major changes. Only run `importChanges` when there are 0 fatal errors; a timeout does not mean cancellation. If a `taskId` exists, check progress and verify using read-only commands; never blindly resend or automatically clear write protection. For visual acceptance, use `schematic.exportPng`: a background `editor.screenshot` captures a cached frame, and identical bytes on consecutive screenshots mean the canvas did not redraw (pitfalls K9–K10).

## Choose commands by task

If you do not know which command to use, start with [tasks.md](references/tasks.md), which maps a goal directly to an executable sequence without first classifying the object. Eight frequent tasks:

| Goal | Command |
| --- | --- |
| Audit a full schematic page (bridges, wrong nets, duplicate designators, layout) | `schematic.structuralAudit` |
| Draw a functional block from scratch | `schematic.buildBlock` |
| Wire in batches | `schematic.batchWire` (`labelWire` for one pin; `linkWire` for two pins) |
| Organize a messy schematic | `schematic.autoLayout` (run `dryRun` first) |
| Reconcile connectivity | `schematic.exportNetlist` |
| Switch projects | `schematic.save` first, then `project.open` |
| Transfer a schematic to PCB | `pcb.importChanges` (import only after 0 fatal errors; the user confirms the dialog) |
| Export manufacturing data | `pcb.exportGerber` / `exportPickPlace` plus `schematic.exportBom` |

## Command risk levels (0.10.61)

**✅ Recommended**
Batch commands `buildBlock`, `autoLayout`, `batchWire`, and `macro` submit several operations at once and provide progress heartbeats. Semantic connection commands are `labelWire` and `linkWire`. Read-only checks include `structuralAudit`, `list*`, `get*`, and `runDrc*`; they do not modify the drawing and are suitable for exploration and acceptance checks. PCB commands include `checkPlacement`, `routeTrack`, `pourCopper`, and `runDrc`. Always use `dryRun` first for repair commands.

**🟡 Not recommended (but allowed)**
Sending one mutation at a time (`placeDevice`, `drawWire`, `labelWire`, or a single `delete`) works but is slow; combine multiple operations into `batchWire` or `macro`. Serial requests are fine. Concurrent requests no longer error because the proxy queues them one by one (since 0.10.50), but throughput falls to about 3 seconds per command. Since 0.10.51, failed batch items include a truncated `error` stack with name and stack, which can help diagnose failures.

**🔴 Risky (misuse can cause damage)**
If a real `autoLayout` run partially fails to move objects, first inspect `error.cause.moved` and verify the current state. The command does not roll back automatically; recover under control using a backup. There is no general undo API, and UI undo is not guaranteed to work. Repair commands without `dryRun` can, for example, remove a label that must then be redrawn. `delete` has no undo, so back up first. `importFile` overwrites and cannot be rolled back. `groupBySchematicRegions` cannot be rolled back without a backup. If `importChanges` runs with nonzero DRC errors, it will sync those errors to the PCB. Changing a designator can misalign it, and the host may normalize it again.

For in-place footprint replacement and bulk property updates, use `schematic.getComponentUpdatePlan` → `schematic.updateComponents`. The staged workflow and in-place footprint/property updates have host evidence: version 138 passed save/reopen after in-place footprint and bulk-property writes, and the PCB synchronization was checked after native confirmation; version 142 passed default-configuration checks and save/reopen after footprint/property writes; version 143 returned success for bulk-property changes and a real 0402-to-0805 update, then passed save/reopen. The legacy-name fallback branch was not exercised in this run. See [schematic commands](references/commands-schematic.md) for scope, targets, and examples.

For MCU or fine-pitch device fanout, select the target PCB and pads, call `pcb.getFanoutPlan`, pass its complete `data` unchanged as `params.plan` to `pcb.fanout`, then run `pcb.runDrc` and save with `pcb.save`. The plugin reads back each created item; use routing commands for board-wide connectivity. See [geometry commands](references/commands-geometry.md#pad-fanout) for target selection, dimensions, and examples.

For local copper, pad expansion, or net-name silkscreen text, use the planning command first, then pass its complete `data` unchanged as `params.plan` to the execution command: `pcb.getAutoCopperPlan` → `pcb.autoCopper`, `pcb.getPadExpansionPlan` → `pcb.expandPads`, or `pcb.getNetSilkscreenPlan` → `pcb.generateNetSilkscreen`. Local copper serves local routing; pad expansion adds copper/clearance or mask treatment without changing the original pad size; net silkscreen commands create editable text. Use these after component placement, read back the result, and save. See [geometry commands](references/commands-geometry.md).

## Command references (11 files, by object)

| Object | File |
| --- | --- |
| Schematic (including macros) | [commands-schematic.md](references/commands-schematic.md) |
| PCB (including low-frequency appendix and autorouting workflow) | [commands-pcb.md](references/commands-pcb.md) |
| PCB fanout, local copper, pad expansion, and net labels | [commands-geometry.md](references/commands-geometry.md) |
| JLC ordering checks (DFM/SMT/same-net spacing) | [commands-dfm.md](references/commands-dfm.md) |
| Nets, differential pairs, and manufacturing exports | [commands-net.md](references/commands-net.md) |
| Projects, boards, and schematic pages | [commands-project.md](references/commands-project.md) |
| Reusable blocks | [commands-cbb.md](references/commands-cbb.md) |
| Standalone module reuse extension RPC | [commands-module.md](references/commands-module.md) |
| Custom libraries and in-project part selection | [commands-lib.md](references/commands-lib.md) |
| Knowledge base and SMT parts | [commands-knowledge.md](references/commands-knowledge.md) |
| **Low-frequency command appendix (32 commands; use `/help` for parameters)** | [commands-misc.md](references/commands-misc.md) |

## Other references

- [tasks.md](references/tasks.md) — Quick command lookup by goal: “What do I want to do?” → command sequence. Start here.
- [setup.md](references/setup.md) — Full connection, coordinate, and activation guidance cited in the beginner section, plus timeout heartbeats and editor operations/screenshots.
- [workflow.md](references/workflow.md) — Standard workflow and full operating rules.
- [pitfalls.md](references/pitfalls.md) — ⚠️ Field notes; consult first when something goes wrong.
- [issue-reporting.md](references/issue-reporting.md) — Record plugin issues, prepare a preview, and optionally submit a report.
- [commands-module.md](references/commands-module.md) — RPC commands forwarded through `module.*` to the installed module-reuse extension.

The independent module-reuse extension handles `module.*` RPC requests. Version 0.1.10 passed a small-sample reuse workflow after saving. Version 0.1.13 passed standalone placement, internal-net mapping, reference alignment, retaining two consecutive instances without a manual save, and schematic/PCB save-reopen checks; the two-instance evidence is limited to a three-component template. An MCU functional block was extracted as a native file; after restoration, 20 components, 82 actual pads, 203 track segments, 40 vias, and resource references passed readback and save-reopen checks. Mapping nets into the main project, reference alignment, and PCB import remain unverified. General automatic extraction, replacement, and the complete R1–R8 sequence are unfinished; preserve existing unknown records and do not resubmit. Version 0.1.14 CBB PCB search and net-name style retention passed MCU testing and schematic save-reopen checks. Full MCU layout-and-routing reuse still awaits validation after channel and custom-footprint association fixes.

If unsure about a command's parameters, query `GET /help?cmd=<name>`.

Schematic auto-wiring was removed starting with 0.10.100. Draw schematics from explicit connection relationships using `drawWire`, `batchWire`, `labelWire`, `linkWire`, or `buildBlock`. PCB autorouting is unaffected.

## Standalone installation and companion files

This skill can be installed on its own. Download the [v0.10.143 companion skill package](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.143/ai-command-engine-skill_en-zh_v0.10.143.zip), extract it, and install the complete `ai-command-engine/` directory in the AI tool's skill directory. Keep `references/` and `scripts/`; do not copy only `SKILL.md`. Alternatively, get it from the `skills/ai-command-engine/` directory in the [v0.10.143 source ZIP](https://github.com/quhuii-lgtm/easyeda-aicommand/archive/refs/tags/v0.10.143.zip).

Install the extension, proxy, and skill separately. The extension package does not install the local proxy or skill for the user. For first-time proxy installation, enabling the extension, and checking the connection target, see the repository [installation guide](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md).

## Reporting plugin issues

For an actual plugin issue, collect and redact only the necessary information as described in [issue reporting](references/issue-reporting.md). The user may choose GitHub CLI as the submitting identity; before submitting, tell them which repository, title, body, and evidence will be made public. If the creation result is unknown, check GitHub first; do not submit again. This workflow is not triggered automatically by EDA commands and does not scan or upload the whole project.
