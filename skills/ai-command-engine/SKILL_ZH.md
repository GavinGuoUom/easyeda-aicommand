---
name: ai-command-engine
description: 通过简易 JSON 指令操作嘉立创 EDA 专业版（EasyEDA Pro）。当用户要求用 AI 操作/检查/绘制嘉立创 EDA 的原理图或 PCB，或查询嘉立创 SMT 可贴装物料时使用本 skill。铁律：每条 /command 必须带顶层 instanceId（先 GET /connections 查、勿缓存；省略会被当前代理拒绝；不得依赖全局选中实例）。前置条件：EDA 内已安装并启用 "AI Command Engine" 扩展（勾选「允许外部交互」），且 bridge/command-proxy.mjs 指令代理正在运行（默认手动启动；自动拉起须预先注册本机 URL 协议，注册与启动要求见 references/zh/setup.md；所有实例断开后默认 300 秒退出）。
---

# AI Command Engine — 嘉立创 EDA 操作指令集

[English](SKILL.md) | 中文备用

## 开发首要要求（必须遵守）

开发、修改和审查插件指令时，必须先遵守本节，再执行后文流程。

- 先实现功能并跑通正常使用流程，再审查安全性和限制是否必要。
- 不得让额外限制或开发检查阻挡功能实现。
- 指令必须完成它承诺的操作，并由插件自己检查结果。
- 不得把开发记录、测试步骤和验收过程变成普通使用的前置条件。
- 不得因开发方便、历史问题或宿主行为差异增加无用限制。
- 遇到宿主行为差异，必须完善插件适配，不能靠增加限制代替修复。
- 可由插件完成的检查，必须在插件内完成，不得转嫁给使用者。
- 只保留防止改错工程、错误连接、重复写入和明确运行错误的必要检查。
- 新增限制必须说明它防止的具体错误，并优先通过插件内部处理解决。
- 结果能确认时，必须明确返回成功或失败，不得一律返回待验证。
- 结果确实无法确认时，必须说明原因并停止依赖该结果的操作，不得自动重试未知写入。
- 交付前必须检查正常使用流程能够完成，不能只以代码编译通过作为完成依据。

本技能可独立安装，不依赖作者本机的其他技能或调试网关。首次装机见仓库 README；连接细节见 setup。

HTTP 发 JSON 到 `http://localhost:49720` 操作 EasyEDA Pro；禁止自编 `eda.*` API。

嘉立创下单检查可用 `pcb.runDfm`、`pcb.runSmtDfm` 与 `pcb.checkSameNetPadSpacing`；完整性和几何覆盖边界见[下单检查说明](references/zh/commands-dfm.md)。`pcb.runDfm` 必须明确输入本地选项 `outerCopperOz` 和 `innerCopperOz`；图纸源厚度另行报告，差异或缺失本身不判失败。命令执行成功不等于检查通过，未完整检查不得报告通过。0.10.91 P11 实机结论见参考页；0.10.92 铜厚输入已通过本地及实机命令对照，菜单定位与导出对话框待实机验收。

少数边界行为先查参考页：`project.copyPcb` 缺省归属和结果未确认处理见[工程/板子说明](references/zh/commands-project.md)；PCB 层别名与 `modifyPour` 优先级 读回、停止规则见[PCB 说明](references/zh/commands-pcb.md)。`modifyPour` 0.10.89 已通过本地模拟及隔离工程的0/1优先级、部分失败停止和保存重开验证；任意顺序值仍受宿主限制。

## 新手必读（首次操作前读一遍，熟悉后跳过）

- **连接**：`GET /health` 自检（不通按 setup.md §1a 启动；通但无实例按 §1b 检查）→ `GET /connections` 核对工程身份；发指令 `POST /command`，顶层为 `cmd`+`instanceId`+可选 `params`，不能以 `/select` 代替请求路由；拿不准先 `GET /help?cmd=<名>`。→ [setup.md](references/zh/setup.md) §1~5
- **被拒「已被用户暂停」**：该实例被用户在 EDA「AI Command」菜单点了「断开指令代理」——指令未发往任何窗口（工程安全）。**不要自行想办法重连**（旧模块重放/外部恢复会被代理口令校验拒绝）；请用户点菜单「连接指令代理」恢复（0.10.69 起，恢复需口令，只有菜单点击能解除）。`/connections` 里该实例 `paused:true`；全部实例暂停且断开后，代理空闲 300 秒自动退出。
- **坐标**：原理图 10mil/格（A4≈1170×825，按当前图页栅格对齐）；PCB 是 mil（1mm≈39.37）。差 10 倍，混用放飞。→ [setup.md](references/zh/setup.md) §6
- **激活**：`schematic.*`/`pcb.*` 前先 `editor.openDocument {"uuid":...}`（uuid 来自 project.getInfo）。→ [setup.md](references/zh/setup.md) §7
- **守则**：先查再画、**每条指令带顶层 instanceId**（先 GET /connections 查、勿缓存）；批量优先；画完必读回（有假成功）；常 save、大改前备份；超时≠取消（有 taskId 则查进度并只读核实，不能盲目重发或自动解除写保护）；**视觉验收用 schematic.exportPng**（后台窗口 editor.screenshot 截的是缓存帧，连截字节相同=没重绘，pitfalls K9~K10）。

## 按任务选指令（速查，先看这里）

不知道用哪条时，按"我要做什么"查 [tasks.md](references/zh/tasks.md)，不给对象分类、直接给可执行序列。高频 Top 8：

| 我要… | 用这条 |
| --- | --- |
| 整页结构验收（桥接/错网/重复位号/排版一次查） | `schematic.structuralAudit` |
| 从零画功能区 | `schematic.buildBlock` |
| 批量接线 | `schematic.batchWire`（单脚 `labelWire`/双脚 `linkWire`） |
| 整理乱图 | `schematic.autoLayout`（先 dryRun） |
| 连通性对账 | `schematic.exportNetlist` |
| 切工程 | 先 `schematic.save` → `project.open` |
| 转 PCB | `pcb.importChanges`（0 致命才导，弹窗用户点） |
| 出生产资料 | `pcb.exportGerber`/`exportPickPlace` + `schematic.exportBom` |

## MCU 与密脚器件扇出

用于把已放置器件的焊盘引到器件外侧，并生成同网络短线和通孔，方便后续换层与整板布线。
当用户要求“MCU 扇出”“密脚引出”或“焊盘引线加过孔”时使用。
流程为：选目标 PCB 和器件/焊盘 → `pcb.getFanoutPlan` 规划 → 将返回的完整 `data` 作为 `pcb.fanout` 的 `params.plan` 执行 → `pcb.runDrc` 检查 → `pcb.save` 保存。
执行后的逐项读回由插件完成；整板网络连接继续使用布线命令。
目标选择、尺寸参数和请求示例见[扇出作用与用法](references/zh/commands-geometry.md#焊盘扇出)。

## 局部铜皮、焊盘外扩与网络文字丝印

| 需求 | 作用与调用流程 |
| --- | --- |
| 增加局部铜面积、连接或散热 | `pcb.getAutoCopperPlan` → `pcb.autoCopper`；`pour` 按板规则重建覆铜，`fill` 生成固定铜填充 |
| 焊盘周围禁止铺铜、禁止填充或阻焊外扩 | `pcb.getPadExpansionPlan` → `pcb.expandPads`；不改变原焊盘铜尺寸 |
| 给焊盘、测试点或接口标注网名 | `pcb.getNetSilkscreenPlan` → `pcb.generateNetSilkscreen`；生成可编辑文字 |

通常在器件位置确定后使用；铜皮用于局部布线，外扩用于工艺处理，文字用于丝印整理。
执行时把规划响应的完整 `data` 原样放入 `params.plan`，插件完成新图元读回。
完成后检查结果并保存；具体目标、参数与示例直接读取[几何命令说明](references/zh/commands-geometry.md)。

## 指令分级（0.10.61）

原位换封装与批量属性更新使用 `schematic.getComponentUpdatePlan` → `schematic.updateComponents`，适合改封装尺寸、整理器件资料及模块实例属性。批量属性与原位封装的分步路径已有实机证据；138原位封装与批量属性实际写入已保存重开，PCB经原生确认后的同步也已核验；142已通过默认配置核对，封装与属性写入已保存重开；143已取得批量属性及真实0402→0805更新的成功回执，保存重开通过；旧名兜底修正分支本轮未触发。作用、目标和调用示例直接见[原理图命令页](references/zh/commands-schematic.md#原位换封装与批量更新属性)。

**✅ 推荐**
批量类 `buildBlock`/`autoLayout`/`batchWire`/`macro`（一次提交多条，带进度心跳）；语义接网 `labelWire`/`linkWire`；只读体检 `structuralAudit`/`list*`/`get*`/`runDrc*`（只读不改图，探路/验收随便跑）；PCB `checkPlacement`/`routeTrack`/`pourCopper`/`runDrc`；修复类一律先 `dryRun`。

**🟡 不推荐（不禁止）**
单条 mutation 逐条发（`placeDevice`/`drawWire`/`labelWire`/`delete` 单个）——能用但慢，多条应收成 `batchWire`/`macro`。串行发没问题；并发发多个不再报错（0.10.50 起代理自动排队逐个执行），但吞吐退化为 ~3s/条。批量失败项 `error` 带 name/stack 截断堆栈（0.10.51），可辅助定位。

**🔴 有风险（用错后果）**
`autoLayout` 真跑→部分移动失败时先检查 `error.cause.moved` 并核对现场；该命令不自动回滚，须依据备份受控恢复。没有通用 undo API，不承诺 UI undo 可用。修复类不带 dryRun→误删标签只能删线重画；`delete`→删错无撤销，先备份；`importFile`→覆盖导入无法回退；`groupBySchematicRegions`→无备份不可回滚；`importChanges`→DRC 非 0 会把错误同步进 PCB；改 Designator→位号错位、官方还会再规范化。

## 指令文档（10 份，按对象）

| 对象 | 文件 |
| --- | --- |
| 原理图（含宏） | [commands-schematic.md](references/zh/commands-schematic.md) |
| PCB（含低频附录+自动布线闭环） | [commands-pcb.md](references/zh/commands-pcb.md) |
| PCB 扇出、局部铜皮、焊盘外扩与网络丝印 | [commands-geometry.md](references/zh/commands-geometry.md) |
| 嘉立创下单检查（DFM/SMT/同网间距） | [commands-dfm.md](references/zh/commands-dfm.md) |
| 网络类/差分对/生产导出 | [commands-net.md](references/zh/commands-net.md) |
| 工程/板子/图页 | [commands-project.md](references/zh/commands-project.md) |
| 复用模块 | [commands-cbb.md](references/zh/commands-cbb.md) |
| 独立模块复用插件 RPC | [commands-module.md](references/zh/commands-module.md) |
| 自建库+工程内选料 | [commands-lib.md](references/zh/commands-lib.md) |
| 知识库/SMT 物料 | [commands-knowledge.md](references/zh/commands-knowledge.md) |
| **低频指令附录（32 条，参数用 /help 在线查）** | [commands-misc.md](references/zh/commands-misc.md) |

## 其他文件

独立模块复用通过`module.*`转发到已安装的模块复用扩展。0.1.10保存后的复用路径已通过小样本；0.1.13已实测通过独立放置、内部网映射、引用对齐、未手动保存连续两实例保留，以及SCH/PCB保存重开。两实例证据限3器件模板。MCU功能区已提取为原生文件，恢复后20器件、82真实焊盘、203段走线、40个过孔及资源引用通过核对和保存重开。MCU在主工程的网络映射、引用对齐及PCB导入仍待验证。通用自动提取、替换与完整R1–R8尚未完成；旧unknown记录保留，不重发。0.1.14的CBB PCB检索与改网名样式保留已通过MCU实测及SCH保存重开。MCU完整布局布线复用仍待通道与自定义封装关联修复验证。

- [tasks.md](references/zh/tasks.md) — **按需求选指令速查**（我要做什么 → 指令序列，先看这里）
- [setup.md](references/zh/setup.md) — 连接/坐标/激活全文（新手区引用的详情）+ 超时心跳 + 编辑器操作/截图
- [workflow.md](references/zh/workflow.md) — 标准流程 + 工作守则全文
- [pitfalls.md](references/zh/pitfalls.md) — ⚠️ 踩坑实录，出问题时先查它

单条指令参数拿不准 → `GET /help?cmd=<名>` 在线查。
