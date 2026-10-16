# PCB操作流程

先按[连接与环境](setup.md)核对窗口、工程、PCB 文档和单位。常用入口见[PCB高频](commands-pcb-high.md)，专项入口见[PCB低频](commands-pcb-low.md)。参数与返回字段查已核对所选窗口版本的 `/help?cmd=<命令名>`；`/help` 使用代理当前选中的窗口。

## 接收设计与核对现状

原理图到 PCB 的更新由用户在 EDA 界面发起并确认。AI 不调用 `pcb.importChanges` 或官方导入接口；更新前后用 `pcb.listComponents`、`getComponentPads`、`listNets` 核对器件身份、封装关联、逐焊盘网络和非目标对象。插件回执成功不代替保存重开或整板检查。

## 板框、图层和布局

- `pcb.drawOutline` 的公开坐标以左下角为基准，单位 mil。重复板框前先查实际图元类型和 ID，不预设一定为 Region。
- 层数和层叠分别核对。`getStackingConfig` 读完整配置，`applyStackingConfig` 后重新读回。设默认层叠不等于当前 PCB 已应用；自定义层变更后重新激活 PCB。未知层名或层号不猜测。
- `pcb.moveComponent` 后用 `checkPlacement` 检查间距。后者基于焊盘包围盒，不能代替器件本体、丝印和机械尺寸检查；`complete:false` 或跳过对象不能报告布局全部通过。
- `pcb.groupBySchematicRegions` 用于明确要求按原理图功能区整理时。先看 `dryRun`、板框容纳情况和尺寸来源，再执行并读回。它不是普通单件移动的入口。

## 扇出、布线和自动布线

密脚器件位置确定后，先用 `pcb.getFanoutPlan` 检查目标、层、尺寸和 `executable`，再把完整 `data` 作为 `pcb.fanout` 的 `params.plan`。几何范围见[PCB几何命令](commands-pcb-special.md)。

人工布线用 `pcb.routeTrack`，换层用 `pcb.placeVia`。先确认网络存在，按电流、规则和板层确定线宽及孔径。分段写入失败可能已有部分线段生效；依据返回 ID 和当前图元核对，不能直接重发。等长组只记录分组，不证明实际等长。

自动布线仅在任务需要时使用：锁定要保留的网络，提交 `autoRouteStart`，用 `autoRouteStatus` 确认任务和回灌结果，再检查实际走线与 DRC。提交成功不等于正在运行。自动回灌可能清除未锁定走线；回灌前必须确认原任务和目标。外部 DSN/SES 导入是另一条流程，不能推断具有同样的清线行为。

## 覆铜和丝印

`pcb.pourCopper` 创建的是边框；用 `rebuildPour` 重建，再用 `listPours` 或 `getPourFillReadback` 确认实际填充。填充状态为 `empty` 或 `unknown` 时不能报告铺铜完成。`rebuildPour` 的 `completed` 不证明填充新鲜、已保存或制造合格。修改边框、优先级或周边布线后再次检查填充；结果不明时停止，不以旧填充冒充本次结果。

局部铜皮先区分 `pour`（随规则裁剪）与 `fill`（固定填充），按[几何命令](commands-pcb-special.md)规划再执行。`modifyPour` 的任意优先级值不保证都可达到，以写后源码读回为准，不据 API 返回值假定成功。

`placeString`、`modifyString` 后检查可读性、镜像、方向、焊盘遮挡及板边。网络丝印仍须通过计划命令，并检查实际图面。

## 检查、保存和生产导出

布线与覆铜后运行 `pcb.runDrc`；定位具体问题时用 `runDrcDetailed`。DRC 不覆盖器件本体、全部机械或制造要求。`runDfm`、`runSmtDfm` 与同网焊盘间距检查的材料、单位及覆盖范围见[下单检查](commands-pcb-special.md)。检查未完整覆盖时不报告通过。

各阶段保存后核对目标与非目标对象。需要证明持久性时，关闭重开后再次读回。Gerber、贴片坐标和网表导出后还需检查文件对应的 PCB 版本、格式、单位和实际内容；见[网络与导出](commands-pcb-special.md)。

删除前查目标图元 ID 并备份。`pcb.delete` 读回未知时停止后续删除。`pcb.sourceRollback` 仅用于确认需要恢复的备份，恢复前核对 PCB UUID，恢复后读回并保存。关闭页签不等于可靠回滚。
