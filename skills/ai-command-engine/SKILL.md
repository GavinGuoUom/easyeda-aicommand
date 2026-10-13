---
name: ai-command-engine
description: Operate, inspect, and verify EasyEDA Pro schematics, PCBs, and projects, or query JLC SMT-assemblable parts through the AI Command Engine. Use when a user asks an AI to draw, modify, or check these documents, or search for SMT-assemblable parts.
---

# AI Command Engine — EasyEDA Pro command set

[Chinese fallback version](SKILL_ZH.md)

Starting with 0.10.116, project layout requirements and short-marker features were removed and are no longer developed. Existing properties and markers in old projects are not removed automatically.

This skill can be installed on its own. It does not depend on other skills or a debugging gateway on the author's machine. For first-time setup, see the repository README; for connection details, see [setup](references/setup.md).

Send JSON over HTTP to `http://localhost:49720` to operate EasyEDA Pro. Do not invent `eda.*` APIs.

JLC ordering checks are available through `pcb.runDfm`, `pcb.runSmtDfm`, and `pcb.checkSameNetPadSpacing`. See [ordering-check coverage](references/commands-dfm.md) for coverage limits. `pcb.runDfm` requires explicit local options `outerCopperOz` and `innerCopperOz`. Report the drawing's source copper thickness separately; a difference or missing value alone is not a failure. A successful command does not mean the checks passed; do not report a pass unless all required checks completed. See the reference page for the 0.10.91 P11 live result. The 0.10.92 copper-thickness inputs were compared locally and against live commands; menu navigation and the export dialog still await live acceptance.

For less common behavior, consult the reference first: see [project/board guidance](references/commands-project.md) for the default ownership and uncertain-result handling of `project.copyPcb`; see [PCB guidance](references/commands-pcb.md) for PCB layer aliases, `modifyPour` readback priority, and stop rules. `modifyPour` 0.10.89 passed local simulation and isolated-project checks for priority values 0/1, stopping on partial failure, and save/reopen. Arbitrary order values remain constrained by the host.

The 0.10.93 local candidate added commands to fan out pads and plan/execute local copper pours. The five fanout dimensions must be entered explicitly, and curve geometry has explicit coverage limits. See [geometry commands](references/commands-geometry.md) for interface, input rules, geometry coverage, and failure handling. Host acceptance status is recorded in the change log.

Rectangular board-outline readback, fanout creation, and save/reopen passed in an isolated project in 0.10.97. A reversed single-loop outline passed readback in 0.10.98, but actual fill validation still hit an SDK object-adaptation error. The 0.10.99 candidate checks the net and layer through the associated parent outline and reads `getSource()` from fill-path objects; it added read-only `pcb.getPourFillReadback` to check existing fills. On 2026-10-10, an existing pour passed actual-fill readback and save/close/reopen checks in an isolated project, with DRC reporting 0 errors and 0 warnings. This did not recreate a pour in 0.10.99; see [geometry commands](references/commands-geometry.md).

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

## Command references (10 files, by object)

| Object | File |
| --- | --- |
| Schematic (including macros) | [commands-schematic.md](references/commands-schematic.md) |
| PCB (including low-frequency appendix and autorouting workflow) | [commands-pcb.md](references/commands-pcb.md) |
| PCB fanout, local copper, pad expansion, and net labels | [commands-geometry.md](references/commands-geometry.md) |
| JLC ordering checks (DFM/SMT/same-net spacing) | [commands-dfm.md](references/commands-dfm.md) |
| Nets, differential pairs, and manufacturing exports | [commands-net.md](references/commands-net.md) |
| Projects, boards, and schematic pages | [commands-project.md](references/commands-project.md) |
| Reusable blocks | [commands-cbb.md](references/commands-cbb.md) |
| Custom libraries and in-project part selection | [commands-lib.md](references/commands-lib.md) |
| Knowledge base and SMT parts | [commands-knowledge.md](references/commands-knowledge.md) |
| **Low-frequency command appendix (32 commands; use `/help` for parameters)** | [commands-misc.md](references/commands-misc.md) |

## Other references

- [tasks.md](references/tasks.md) — Quick command lookup by goal: “What do I want to do?” → command sequence. Start here.
- [setup.md](references/setup.md) — Full connection, coordinate, and activation guidance cited in the beginner section, plus timeout heartbeats and editor operations/screenshots.
- [workflow.md](references/workflow.md) — Standard workflow and full operating rules.
- [pitfalls.md](references/pitfalls.md) — ⚠️ Field notes; consult first when something goes wrong.
- [issue-reporting.md](references/issue-reporting.md) — Record plugin issues, prepare a preview, and optionally submit a report.

If unsure about a command's parameters, query `GET /help?cmd=<name>`.

Schematic auto-wiring was removed starting with 0.10.100. Draw schematics from explicit connection relationships using `drawWire`, `batchWire`, `labelWire`, `linkWire`, or `buildBlock`. PCB autorouting is unaffected.

## Standalone installation and companion files

This skill can be installed on its own. Download the [v0.10.116 companion skill package](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.116/ai-command-engine-skill_en-zh_v0.10.116.zip), extract it, and install the complete `ai-command-engine/` directory in the AI tool's skill directory. Keep `references/` and `scripts/`; do not copy only `SKILL.md`. Alternatively, get it from the `skills/ai-command-engine/` directory in the [v0.10.116 source ZIP](https://github.com/quhuii-lgtm/easyeda-aicommand/archive/refs/tags/v0.10.116.zip).

Install the extension, proxy, and skill separately. The extension package does not install the local proxy or skill for the user. For first-time proxy installation, enabling the extension, and checking the connection target, see the repository [installation guide](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md).

## Reporting plugin issues

For an actual plugin issue, collect and redact only the necessary information as described in [issue reporting](references/issue-reporting.md). The user may choose GitHub CLI as the submitting identity; before submitting, tell them which repository, title, body, and evidence will be made public. If the creation result is unknown, check GitHub first; do not submit again. This workflow is not triggered automatically by EDA commands and does not scan or upload the whole project.
