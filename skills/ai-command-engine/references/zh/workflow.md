# 标准工作流程

## 功能区布局与引脚接线准备

- 多功能区图纸先规划各区的位置、阅读顺序和标题空间。
- 区框按实际符号、引脚出线、标签及属性文字的范围留余量。
- 大型模块和高引脚数器件按实际占用单独留位。
- 元件间距按符号尺寸调整，不直接套用其他工程的固定坐标。
- 批量放置前整理料号、预期位号和引脚网络表。
- 已取得的器件资料按料号复用；当前命令支持批量查询时优先批量查询。
- 引脚网络表以器件身份和引脚编号定位，多单元器件同时区分单元。
- 核对 `buildBlock` 返回的 `refMap` 后，再对照实际位号和引脚接线。
- 电源、地、信号和合法 NC 分别列明；未分配引脚先核实用途。
- 相近同网引脚优先直连；需用标签时，从实际引脚接线端向符号外侧引出短线。
- 标签间距按当前单位、文字和邻近引脚调整，不统一套用上游的 10 单位偏移。
- 生成后检查器件、标签和文字是否留在所属区框内，必要时调整布局或扩大区框。

这些要求用于规划和读回检查，不代表 `buildBlock` 已实现按符号尺寸自动避让。
已有图纸只在授权范围内调整，不因套用功能框而重排全图。

借鉴来源：[官方原理图放置与网络引出技能](https://github.com/easyeda/easyeda-enhanced-schematic-skill/blob/main/SKILL.md)（2026-10-10 核查）。
这里只吸收布局与批量准备方法；执行仍使用本插件命令及现有保存验收流程。

## 画原理图（批量优先）

1. `GET /connections` 核对窗口；每条请求带顶层 `instanceId` → `editor.openDocument` 激活 → 页级请求带 `params.__docUuid` → `schematic.getPageInfo` 读图框。
2. **放器件优先 `buildBlock`**：一个功能区一条命令；零散补充才 `placeDevice`。同功能器件聚拢。
3. **连线优先 `batchWire`**：一批接线一次提交；单条修补用 `labelWire`（单脚）/`linkWire`（双脚）；`connectPin`/`drawWire`/`placeNetLabel` 仅特殊场景（母排、多点直连、批量改色）。
4. **读回自查**：`listWires`+`exportNetlist` 审计每个网络的引脚成员（别信"画了就通"）。
5. `runDrc`（自动取稳定值）→ 致命清零；历史图"多个网络名"警告跑 `dedupeWireNets`。
6. `save`。

## 整理已有原理图

- 器件乱/连线乱：`autoLayout`（按需用dryRun预览；已明确要求重排时传dryRun:false执行，跑完检查 moved、失败 error.cause（partial、moved、phase、stateDifferences）、rewired、drc。部分移动失败时停止后续写入并检查现场，依据 moved 和备份受控恢复；不承诺 UI undo 可用）。
- 标签问题：`fixNetLabels` 全科体检（dryRun 默认 true）；浮标残留 `pruneFloatingLabels`（dryRun 默认 `false`；预览须显式传 `true`；分批看 batches/unprocessed）。
- 网络碎（人工拖标签等）：`repairNet` 收尾。

## 元器件摆放与表达（以项目及器件要求为准）

完整器件替换必须按[完整器件更换流程](commands-schematic.md#完整器件更换)组合已有指令。通过`project.getDocumentSource`只读解析当前激活图页的`COMPONENT`和`ATTR`记录，读取镜像、项目身份及新实例完整属性；不直接写源码。先确认新器件资源、引脚号与原网络，再放置和读回新实例；所有连接与项目字段通过核对后，才删除旧实例。保存、关闭并重开后再核对。源码格式未知、记录无法唯一匹配或写入结果未知时，停止后续写入并报告缺口。

1. 去耦电容在原理图上应能辨认对应电源引脚/电源域；实际连接、容量、数量及 PCB 距离按具体器件资料与项目工况确定。不能从示意摆放推导同名电源脚不可并网。
2. 输入/输出电容与相关引脚的关系表达清楚，PCB 就近布局要求仍须在 PCB 上核验。
3. 同功能块优先真实连线，跨块按需标签；合法未连接引脚明确标注 NC，不为消除视觉孤立而添加需求外连接。
4. 避免导线穿符号本体、标签压引脚、文字重叠；移动后复核网络和预期端点。
5. 本技能自包含，不要求用户另装作者的原理图优化技能。

## 原理图转 PCB

当前用户的流程：用户在 EDA 界面亲自发起“原理图更新到 PCB”并确认变更。AI 不调用插件或官方 API 的导入命令。用户操作前后只做只读核对；用户保存、关闭并重开 PCB 后，再核对器件记录、封装关联、焊盘编号与位置、网络及非目标内容。

1. 按任务需要运行原理图 DRC 并报告结果；普通导入不要求先清零 DRC。
2. 用户操作后，按需用 `listComponents`、`getComponentPads` 和文档源码读回，对照原理图核对器件记录、封装、焊盘编号与位置及网络。发现差异或结果不明时停止并报告；此导入步骤不做修复写入。
4. 布局：零散 `moveComponent`；功能区成组用 `groupBySchematicRegions`（先 dryRun）。⚠️ DRC 不查本体/丝印挤压——摆完跑 `checkPlacement`，大本体器件（连接器、电感）加 `margin`（10~30mil）。
5. 布线：`routeTrack`（大电流先 `knowledge.widthForCurrent`）、`placeVia`、`pourCopper`（GND 整面）；量大走自动布线闭环（先锁电源网，见 commands-pcb.md 附录 ⑦）。
6. `runDrc` → 报告违规 → `save`。

## 收尾纪律

每阶段 save；破坏性操作前确认目标 ID、留备份（代理自动备份 .epro 或手动 `project.exportFile`）；所有修改以读回为准（带 `readback` 的返回也不信单次值）。

## 工作守则（全文）

1. **先查再画**：改前先 `project.getInfo`/`listComponents` 了解现状。
2. **先核对目标、再激活**：每条请求带顶层 `instanceId`，不以 `/select` 代替；`schematic.*`/`pcb.*` 前先 `editor.openDocument`。
3. **批量用 macro**：>2 步合并一条 macro 发送。
4. **画完必读回**：导线 `listWires`、网络 `exportNetlist`、PCB 网络 `getComponentPads` 逐项审计，不假设成功。
5. **每阶段 save**。
6. **收尾必 DRC** 如实报告；DRC用于报告设计问题，不作为普通导入指令的额外许可条件。
7. **不盲目重试**：读 `error.message`/`suggestion` 修正再发；同一指令连错 3 次停下换方案。
8. **专业知识先查库**：阻抗/等长/载流先 `knowledge.query`，按 constraints/guidance 执行。
9. **扩展开发另行处理**：普通绘图使用本插件指令。任意原生 API 调试不属于本技能安装流程；作者曾用的 49620 网关未包含在此仓库，不能假定用户已安装或据此执行代码。
10. **按指令授权范围操作**：不超出被调用指令的授权范围修复、删除或恢复。`dedupeWireNets` 与 `autoRouteStatus` 在已写入后失败时会尝试整页快照恢复并读回；恢复失败或未确认仍报错，不保证成功。`autoLayout` 本身不自动恢复。官方创建类接口有假失败（返回空但实际已创建），不信返回值，以文档实际内容为准。

封装核验要求网表工程封装UUID、PCB有效Footprint属性和epro资源HEAD.uuid一致。SDK引用必须完整匹配工程封装UUID与当前工程UUID，或匹配资源记录中的源封装UUID与源库UUID。名称和相同几何不能代替关联；错误库、属性冲突和缺失资源仍拒绝。无关且缺少有效HEAD/source的资源不建立映射，不额外阻断本次核验。
