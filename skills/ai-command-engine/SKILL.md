---
name: ai-command-engine
description: Use the AI Command Engine to query, draw, modify, and inspect EasyEDA Pro schematics, PCBs, projects, and libraries over local HTTP. For extension development and debugging, use extension-dev-skill.
---

# AI Command Engine

Use this skill to operate EasyEDA Pro. For connection setup, instance selection, and parameter lookup, see [Connection and setup](references/setup.md). [简体中文](SKILL_ZH.md)

## Operating boundaries

- Inspect the current state first and confirm the user's goal and allowed scope.
- Back up before destructive operations. Only one writer may operate on a window at a time.
- If a write result is unknown, stop relying on it and read back the current state before proceeding. Do not blindly resend.
- At each stage, check save state and untouched content. Command success, a screenshot, or zero DRC errors alone does not prove the design is acceptable.

## Choose files by task

Read only the files needed for the current task. For state or command-help queries, do not read drawing workflows. Before writing to a schematic or PCB, read the relevant drawing requirements, command table, and operating workflow. Drawing requirements define quality; command tables help select commands; workflows define execution order, readback, and saving. Read low-frequency and topic-specific pages only when needed. Use `/help?cmd=<command-name>` for parameters from the target window version.

| Task or timing | File |
| --- | --- |
| First connection, window selection, coordinate units, or activating a document | [Connection and setup](references/setup.md) |
| Find commands by category and recommended frequency | [Command frequency](references/commands-frequency.md) |
| Draw or modify a schematic: drawing quality | [Schematic operating requirements](references/原理图操作要求.md) |
| Common and specialized schematic commands | [High-frequency](references/commands-schematic-high.md), [low-frequency](references/commands-schematic-low.md) |
| Before schematic writes: order, readback, saving, and full component replacement | [Schematic workflow](references/commands-schematic.md) |
| Draw or modify a PCB: placement, routing, copper, and manufacturing requirements | [PCB operating requirements](references/PCB操作要求.md) |
| Common and specialized PCB commands | [High-frequency](references/commands-pcb-high.md), [low-frequency](references/commands-pcb-low.md) |
| Before PCB writes: order, readback, saving, and autorouting | [PCB workflow](references/commands-pcb.md) |
| Fanout, geometry, DFM, nets, or manufacturing export | [PCB topics](references/commands-pcb-special.md) |
| Create, open, or manage projects, boards, or schematic pages | [Project and page commands](references/commands-project.md) |
| Query, create, or maintain symbols, footprints, or devices | [Library commands](references/commands-lib.md) |
| Query design rules, estimate trace width, or search SMT parts | [Knowledge and parts commands](references/commands-knowledge.md) |
| Attribute, label, netlist, save, or recovery problems | [Troubleshooting](references/pitfalls.md) |
| Develop, modify, or review plugin commands | [Plugin development requirements](references/插件开发要求.md); use extension-dev-skill for extension APIs and live debugging |
