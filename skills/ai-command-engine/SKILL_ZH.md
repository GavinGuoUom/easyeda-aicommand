---
name: ai-command-engine
description: 通过本地 HTTP 指令查询、绘制、修改和检查嘉立创 EDA 专业版的原理图、PCB、工程与物料库。插件开发和调试另用 extension-dev-skill。
---

# AI Command Engine

[English](SKILL.md) | 中文备用

用于操作嘉立创 EDA 专业版。连接方式、实例选择和参数查询见[连接与环境](references/zh/setup.md)。

v0.20.50 中文发布包的菜单入口为“AI 指令引擎”，包含“指令列表…”和桥接操作；命令名与 JSON 参数不变。当前4.1.78暂停的14项功能按版本说明保持拒绝。

## 使用边界

- 先读现状，核对用户目标和允许修改范围。
- 破坏性操作前备份；一个窗口只由一个写入者操作。
- 写入结果未知时停止依赖该写入，先读回现场，不盲目重发。
- 阶段结束核对保存状态和未覆盖内容；命令成功、截图或 DRC 为零不能单独证明设计合格。
- EDA 4.1.78 不支持的指令见[PCB低频指令](references/zh/commands-pcb-low.md#eda-版本限制)和[原理图低频指令](references/zh/commands-schematic-low.md#eda-版本限制)。这些指令需要 EDA 4.2 或更高版本；4.2 尚未实机验收。

## 按任务选文件

只读当前任务需要的文件。查询现状或指令帮助时不读绘制流程；写入原理图或 PCB 前，读取对应绘制要求、指令表和操作流程。操作要求规定绘图质量，指令表帮助选命令，操作流程规定执行顺序、读回和保存。低频表和专题页按任务选读，参数以目标窗口版本的 `/help?cmd=<命令名>` 为准。

| 任务或调用时机 | 文件 |
| --- | --- |
| 首次连接、选窗口、坐标单位或激活文档 | [连接与环境](references/zh/setup.md) |
| 按类别和推荐使用频率查指令 | [指令分类](references/zh/commands-frequency.md) |
| 绘制或修改原理图：绘图质量 | [原理图操作要求](references/zh/原理图操作要求.md) |
| 原理图常用与专项指令 | [高频](references/zh/commands-schematic-high.md)、[低频](references/zh/commands-schematic-low.md) |
| 写入原理图前：执行顺序、读回、保存与完整换件 | [原理图操作流程](references/zh/commands-schematic.md) |
| 绘制或修改 PCB：布局、布线、铺铜与制造要求 | [PCB操作要求](references/zh/PCB操作要求.md) |
| PCB 常用与专项指令 | [高频](references/zh/commands-pcb-high.md)、[低频](references/zh/commands-pcb-low.md) |
| 写入 PCB 前：执行顺序、读回、保存与自动布线 | [PCB操作流程](references/zh/commands-pcb.md) |
| 扇出、几何、DFM、网络或生产导出 | [PCB专题](references/zh/commands-pcb-special.md) |
| 新建、打开或管理工程、板子、图页 | [工程与图页指令](references/zh/commands-project.md) |
| 查询、创建或维护符号、封装、器件 | [器件库指令](references/zh/commands-lib.md) |
| 查询设计规则、线宽估算或 SMT 物料 | [知识与物料指令](references/zh/commands-knowledge.md) |
| 属性、标签、网表、保存或恢复异常 | [问题排查](references/zh/pitfalls.md) |
| 开发、修改或审查插件指令 | [插件开发要求](references/zh/插件开发要求.md)；扩展 API 和实时调试另用 extension-dev-skill |
