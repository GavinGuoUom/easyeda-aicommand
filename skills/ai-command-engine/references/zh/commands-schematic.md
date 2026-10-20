# 原理图操作流程

写入前先读[原理图操作要求](原理图操作要求.md)，按其中要求规划器件布局、短桩间距和标签方向。

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

`schematic.batchWire` 的 `label` 项目前不转发 `stubLen`，传入该字段会被忽略；内部沿用 `labelWire` 默认短桩长度 60（原理图坐标单位）。需要指定长度时，逐条调用 `schematic.labelWire` 并传 `stubLen`；该指令最小长度为 20，防撞处理仍可能改变短桩方向或路径。以上参数行为已按 0.20.51 源码核对。

`schematic.linkWire` 同行或同列引脚采用 U 形候选，不同行且不同列采用 L 形候选。它会检查第三方引脚和部分导线共线重叠，但不检查器件本体边界，走线仍可能压过器件。检查返回的 `route` 和图面；需要明确避开器件时，用 `schematic.drawWire` 指定路径，并核对网表和 DRC。连通审计通过不能证明图面无遮挡。

`schematic.drawWire` 的相邻线段可能由宿主合并到既有导线。0.20.20 起 `primitiveIds` 表示最终仍存活并覆盖请求路径的导线 ID，`segments` 表示已执行的简单段数；另读 `created`、`reused`、`removed`，不要把段数或 SDK 返回 ID 当作新增导线数。0.20.21 修正了真实源码中 WIRE 无几何、关联 LINE 的 Y 轴与 SDK 相反所造成的写前误拒绝。当前 4.1.78 宿主一次相邻共线样例已证明旧线几何及样式改变时会返回不可重试 partial，列出复用 ID 并停止；保存重开仍是宿主合并后的状态。SDK 返回 `number[]` 或 `number[][]` 时保留原分组解析，不先展平。仅当候选段与同一 WIRE 的源码 LINE 双向一致时才采用，不能跨组推断连接。仅当同一 WIRE ID 保留、全部旧 LINE 保持且仅新增请求 LINE 的简单追加时，原有 `ATTR`（`zIndex` 除外）须全部保持。此形态下，`zIndex` 仅允许全组保持或全组统一增加新增 LINE 数 `n`；`n` 须为有限整数，且原有 ATTR 按 zIndex 的相对次序须保持，并记录 `drawingOrderChanges`。WIRE 自身及非目标对象仍严格核对；其它差异仍拒绝。v0.20.34 宿主相接第三段样例中，原 LINE、网络和样式保持，`drawingOrderChanges` 与实际变化一致；保存、关闭、重开后有效记录相同。该结果只覆盖这一简单追加形态。v0.20.35 候选允许未向 `create` 传 `net` 的新 WIRE 在几何和样式先通过后，接受 SDK 自动添加的空 NET+Relevance；ATTR header ID 须有效，parentId 须为该新 WIRE，key 须为 NET；仅 NET value 和 getter.net 必须为空字符串，Relevance 按其独立规则核对。旧 WIRE 仍严格核对；显式命名段须满足 request/source/getter 一致。`named:false` 保持未命名；回显 `net` 只是输入回显，不能证明分离线段归网。不得补名、加标签或重试。源码及真实夹具回归已通过专家最终复审；候选宿主验收待完成。A08 的写后源码与 SDK ID 集暂不一致时仍只读重采样，并受命令剩余总时限约束；每轮同核焦点、源码和模型，超时或迟到后不再读写。首次及后续读取均受限；不重试创建/修改/删除，也不继续后续线段。一致后仍须完成全部几何、网络和样式核验；仍不一致则返回 partial，附双方 ID 与采样时间。先核对实际图页，不自动重画。其它画线路径仍需分别验收。

NC 引脚不得接线。手工路径不要穿过第三方引脚，也不要使异名导线共线重叠；宿主可能把相接导线合并。网络标签的锚点须实际附着导线，文字看起来靠近不等于电气连接。`placeNetLabel` 返回附着未知或浮空时保留现场并停止依赖写入。源码 Y 轴与公开 API 符号相反，不能直接把源码坐标传给绘图指令。

## 修改、整理和删除

- `schematic.moveComponent`、`modifyComponent`、`modifyWire`、`modifyNetLabel` 等修改以独立读回为准，不以 SDK 布尔值判断成功。`modifyWire` 先核对整批导线对象与源码，区分无属性、空值 NET、非空 NET；同一次 SDK 调用传完整颜色、线宽、线型（未请求项用核实的原值），已有空 NET 明确传 `net:''`，无属性导线不补网名。宿主 getter 将同 ID 的源码 NET 显示为 Name 时按 ID、值、父归属核对后兼容，真正 Name-only、重复或冲突属性写前拒绝。每根写后及整批末尾核对对象、源 NET 属性与 LINE ID/端点/样式，失败即停止并尝试整页恢复；恢复未确认时停止依赖该结果。0.20.18 的空 NET 单线及两条显式同名导线批量改色已在当前宿主保存重开通过；0.20.19 对主动线型仅接受写前可核对的 `0/SOLID`、`1/SHORT_DASH`、`2/DOT`，写后再核对目标编码。单根命名线实线→虚线→点线→实线已在当前 4.1.78 宿主各自保存重开通过，复杂多段线仍未验收。P4 宿主批量测试中，两条命名 A 线由 dotted 改为 dashed，仅两条 LINE 的 `strokeStyle` 改变；第三条空 NET 线及其它非目标内容保持，保存重开后有效记录相同。混合空/非空 NET 的单 net 严格 getter 筛选无法由当前接口表达，属不适用，不列为未验。`modifyComponent` 提交完整属性对象；保留现有 `otherProperty`，不要用库器件默认属性覆盖工程实例。
- `schematic.autoLayout` 仅用于整理已有功能区。先限定目标并运行 `dryRun`；真实运行前保存。移动器件后旧线不随动，`rewire` 会删除并重建相关导线。检查未重接线、跳过的复杂导线和部分移动结果；部分失败时核对 `error.cause.moved` 与现场，不假定自动回滚。
- `schematic.delete` 前核对目标 ID 和依附关系，删除后重扫。超时或读回未知时停止后续删除；`task.get` 可查询长任务，超时不代表取消。保存、关闭、重新打开后再确认删除持久。

## 检查和保存

`schematic.listComponents.allPages` 与 `schematic.structuralAudit.allPages` 须为布尔值。`schematic.structuralAudit.ncExempt` 须为字符串数组。`schematic.structuralAudit.deviceMargin` 省略时为 10 mil；传入时须为有限且不小于 0 的数字。

`schematic.exportPng` 的宽高须为 1–4096 的整数，省略时沿用指令默认值。

用 `schematic.listNets`、`listWires`、`getNetlist` 或 `exportNetlist` 比对预期引脚与网络，再运行 DRC。`structuralAudit` 用于排查图面与连接结构；图框等候选项须核实对象身份。`runDrcDetailed` 按宿主实际返回的结构标记逐条或聚合结果；EDA 4.1.78 已实测逐条明细，不能仅按版本推断。第一轮图框样例另观察到 10 个 `ATTR` 读回补出 `strikeout:false`；保留为独立观察，不据此放宽其它对象核对。`runDrc`、`runDrcDetailed` 和 `buildBlock` 的收尾审计遇到非数组或未知 DRC 结构会报“结果不可判定”；`buildBlock` 会把原因放在 `auditError` 中，此时不能视为通过。刚保存后若两次检查数量不同，应等待拓扑刷新后再查。

`schematic.exportBom(fileType=csv)` 保留宿主原始文件字节。读取返回的 `format`、`encoding`、`delimiter` 再解析；EDA 4.1.78 的 `.csv` 实为 UTF-16LE 制表符文本，不能按 UTF-8 逗号 CSV 解析。`fileName` 可传带或不带匹配后缀的名称，插件会避免重复追加后缀。`xlsx` 文件以 ZIP 文件头确认；格式无法确认时按返回的 `note` 检查原始文件。

EDA 4.1 的 `listNets` 使用 PADS 网表和命名导线回退；自动网络名可列出，但 `detail:true` 不能保证把无网络名的导线归属到对应自动网，需用 `getNetlist` 核对引脚。回退不可用会报错。点/区域图元查询需要 EDA 4.2 或更高版本。

EDA 4.1.78 的 `schematic.modifyText` 即时读回可成功，但保存重开后内容和位置会回退。本插件在 4.1.78 拒绝该指令；它需要 EDA 4.2 或更高版本，4.2 的保存持久性尚未实机验证。区域和点图元查询也需要 4.2，逐条名称见[原理图低频指令](commands-schematic-low.md#eda-版本限制)。

`getNetlist`、`exportNetlist` 可能触发宿主更新位号或 Unique ID，不能无条件当作纯只读操作。导出非空仍须解析内容。保存后用 `schematic.exportPng` 检查整页图面，并按返回文件的实际类型解码；多页导出可能是 ZIP。后台 `editor.screenshot` 可能是旧帧。需要证明持久性时，保存、关闭、重新打开，再核对身份、属性、网络及非目标内容。

## 完整器件更换

AI Command Engine 自身没有一条完成全部替换的指令。替代型号、封装和引脚映射由 AI 与人工共同确认，独立模块复用插件执行原理图与 PCB 同步替换。其 prepareReplacement、executeReplacement、getReplacementOperation 通过独立 module-reuse:rpc:v1 调用，不是 ACE HTTP 指令。带内置 Gateway 的版本由模块技能后台隐藏启动桥接，无需单独安装 Gateway 或 AI Command Engine；修正版只连接来源检查修订号匹配的桥接，调用时使用模块技能返回的地址，不回退到旧服务；覆铜、挖空、自定义开窗属于复用后的收尾修补。下面是仅使用 ACE 时的组合流程；任何一步结果未知，都先停下并只读核对。

1. 用 `project.exportFile` 保存原生 `.epro2` 备份。激活目标页，记录旧器件的 ID、位号、位置、镜像、引脚、网络及需保留的项目属性。读取源码时核对活动页 `DOCHEAD.uuid`；按首个 `||` 分开头体，以 `(type,id)` 取最高 `ticket`，空体为删除墓碑。不把旧记录当成现值，也不把源码 Y 坐标直接传给公开 API。
2. 查询新器件的 Device、Symbol、Footprint、引脚和物料信息。型号、制造商及供应商料号来自新器件，不继承旧件。
3. 在不占用旧位号和旧关联 ID 的位置放新实例。核对新资源来源、封装及逐引脚编号、绝对落点和网络映射。旧新引脚无法一一确认时不得删旧件。
4. 如需转移业务属性，以新实例完整属性为基础调用 `schematic.modifyComponent`。保留新件资源和系统属性；只叠加明确需要的项目属性。`otherProperty` 保留现有自定义键。
5. 只有新实例、连接和必要属性均确认后，才删除旧 ID，并恢复明确要求保留的位号、Unique ID、Channel ID、Group ID、Reuse Block 等项目身份。`setAttribute` 不能伪造 Device、Symbol 或 Footprint 关联。
6. 再核对原理图网表、非目标对象，保存、关闭、重开核对。PCB 更新由用户在 EDA 界面发起和确认；AI 只做前后只读检查。

## 异常修复与宏

`schematic.pruneFloatingLabels.dryRun` 和 `schematic.fixNetLabels.dryRun` 只接受布尔值；前者省略时执行清理，后者省略时只预览。

v0.20.29 候选同时严格检查 `listNets.detail`、`pruneFloatingLabels.allowSourceRewrite` 和 `repairNet.dryRun`，非布尔值在读取或写入前拒绝；各参数原有默认行为保持。新增检查尚待新版宿主验收。

标签异常先只读定位，再按问题选择 `pruneFloatingLabels`、`fixNetLabels`、`repairNet` 或 `dedupeWireNets`。支持 `dryRun` 时先预览。浮空标签、重复网名和碎网不能只凭画布判断，修复后复查网表与 DRC。源码改写兜底不是普通修复前置，只有明确需要且已备份时才考虑。

`macro` 仅用于步骤已确定且无需中途判断的组合。任一步失败或结果未知时停止依赖写入；宏返回的步骤集合键为 `steps`。需要根据读回决定下一步时分开提交。
