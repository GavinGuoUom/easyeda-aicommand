# PCB操作流程

写入前先读[PCB操作要求](PCB操作要求.md)，按其中要求规划器件布局、走线和覆铜。

先按[连接与环境](setup.md)核对窗口、工程、PCB 文档和单位。常用入口见[PCB高频](commands-pcb-high.md)，专项入口见[PCB低频](commands-pcb-low.md)。参数与返回字段查已核对所选窗口版本的 `/help?cmd=<命令名>`；`/help` 使用代理当前选中的窗口。

## 接收设计与核对现状

原理图到 PCB 的更新由用户在 EDA 界面发起并确认。AI 不调用 `pcb.importChanges` 或官方导入接口；更新前后用 `pcb.listComponents`、`getComponentPads`、`listNets` 核对器件身份、封装关联、逐焊盘网络和非目标对象。插件回执成功不代替保存重开或整板检查。

## 板框、图层和布局

- `pcb.drawOutline` 的公开坐标以左下角为基准，单位 mil。重复板框前先查实际图元类型和 ID，不预设一定为 Region。
- 层数和层叠分别核对。`setCopperLayers.count` 只接受 2 到 32 的偶数。`getStackingConfig` 读完整配置，`applyStackingConfig` 后重新读回。设默认层叠不等于当前 PCB 已应用；自定义层变更后重新激活 PCB。未知层名或层号不猜测。
- `getCurrentLayer`、物理层叠配置系列和实时 DRC 开关系列在 EDA 4.1.78 实机确认不支持。它们需要 EDA 4.2 或更高版本；4.2 尚未实机验收。逐条名称见[PCB低频指令](commands-pcb-low.md#eda-版本限制)。
- `pcb.moveComponent` 后用 `checkPlacement` 检查间距。后者基于焊盘包围盒，不能代替器件本体、丝印和机械尺寸检查；`complete:false` 或跳过对象不能报告布局全部通过。
- `pcb.groupBySchematicRegions` 用于明确要求按原理图功能区整理时。先看 `dryRun`、板框容纳情况和尺寸来源，再执行并读回。它不是普通单件移动的入口。

## 扇出、布线和自动布线

密脚器件位置确定后，先用 `pcb.getFanoutPlan` 检查目标、层、尺寸和 `executable`，再把完整 `data` 作为 `pcb.fanout` 的 `params.plan`。几何范围见[PCB几何命令](commands-pcb-special.md)。

人工布线用 `pcb.routeTrack`，换层用 `pcb.placeVia`。先确认网络存在，按电流、规则和板层确定线宽及孔径。`routeTrack` 当前宿主曾出现创建接口返回 ID、但图元未落入文档的假成功；本地候选在共享总时限内逐段调用 `get(id)` 与 `getAllPrimitiveId`，核对 ID、网络、层、坐标和线宽（显式请求或由 `currentA` 换算），同时绑定当前 PCB 焦点。验证通过后才将 ID 列入 `segmentIds`；单段未确认时在 `cause` 保留 `failedPrimitiveId`，并以 `partial:true`、`retryable:false` 报错、停止后续段，不补写、重试或删除。本地回归和对应专家复审通过，宿主修复仍待验收。

自动网名如 `$1N1` 可直接作为 `net` 参数使用。其他以 `$` 开头的字面文本可写为 `$$名称`；宏变量仍使用 `$步骤ID.字段`。

v0.20.38 暂行插件输入政策：`routeTrack` 的全部待写段，以及 SES 的全部输入段和规划差集段，均在任何写入前一次检查长度。按坐标计算后，任一段 `<1 mil (25.4 μm)` 即明确拒绝，并说明段索引、长度和阈值；已存在的短段也拒绝。不丢段、不拉长、不取整。这是插件输入政策，不是 SDK 下限；候选本地集中回归和最终审查通过，宿主验收待完成。

自动布线可用 `autoRouteStart` 启动、`autoRouteStop` 停止，并按需导出 DSN 或手工追加 SES。v0.20.38 起将 `autoRouteStatus` 固定为只读；`noImport:false` 也不能触发自动回灌。任务为 `COMPLETED` 时返回 `imported:false`、`autoImportEnabled:false` 和明确说明，不返回 `output` 或快照、不写入 PCB、不调用 DRC，也不标记 `consumed`。只释放匹配的默认任务槽；显式 `jobId` 仍可查询，已有写保护不解除。自动回灌停用期间，不按默认流程建议直接回灌。审查及本地回归通过；EDA 4.1.78 配合固定完成结果的本地测试服务，已验证三种 noImport 输入均不请求输出、不写板及默认任务槽释放。该验证不证明路由算法。

外部 SES 已使用多行 `wire`、`path` 和坐标对输出。v0.20.30 宿主中五条短线段仍未出现，长线对照还出现线宽变化，不能认定格式改动修复了导入问题。重建的 wire/via 不保留原始 `type` 字段，因此不承诺保留全部 wire metadata。
A14/A15 的 v0.20.36 本地候选保持现有解析、映射、规划及差集容差，并在写入前选后端：无新增 via，或规划已含可信完整孔径时用 direct-primitives；新增 via 缺少孔径时沿用 native-ses 入口，不把 coverage 当作孔径已验证。开始写入后不切换后端或重试；无需新增必填 `strategy`，回执可记录实际 `backend`。

direct-primitives 逐个 fresh-get、核对 ID 成员及完整几何，最后核对整批源码和几何。direct-primitives 和 native-ses 两种 SES 后端失败均走专用恢复钩子，不回退到 `setDocumentSource`。只有所有写入均明确结束、原有效记录（含 POURED）完整保留，且新增内容仅为已知候选 ID 的 LINE/VIA 时，才精确删除新增项并与完整基线比较。超时、抛错导致结果未知、出现未知新增项或原记录变化时不补偿，返回 partial 并保持互锁。

A15 先添加并验证原图元与新增图元，再删除旧的未锁定 LINE/VIA/ARC；开始删除旧项后失败，不重建旧 ID，也不恢复整页源码，仍返回 partial 并保持互锁。仅最终全量验证通过后标记 consumed；DRC 结果单独报告。0.04 mil 短线能力和删除阶段原子性仍未解决。本地集中回归和同一专家最终审查通过，安装版宿主验收待完成。

v0.20.36 宿主会话 `282825b0` 首次 SES 写入前因运行环境缺少 `structuredClone` 失败；源码及有效记录、POURED、3 条 LINE 和 1 个 VIA 均保持。v0.20.37 本地候选只将三处内部 `expectedGeometry`/journal 快照的克隆改为局部 JSON 深拷贝，不加 polyfill，也不改几何或恢复语义；本地集中回归及最终审查通过，宿主复测待完成。

失败时，`cause.sesDiagnostic` 附带 `{ref,available,persisted,storageKey,issues,record}`。`available=true` 表示内联 `record` 可用；`persisted=true` 表示扩展存储已写入并读回，`record.storageKeys` 记录恢复前后的存储键。`record` 记录命令、文档、UTC 时间、当前阶段、SDK 调用状态与结果、输入全文/UTF-8 字节数/SHA-256、目标与差异几何，以及恢复前后完整 source 和 line/via/arc 快照；无法读取的值及原因写入 `issues`。各诊断阶段最多等待 500 ms，超时后跳过该阶段剩余读取并继续恢复；晚到结果不修改记录。诊断失败不阻断恢复，也不改变原始错误或 `partial`、`restored`、`retryable`、`recovery` 结果。成功时不附诊断记录，仍按实际几何读回来核对。
`autoRouteStart.maxPasses` 须为正整数。插件将自动布线任务绑定到启动时的 PCB；切换到其他 PCB 后，`autoRouteStatus` 拒绝清线和回灌，须先回到原 PCB 核对。`autoRouteStop` 对已结束任务返回 `cancelled=false`，不再发送取消请求；发送取消请求后只在读回 `CANCELLED` 状态时报告 `cancelled=true`。

v0.20.29 候选对 `autoRouteStart.skipDrc` 和 `autoRouteStatus.noImport` 严格检查布尔类型，非布尔值在 EDA 或服务请求前拒绝；两者默认仍为 `false`。新增检查尚待新版宿主验收。

v0.20.29 候选允许取消 `QUEUED` 任务，仍须读到取消终态才报告 `cancelled:true`。对已完成任务调用 `autoRouteStop` 时返回 `cancelled:false`，并释放默认活动任务位置；保留返回的 `jobId`，后续读取或回灌该任务时显式传它。未确认的写入恢复保护不会因此清除。新增行为尚待新版宿主验收。

`pcb.createNetClass` 和 `pcb.createEqualLengthGroup` 的颜色可传 `#RGB`、`#RGBA`、`#RRGGBB` 或 `#RRGGBBAA`，插件会转换为 SDK 的 RGBA 对象。
`pcb.checkPlacement.minClearance` 须为非负有限数值。`pcb.getPrimitiveAtPoint` 与 `pcb.getPrimitivesInRegion` 的坐标须为有限数值。

## 覆铜和丝印

`pcb.pourCopper` 创建的是边框；用 `rebuildPour` 重建，再用 `listPours` 或 `getPourFillReadback` 确认实际填充。`pcb.listPours(withFill:true)` 的 `fillStatus` 为 `filled`、`empty` 或 `unknown`；`filledRegions` 是 fill 为 true 且路径源通过基础结构检查的区域数，`fillRegions` 是总区域数。缺少或无效的读回字段会得到 `unknown`。v0.20.51 在 EDA 4.1.78 的1区已填充、0区未填充样例通过保存重开核对；非法返回和全部 fill:false 分支为本地模拟验证。填充状态为 `empty` 或 `unknown` 时不能报告铺铜完成。`rebuildPour` 的 `completed` 不证明填充新鲜、已保存或制造合格。修改边框、优先级或周边布线后再次检查填充；结果不明时停止，不以旧填充冒充本次结果。

局部铜皮先区分 `pour`（随规则裁剪）与 `fill`（固定填充），按[几何命令](commands-pcb-special.md)规划再执行。`modifyPour` 的任意优先级值不保证都可达到，以写后源码读回为准，不据 API 返回值假定成功。v0.20.41 实机中同网 no-op 通过、4 个改网请求写前拒绝；实际改网底层顺序问题仍未修复。v0.20.42 起暂时禁用改到不同网络或不同 `pourName`：当前值须由 source 与 fresh getter 一致确认；若请求变更网络或名称，整条请求写前拒绝，包括混合请求。同网/同名字段本身不写入，同一请求中其他允许属性仍按原规则执行并读回，未请求属性保持原值。layer、width、priority 不在禁用范围；不要求 `toAsync`，也不建议 AI 自动删除再建覆铜作为无损替代。本地回归及 EDA 4.1.78 的改网/改名写前拒绝、同值不写和允许的优先级修改保存重开已按限定样例通过；底层改网/改名顺序问题未修复。

`pourCopper` 可选 `net` 指定新建覆铜网络；`preserveSilos` 仅接受布尔值，省略时保留 SDK 默认行为。命令仅创建覆铜边框，不自动重建或填充。EDA 界面手动新建或修改仍可操作，但要核对排序、执行重建并读回实际填充。读回不符时按部分结果报告并保留已创建边框 ID；现场核对前不重试或删除。不要把删除旧边框再新建宣传为无损改网或改名。`preserveSilos:true` 的单次实机样例三方输入一致并读到 4 个 fill，但保存重开后的 POURED/连接检查未通过，不能据此报告成功；详见[更新记录](../../CHANGELOG.md)。

v0.20.40 `pourCopper` 路径候选仅接受单 R 的一维路径或恰好一层包装，并严格核对 7 项相等；多环、额外嵌套或参数变更应拒绝。详细诊断为 raw 与 normalized 输入；候选本地定向检查通过，统一回归和新版宿主待验。

`placeString`、`modifyString` 后检查可读性、镜像、方向、焊盘遮挡及板边。网络丝印仍须通过计划命令，并检查实际图面。

## 检查、保存和生产导出

布线与覆铜后运行 `pcb.runDrc`；定位具体问题时用 `runDrcDetailed`。两条命令遇到非数组结果会报“结果不可判定”，不能按 0 项通过处理。DRC 不覆盖器件本体、全部机械或制造要求。`runDfm`、`runSmtDfm` 与同网焊盘间距检查的材料、单位及覆盖范围见[下单检查](commands-pcb-special.md)。检查未完整覆盖时不报告通过。

各阶段保存后核对目标与非目标对象。需要证明持久性时，关闭重开后再次读回。Gerber、贴片坐标和网表导出后还需检查文件对应的 PCB 版本、格式、单位和实际内容；见[网络与导出](commands-pcb-special.md)。

`pcb.exportPickPlace` 的 `fileType` 仅支持 `xlsx` 或 `csv`，默认 `csv`；`unit` 仅支持 `mm` 或 `mil`，默认 `mm`。导出后核对文件内坐标与单位，不能只看返回成功。

删除前查目标图元 ID 并备份。代理文件备份按工程保留最近 5 份，各 PCB 共用上限；代理不可用时回退到扩展存储的固定单键，跨工程和 PCB 共用，后一次会覆盖前一次，只留最近 1 份。`pcb.delete` 会在启动任务前拒绝空 ID 列表或空白 ID；读回未知时停止后续删除。`pcb.sourceRollback` 仅用于确认需要恢复的备份，恢复前核对 PCB UUID，恢复后读回并保存。关闭页签不等于可靠回滚。

破坏性操作失败后，插件在 500 ms 内核对当前焦点、文档 UUID、文档类型和完整源码。只有确认原内容未变时才跳过 `setDocumentSource`，但仍报告操作失败；`cause` 标记 `restored:true`、`contentRestored:true`、`noRecoveryWriteNeeded:true`、`retryable:true`，并保留 `operationError`、`recovery` 和 `normalizations`。检查超时或结果不确定时，继续原整页恢复流程；源码比较仍包含 POURED。此行为是本地候选，宿主验收待完成。
