---
name: ai-command-engine
description: 通过简易 JSON 指令操作嘉立创 EDA 专业版（EasyEDA Pro）。当用户要求用 AI 操作/检查/绘制嘉立创 EDA 的原理图或 PCB，或查询嘉立创 SMT 可贴装物料时使用本 skill。铁律：每条 /command 必须带顶层 instanceId（先 GET /connections 查、勿缓存；省略会被当前代理拒绝；不得依赖全局选中实例）。前置条件：EDA 内已安装并启用 "AI Command Engine" 扩展（勾选「允许外部交互」），且 bridge/command-proxy.mjs 指令代理正在运行（默认手动启动；自动拉起须预先注册本机 URL 协议，注册与启动要求见 references/setup.md；所有实例断开后默认 300 秒退出）。
---

# AI Command Engine — 嘉立创 EDA 操作指令集

0.10.116 起移除工程内布局要求与短标记功能，停止开发。旧工程已有属性和标记不会自动删除。

本技能可独立安装，不依赖作者本机的其他技能或调试网关。首次装机见仓库 README；连接细节见 setup。

HTTP 发 JSON 到 `http://localhost:49720` 操作 EasyEDA Pro；禁止自编 `eda.*` API。

嘉立创下单检查可用 `pcb.runDfm`、`pcb.runSmtDfm` 与 `pcb.checkSameNetPadSpacing`；完整性和几何覆盖边界见[下单检查说明](references/commands-dfm.md)。`pcb.runDfm` 必须明确输入本地选项 `outerCopperOz` 和 `innerCopperOz`；图纸源厚度另行报告，差异或缺失本身不判失败。命令执行成功不等于检查通过，未完整检查不得报告通过。0.10.91 P11 实机结论见参考页；0.10.92 铜厚输入已通过本地及实机命令对照，菜单定位与导出对话框待实机验收。

少数边界行为先查参考页：`project.copyPcb` 缺省归属和结果未确认处理见[工程/板子说明](references/commands-project.md)；PCB 层别名与 `modifyPour` 优先级 读回、停止规则见[PCB 说明](references/commands-pcb.md)。`modifyPour` 0.10.89 已通过本地模拟及隔离工程的0/1优先级、部分失败停止和保存重开验证；任意顺序值仍受宿主限制。

0.10.93 本地候选新增焊盘扇出与自动局部铜皮计划/执行命令；扇出五项尺寸必须明确输入，曲线几何有明确覆盖边界。接口、输入规则、几何覆盖和失败处理见[几何命令说明](references/commands-geometry.md)。安装宿主验收状态以更新记录为准。

0.10.97 矩形板框读取、扇出创建和保存重开已在隔离工程通过。0.10.98 单环反向边框读回已实测通过，实际填充校验仍有 SDK 对象适配错误。0.10.99 候选改用关联父边框核对网络/层，并从填充路径对象读取 getSource()；新增 `pcb.getPourFillReadback` 只读核对已有填充。2026-10-10 已在隔离工程通过现有铜皮的实填充读回及保存关闭重开核对，DRC为0错误/0警告。本次未在0.10.99重新创建铜皮，详见[几何命令说明](references/commands-geometry.md)。

`modifyComponent` 系统属性读回已在 0.10.94 隔离宿主保存重开验证；0.10.95 确认图页资源接口返回空数组。0.10.96 候选将 `placeDevice` 核验改用完整工程导出，并让只读 `getPlacementResourcesDiagnostic` 补充目标资源摘要；2026-10-10 已在 0.10.96 隔离宿主通过既有 TP2 诊断、新 TP3 放置及保存关闭重开检查；此结果仅覆盖已测器件。参数、结果和验证范围见[原理图命令](references/commands-schematic.md)。

## 新手必读（首次操作前读一遍，熟悉后跳过）

- **连接**：`GET /health` 自检（不通按 setup.md §1a 启动；通但无实例按 §1b 检查）→ `GET /connections` 核对工程身份；发指令 `POST /command`，顶层为 `cmd`+`instanceId`+可选 `params`，不能以 `/select` 代替请求路由；拿不准先 `GET /help?cmd=<名>`。→ [setup.md](references/setup.md) §1~5
- **被拒「已被用户暂停」**：该实例被用户在 EDA「AI Command」菜单点了「断开指令代理」——指令未发往任何窗口（工程安全）。**不要自行想办法重连**（旧模块重放/外部恢复会被代理口令校验拒绝）；请用户点菜单「连接指令代理」恢复（0.10.69 起，恢复需口令，只有菜单点击能解除）。`/connections` 里该实例 `paused:true`；全部实例暂停且断开后，代理空闲 300 秒自动退出。
- **坐标**：原理图 10mil/格（A4≈1170×825，取 10 倍数）；PCB 是 mil（1mm≈39.37）。差 10 倍，混用放飞。→ [setup.md](references/setup.md) §6
- **激活**：`schematic.*`/`pcb.*` 前先 `editor.openDocument {"uuid":...}`（uuid 来自 project.getInfo）。→ [setup.md](references/setup.md) §7
- **守则**：先查再画、**每条指令带顶层 instanceId**（先 GET /connections 查、勿缓存）；批量优先；画完必读回（有假成功）；常 save、大改前备份；0 致命才 importChanges；超时≠取消（有 taskId 则查进度并只读核实，不能盲目重发或自动解除写保护）；**视觉验收用 schematic.exportPng**（后台窗口 editor.screenshot 截的是缓存帧，连截字节相同=没重绘，pitfalls K9~K10）。

## 按任务选指令（速查，先看这里）

不知道用哪条时，按"我要做什么"查 [tasks.md](references/tasks.md)，不给对象分类、直接给可执行序列。高频 Top 8：

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

## 指令分级（0.10.61）

**✅ 推荐**
批量类 `buildBlock`/`autoLayout`/`batchWire`/`macro`（一次提交多条，带进度心跳）；语义接网 `labelWire`/`linkWire`；只读体检 `structuralAudit`/`list*`/`get*`/`runDrc*`（只读不改图，探路/验收随便跑）；PCB `checkPlacement`/`routeTrack`/`pourCopper`/`runDrc`；修复类一律先 `dryRun`。

**🟡 不推荐（不禁止）**
单条 mutation 逐条发（`placeDevice`/`drawWire`/`labelWire`/`delete` 单个）——能用但慢，多条应收成 `batchWire`/`macro`。串行发没问题；并发发多个不再报错（0.10.50 起代理自动排队逐个执行），但吞吐退化为 ~3s/条。批量失败项 `error` 带 name/stack 截断堆栈（0.10.51），可辅助定位。

**🔴 有风险（用错后果）**
`autoLayout` 真跑→部分移动失败时先检查 `error.cause.moved` 并核对现场；该命令不自动回滚，须依据备份受控恢复。没有通用 undo API，不承诺 UI undo 可用。修复类不带 dryRun→误删标签只能删线重画；`delete`→删错无撤销，先备份；`importFile`→覆盖导入无法回退；`groupBySchematicRegions`→无备份不可回滚；`importChanges`→DRC 非 0 会把错误同步进 PCB；改 Designator→位号错位、官方还会再规范化。

## 指令文档（10 份，按对象）

| 对象 | 文件 |
| --- | --- |
| 原理图（含宏） | [commands-schematic.md](references/commands-schematic.md) |
| PCB（含低频附录+自动布线闭环） | [commands-pcb.md](references/commands-pcb.md) |
| PCB 扇出、局部铜皮、焊盘外扩与网络丝印 | [commands-geometry.md](references/commands-geometry.md) |
| 嘉立创下单检查（DFM/SMT/同网间距） | [commands-dfm.md](references/commands-dfm.md) |
| 网络类/差分对/生产导出 | [commands-net.md](references/commands-net.md) |
| 工程/板子/图页 | [commands-project.md](references/commands-project.md) |
| 复用模块 | [commands-cbb.md](references/commands-cbb.md) |
| 自建库+工程内选料 | [commands-lib.md](references/commands-lib.md) |
| 知识库/SMT 物料 | [commands-knowledge.md](references/commands-knowledge.md) |
| **低频指令附录（32 条，参数用 /help 在线查）** | [commands-misc.md](references/commands-misc.md) |

## 其他文件

- [tasks.md](references/tasks.md) — **按需求选指令速查**（我要做什么 → 指令序列，先看这里）
- [setup.md](references/setup.md) — 连接/坐标/激活全文（新手区引用的详情）+ 超时心跳 + 编辑器操作/截图
- [workflow.md](references/workflow.md) — 标准流程 + 工作守则全文
- [pitfalls.md](references/pitfalls.md) — ⚠️ 踩坑实录，出问题时先查它
- [issue-reporting.md](references/issue-reporting.md) — 插件问题记录、预览和可选提交流程

单条指令参数拿不准 → `GET /help?cmd=<名>` 在线查。

0.10.100 起移除原理图自动连线命令。原理图使用 drawWire、batchWire、labelWire、linkWire 或 buildBlock 按明确连接关系绘制。PCB 自动布线不受影响。

## 独立安装与配套文件

本技能可单独安装。获取 [v0.10.116 配套技能包](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.116/ai-command-engine-skill_v0.10.116.zip)，解压后将完整的 `ai-command-engine/` 目录安装到 AI 工具的技能目录，保留 `references/` 和 `scripts/`，不要只复制 `SKILL.md`。也可从 [v0.10.116 源代码 ZIP](https://github.com/quhuii-lgtm/easyeda-aicommand/archive/refs/tags/v0.10.116.zip) 的 `skills/ai-command-engine/` 目录获取。

扩展、代理和技能分别安装；扩展包不会替使用者安装本地代理或技能。首次安装代理、启用扩展和核对连接目标见仓库[安装指南](../../docs/QUICKSTART.md)。

## 插件问题上报

遇到实际插件问题时，按[问题上报说明](references/issue-reporting.md)收集并脱敏必要信息。使用者可选择 GitHub CLI 作为提交身份；告知使用者将公开提交的仓库、标题、正文和证据后再执行提交。创建结果未知时先检查 GitHub，不要重复提交。此流程不会由 EDA 指令自动触发，也不会扫描或上传整个工程。
