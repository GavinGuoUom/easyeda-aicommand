# 原理图操作流程

先按[连接与环境](setup.md)核对窗口、工程和活动图页。命令选择见[高频](commands-schematic-high.md)与[低频](commands-schematic-low.md)。参数、返回字段和示例从已核对所选窗口版本的 `/help?cmd=<命令名>` 读取；`/help` 不按写入请求的 `instanceId` 路由。

## 查看和放置

1. 用 `schematic.getPageInfo`、`schematic.listComponents` 和 `schematic.listPins` 确定图页、器件和实际引脚。
2. 单件用 `schematic.placeDevice`；完整功能区才考虑 `schematic.buildBlock`。放置后核对实例身份、封装资源、引脚与焊盘编号，再继续接线。
3. `placeDevice` 的即时读回不证明已保存。无封装关联或无电气映射时，不把放置成功当作 PCB 可用。创建后核验失败可能已经留下器件；先查现场，不重放。
4. 资源异常时用 `schematic.getPlacementResourcesDiagnostic` 检查现有实例。只读诊断不证明放置成功，也不授权重新创建。

## 连线和标签

| 目标 | 入口 | 关键限制 |
| --- | --- | --- |
| 一个引脚接命名网络 | `schematic.labelWire` | 引脚引用取实际位号和引脚号；已被异名网络占用时停止。 |
| 两个引脚直接连通 | `schematic.linkWire` | 正好两个引脚，不同时指定网络名。 |
| 一批已确定连接 | `schematic.batchWire` | 检查逐项结果和末次网表；失败项不会自动修复。 |
| 指定路径或标签位置 | `schematic.drawWire`、`schematic.placeNetLabel` | `drawWire` 已给导线命名时，不再叠加同名标签。 |

NC 引脚不得接线。手工路径不要穿过第三方引脚，也不要使异名导线共线重叠；宿主可能把相接导线合并。网络标签的锚点须实际附着导线，文字看起来靠近不等于电气连接。`placeNetLabel` 返回附着未知或浮空时保留现场并停止依赖写入。源码 Y 轴与公开 API 符号相反，不能直接把源码坐标传给绘图指令。

## 修改、整理和删除

- `schematic.moveComponent`、`modifyComponent`、`modifyWire`、`modifyNetLabel` 等修改以独立读回为准，不以 SDK 布尔值判断成功。`modifyComponent` 提交完整属性对象；保留现有 `otherProperty`，不要用库器件默认属性覆盖工程实例。
- `schematic.autoLayout` 仅用于整理已有功能区。先限定目标并运行 `dryRun`；真实运行前保存。移动器件后旧线不随动，`rewire` 会删除并重建相关导线。检查未重接线、跳过的复杂导线和部分移动结果；部分失败时核对 `error.cause.moved` 与现场，不假定自动回滚。
- `schematic.delete` 前核对目标 ID 和依附关系，删除后重扫。超时或读回未知时停止后续删除；`task.get` 可查询长任务，超时不代表取消。保存、关闭、重新打开后再确认删除持久。

## 检查和保存

用 `schematic.listNets`、`listWires`、`getNetlist` 或 `exportNetlist` 比对预期引脚与网络，再运行 DRC。`structuralAudit` 用于排查图面与连接结构；图框等候选项须核实对象身份。`runDrcDetailed` 在不支持明细的宿主可能只返回聚合结果。

`getNetlist`、`exportNetlist` 可能触发宿主更新位号或 Unique ID，不能无条件当作纯只读操作。导出非空仍须解析内容。保存后用 `schematic.exportPng` 检查整页图面，并按返回文件的实际类型解码；多页导出可能是 ZIP。后台 `editor.screenshot` 可能是旧帧。需要证明持久性时，保存、关闭、重新打开，再核对身份、属性、网络及非目标内容。

## 完整器件更换

当前没有一条可靠完成全部替换的指令。按以下顺序组合现有命令；任何一步结果未知，都先停下并只读核对。

1. 用 `project.exportFile` 保存原生 `.epro2` 备份。激活目标页，记录旧器件的 ID、位号、位置、镜像、引脚、网络及需保留的项目属性。读取源码时核对活动页 `DOCHEAD.uuid`；按首个 `||` 分开头体，以 `(type,id)` 取最高 `ticket`，空体为删除墓碑。不把旧记录当成现值，也不把源码 Y 坐标直接传给公开 API。
2. 查询新器件的 Device、Symbol、Footprint、引脚和物料信息。型号、制造商及供应商料号来自新器件，不继承旧件。
3. 在不占用旧位号和旧关联 ID 的位置放新实例。核对新资源来源、封装及逐引脚编号、绝对落点和网络映射。旧新引脚无法一一确认时不得删旧件。
4. 如需转移业务属性，以新实例完整属性为基础调用 `schematic.modifyComponent`。保留新件资源和系统属性；只叠加明确需要的项目属性。`otherProperty` 保留现有自定义键。
5. 只有新实例、连接和必要属性均确认后，才删除旧 ID，并恢复明确要求保留的位号、Unique ID、Channel ID、Group ID、Reuse Block 等项目身份。`setAttribute` 不能伪造 Device、Symbol 或 Footprint 关联。
6. 再核对原理图网表、非目标对象，保存、关闭、重开核对。PCB 更新由用户在 EDA 界面发起和确认；AI 只做前后只读检查。

## 异常修复与宏

标签异常先只读定位，再按问题选择 `pruneFloatingLabels`、`fixNetLabels`、`repairNet` 或 `dedupeWireNets`。支持 `dryRun` 时先预览。浮空标签、重复网名和碎网不能只凭画布判断，修复后复查网表与 DRC。源码改写兜底不是普通修复前置，只有明确需要且已备份时才考虑。

`macro` 仅用于步骤已确定且无需中途判断的组合。任一步失败或结果未知时停止依赖写入；宏返回的步骤集合键为 `steps`。需要根据读回决定下一步时分开提交。
