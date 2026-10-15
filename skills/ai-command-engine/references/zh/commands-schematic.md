# 原理图指令全表

> 本页表格/参数对象描述命令及 `params`，不是完整 HTTP 请求。发送 `/command` 时外层必须带 `cmd`、顶层 `instanceId` 和所需 `params`；宏仅外层路由，步骤继承实例。完整示例见 [setup](setup.md)。

四组：**① 批量生成整理（第一入口）→ ② 基础指令 → ③ 修复维护 → ④ 查询检查导出**。完整陷阱见 [pitfalls.md](pitfalls.md)。

## ① 批量生成与整理（第一入口）

### 完整器件更换

当前没有一条完整替换指令。按以下步骤组合既有物料查询、放置、读回、删除和属性修改指令，逐步核对后再依赖下一步。

先用`project.exportFile`传`fileType:"epro2"`备份原生工程。4.1.78测试中，原理图已换件但PCB尚未同步时，旧格式`.epro`导出出现了新旧器件信息混合，不能将该旧格式文件当作本次正确恢复包。

源码每条记录为`JSON头||JSON体`，末尾可带`|`。按首个`||`分开头体，保留JSON字符串内部的`|`。按`(type,id)`取最高`ticket`，体为`""`的记录表示删除；只检查重放后的有效记录。坐标和旋转采用`listComponents`的公开坐标，不能直接把源码中符号相反的Y坐标传给放置指令；镜像可从`COMPONENT.isMirror`读取。

1. 激活目标图页，按完整器件位号或立创编号唯一确定对象。用`schematic.listComponents`、`schematic.getAttributes`、`schematic.listPins`、`schematic.listWires`和`project.getDocumentSource`记录旧器件的`primitiveId`、坐标、方向、镜像、位号、Unique ID、Channel ID、Group ID、ReuseBlock、需保留的业务属性，以及每个引脚号的绝对坐标、NC状态和原网络。`project.getDocumentSource`只读返回当前激活文档的源码；按头/体记录解析并以`COMPONENT`头的`id`匹配器件，再收集`ATTR`体中`parentId`为该ID的属性。`COMPONENT`记录提供`isMirror`等组件字段，`ATTR`提供身份和业务属性。未知格式或无法唯一匹配所需字段时停止并说明缺口，不直接改写源码。
2. 用`lib.deviceGetByLcscIds`或`lib.deviceSearch`定位新物料，再用`lib.deviceGet`读取完整器件资料。确认具体Device、Symbol、Footprint关联、器件型号、制造商及供应商料号；这些新物料资料必须来自新器件，不能从旧器件继承。
3. 用新器件放置一个临时实例。`schematic.placeDevice`按立创编号调用，或传`deviceUuid`和`libraryUuid`；同时给出`x`、`y`，按需要传`rotation`、`mirror`、`subPartName`、`addIntoBom`和`addIntoPcb`。新器件暂不占用旧位号或旧关联ID。

```json
{"cmd":"schematic.placeDevice","params":{"deviceUuid":"新器件UUID","libraryUuid":"新器件库UUID","x":300,"y":300,"rotation":0,"mirror":false,"addIntoBom":true,"addIntoPcb":true}}
```

多部件器件按需加`subPartName`；坐标和方向应使新器件的目标引脚落在记录的原引脚位置。

4. 用`schematic.listComponents`、`schematic.getAttributes`、`schematic.listPins`和`project.getDocumentSource`读回新实例。逐项确认新Device、Symbol、Footprint、型号和物料号，并按引脚号比较新旧引脚的绝对落点与原网络。需要保留业务属性时，用`schematic.modifyComponent`在新实例完整属性上叠加这些键，此时仍保留新件临时位号和身份。不能用旧属性表覆盖新属性。NC引脚应保持未连接。若任何引脚映射、导线端点、网络或资源关联不一致，不得删除旧器件。
5. 新器件全部通过后，才用`schematic.delete`删除旧`primitiveId`。读回确认旧器件已不存在，再用`schematic.setAttribute`恢复新实例已有的`Designator`、`Unique ID`及确需保留的`Channel ID`、`Group ID`、`Reuse Block`。它只修改已有属性，不能用它伪造Device、Symbol或Footprint关联。
6. 重新读取新旧器件ID映射、引脚、导线、网标和网络，确认原连接保留且非目标图元未变化。保存图页，关闭并重新打开后再次核对器件身份、资源关联、属性、引脚落点和网络。

任一步写入结果未知时，先只读检查现场并停止后续写入；不盲目重试，不假设自动回滚。现有指令无法保留必要属性或网络关联时，报告具体缺口并停止。PCB更新由用户在EDA界面手动发起并确认；AI不调用`pcb.importChanges`或官方导入接口。

`schematic.modifyComponent`必须提交完整14字段：`x,y,rotation,mirror,addIntoBom,addIntoPcb,designator,name,uniqueId,manufacturer,manufacturerId,supplier,supplierId,otherProperty`。位置和旋转来自新实例`listComponents`，镜像来自`COMPONENT.isMirror`。其余从新实例有效ATTR读取：`Designator/Name/Unique ID/Manufacturer/Manufacturer Part/Supplier/Supplier Part`分别对应顶层同义字段；`Add into BOM`和`Convert to PCB`的`yes/no`转为布尔值。`otherProperty`保留新实例普通属性，仅叠加明确选择的业务键；不放入`Device/Symbol/Footprint`、`Reuse Block/Group ID/Channel ID`、`3D Model/3D Model Title/3D Model Transform`和上述已有顶层字段的系统键。用`getAttributes`和读回结果对照完整属性，不凭目标库的显示名称猜值。

### `schematic.buildBlock` — 从零生成功能区

器件清单+连接表 → 自动区框（默认 0,0 起、黑虚线，可 color/lineType）→ 行列排布（cw32 模板横距 60 行距 90，标题框底居中字号 20）→ 按 nets 连线 → 网表+DRC 自查。

| 参数 | 说明 |
| --- | --- |
| `components` | 器件清单（lcscId + 自定义 `ref`） |
| `nets` | 连接表，引脚用清单里的 `ref`（"U1.7"，**不是 EDA 自动位号**；插件做 ref→位号映射，返回 `refMap`） |
| `region?` `title?` `color?` `skipAudit?` | 区框起点/标题/颜色/跳过网表审计 |

- 用户 ref 自动落为真实位号（"R?" 改写+读回验证，失败带 `designatorNote`）。
- 连线走 batchWire 引擎：2 引脚非电源网 → link 无名 U 形线；≥3 引脚/电源网（VDD/VCC/GND 及**全大写下划线后缀**如 VDD_T、VOUT_5V；小写后缀算信号）/显式 `style:"label"` → 每引脚 label 短桩。per-net color 透传。
- 逐条收错不中断 + 一次网表统一审计（明细 `wireAudit`）。**必看返回**：`refMap`、`designatorNote`、`incomplete`/`failed`/`wireAudit`。
- 规则式网格排布，约 80 分美观；生成后可 `moveComponent` 微调。

### `schematic.autoLayout` — 整理已有功能区

已放好的器件重排+重建连线。`designators` 或 `region` 二选一框定器件。

流程：导网表取连接表（NC/悬空跳过）→ 网络聚类贪心排序+行列排布（横距 60 行距 90，`template` 可改）→ 安全移动器件（读回几何并核对其他状态）→ **rewire（默认开）**：删碰旧引脚的导线（级联删标签）+清浮标+连接表转 batchWire 重建。

- **dryRun 默认 true**：只出方案（plan 旧→新坐标；connections 连接表+link/label 风格），确认后 `dryRun:false` 才动。真跑前先保存工程。自动布局本身不会自动恢复已发生的移动；
- 官方移动器件后旧导线/标签不跟随（实测）；rewire 是删旧重建不是平移。
- 移动失败的 `stateDifferences` 保留 `undefined`、`null`、空串等实际值并由 `autoLayout` 透传；非几何状态保护仍有效，现场属性变化的原因尚未确认。
- 网表首个坏快照缺失的根因尚未确认；外部逐页脚本用于补充并留存证据，不据此声称 `getNetlist` 算法已修复。
- rewire：link 直连先于 label；删线前按全页引脚分类——纯内部线照删；带 1 外部引脚的线删后自动补网（`externalRewired`）；穿 ≥3 引脚的复杂长线保留（`skippedWires`，可能留悬线需人工复核）；link 重建因穿第三方引脚失败自动降级两端 label（`fallbacks`）；仍未恢复进 `rewireFailed`（旧线已删、网断，须人工修）。
- 跑完看 `moved`/失败 `error.cause` 中的 `partial`、`moved`、`phase`、`stateDifferences`/`rewired`（含 wireAudit）/`drc`；有部分移动失败时先停止后续写入并检查 `error.cause.moved` 指出的现场，再依据备份受控恢复，并目测画布。
- 分工：**buildBlock 从零生成；autoLayout 整理已有**。

### `schematic.batchWire` — 批量连线

一次提交 label/link 混合项：`items:[{type:"label",pin,net,color?},{type:"link",pins,color?,jogDir?}]`。

- 逐条执行逐条收错，最后一次网表统一审计——比逐条调快数倍。
- 网表是缓存快照：任一项未过则等 800ms 重导，最多 5 次取末次。
- **只报告不自动修复**：audit 失败项按 `audit.detail` 处置后重跑该项。
- 审计未过的项即使执行 ok 也进 `failed`（带实际网名）。
- `continueOnError?` `skipAudit?` 可选。

## ② 基础指令（第二入口）

### 语义化连线（单条也可用）

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `schematic.labelWire` | **单引脚接入命名网**：沿引脚朝向外画短桩+放同名标签（防呆+附着验证）。必须带网名只接 1 脚 | `pin`("U1.7"), `net`, `color?`, `force?`, `stubLen?` |
| `schematic.linkWire` | **正好 2 引脚物理连通**：U 形正交走线，横腿动态避让防共线合并。必须 2 脚不带名（要命名用 labelWire） | `pins`(["U1.7","C1.1"]), `color?`, `jogDir?`, `force?` |

- 两指令互斥（1 脚带名 vs 2 脚无名），根治"短线已有网名又叠同名标签"事故。
- 短桩默认长 60（容纳 STATUS_LED 级长网名右伸不压本体；`stubLen` 可覆盖，最小 20，不自适应）。
- **标签 rotation 恒 0、锚点恒在桩末端**。附着判定看锚点，锚点须在导线上，离线外 5 单位即浮标；rotation 180=反字（装机实锤）。朝左场景用位置偏移，不要旋转。
- 文字宽度估算 **4.4×字符数+5 单位**（数字/下划线略宽，宁高估）。
- **占用预检**：引脚已被同名网占用直接复用；异名占用拒绝（防串网）；`force:true` 强并。
- **整段路径避让**：短桩/横腿全段 8 单位内有任何引脚即换向；linkWire 全部候选（U形避让层按当前引脚和导线范围推导，L形保留两种基本转折）逐段查引脚（两端点豁免），无解抛 `PIN_CROSSING_FALLBACK`。
- **NC 引脚禁止接线**：预检中文报错，不强画。
- 附着验证失败快速返回 `attached:false`（最多 2 次 500ms 重试）。

### 放置与绘制

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `schematic.placeDevice` | 放器件并核对工程封装资源与编号（默认进 BOM 和 PCB） | `lcscId` 或 `deviceUuid`+`libraryUuid`, `x`, `y`, `rotation?`, `addIntoBom?`, `addIntoPcb?` |
| `schematic.connectPin` | 底层单脚连线：引脚尖端外 30→引脚原点，端点落原点即连通。**普通场景优先 labelWire** | `primitiveId`, `pin`, `net` |
| `schematic.drawWire` | 画导线（折点数组；自动拆段+去重+智能命名；支持 color/lineWidth/lineType） | `points`, `net?`, `color?`, `lineWidth?`, `lineType?` |
| `schematic.placeNetLabel` | 放网络标签（**自动验证附着**；同名防呆） | `net`, `x`, `y`, `noVerify?`, `force?`, `rotation?` |
| `schematic.placeText` | 注释文本（非电气） | `x`, `y`, `content`, `fontSize?` |
| `schematic.placeRegion` | 区框+标题一步（标题自动框内左上，返回 span） | `x`, `y`, `width`, `height`, `title`, `color?`, `lineType?`, `fontSize?` |
| `schematic.moveComponent` | 移动/旋转/镜像（内部分步+读回验证） | `primitiveId`, `x?`, `y?`, `rotation?`, `mirror?` |
| `schematic.moveLabel` | 移动网络标签/属性 | `primitiveId`, `x`, `y` |

- **drawWire 带 net 会自动在导线中点落一个 NET 属性标签**（与 placeNetLabel 两套，同网并存即重复；它是导线持有属性，官方不支持单独删）——要标签收尾：**drawWire 不传 net + placeNetLabel 放标签，别两边都命名**。命名成功返回 `namingNote`。
- drawWire 智能命名：该网已在页面存在则自动画无名段。
- connectPin 别让导线探入器件本体侧（端点落引脚线中段→T 形结点红点+"单网络"警告）；EDA 只认与引脚线段非零重叠的导线——端点对端点重合、网标直贴引脚都报致命"引脚端点重叠且未连接"。
- **共线合并陷阱**：官方自动把几何共线重叠/相接的导线合并——勿画穿中间引脚的长直线（会把中间引脚并进网）；勿让不同网的导线/短桩/横腿共线重叠（串网）。批量指令内部已防，手画 drawWire 同样避开。
- placeNetLabel：标签压线体上会被拒（自动 ±2 微偏重试）；只有按本次标签 ID、父导线及父导线属性三处读回一致，才返回 `attached:true` 和 `wireId`，ghost 标签也走同一验证。读回未知或确认浮空时以 partial 异常返回并保留标签及 ID，不自动删除；`noVerify:true` 不证明已附着。附近同名导线或负坐标都不能证明附着；已有该网名的导线仍拒绝（`force:true` 强放）；`rotation` 默认 0，显式传入时尝试设置并读回核对。
- 网格吸附：坐标取 10 的倍数，否则 DRC 报"网络图元不在格点上"。

#### placeDevice 的封装核验（0.10.94 候选）

- 先读取完整库器件关联，仍按官方 UUID 引用创建一次；再独立读取实例、工程封装资源以及引脚。不会自动修复缺失关联或重复放置。
- 库器件有关联封装时，实例封装须指向目标工程资源，资源来源须匹配库封装与库 UUID，当前实例的每个引脚编号须在封装 PAD 编号中存在。0.10.96 候选改用公开完整工程 epro 导出，读取精确 `FOOTPRINT/<实例封装UUID>.efoo`，保留 HEAD.uuid 与来源检查；需宿主允许下载工程。当前支持逐行数组格式 FOOTPRINT 资源，格式不支持或证据缺失即报错。
- 成功保留 `primitiveId`、`designator`，新增 `readback.footprint`（含 `projectUuid`、`resourceSource`、`resourceVerified`）及 `pinPadMapVerified`。`pinPadMap` 为引脚编号到 PAD 图元 ID 的对应，`pinMapScope:"placed-instance-only"` 只覆盖本次子部件，不证明其他子部件或整个器件的映射。
- 库器件没有封装关联仍可放置，返回 `libraryFootprint:"none"`；没有电气引脚和编号焊盘时 `electricalMapping:"none"`、`pinPadMapVerified:false`，不得当作已验证电气映射。
- 创建尝试后的核验失败带 `partial:true`、`retryable:false`、阶段和已取得的 `primitiveId`。先核对现场，不自动重试或删除。执行期间原理图页或工程焦点变化也会停止。
- `readback.verified:true` 仅表示上述即时核验通过，`persistenceVerified:false` 明确尚未保存重开；网表、DRC 与保存重开须另行验证。

0.10.95 实机诊断已确认当前图页资源接口返回空数组，完整工程包中目标资源存在。0.10.96 候选据此修正核验的数据来源，并在导出前后检查图页/工程及实例引用。返回增加 `resourceOrigin:"project-export-epro"` 和 `resourcePath`，仍不等于保存持久性通过。2026-10-10 已在 0.10.96 隔离工程完成新测试点放置：封装来源与引脚/PAD 映射核验通过。保存、关闭并重开后，封装引用、BOM/PCB 标志、位号与唯一 ID 保留，网表一致。该结果仅覆盖已测器件；历史封装丢失根因未复现。

#### 封装资源的只读诊断（0.10.96 候选）

`schematic.getPlacementResourcesDiagnostic` 必须提供现有器件 `primitiveId`。读取当前原理图页和工程身份、实例封装 UUID，以及 `getDocumentFootprintSources()` 的资源数量和逐项摘要（原始 `footprintUuid`、源码长度、DOCTYPE、HEAD.uuid、解析错误）。不返回完整源码，不创建、修改或保存器件。

0.10.96 候选额外返回 `projectResource`，用与放置核验相同的完整工程读取函数提供目标路径、HEAD/来源及焊盘编号摘要。结果保留 `diagnosticOnly:true`、`placementVerified:false`，解析/导出错误或焦点变化按未完成处理；不据此重试创建器件。0.10.95 的空数组已实测确认。2026-10-10 的 0.10.96 隔离宿主中，既有 TP2 和新 TP3 保存重开后的 projectResource 路径、HEAD、来源及 PAD 编号均正确。只读诊断仍不单独代表新建器件已通过全部核验。

### 修改类

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `schematic.setWireNet` | 改导线网名（modify 后强制读回，返回 `readback:{net,verified}`） | `primitiveId`, `net` |
| `schematic.modifyComponent` | 完整修改器件属性并独立读回 | `primitiveId`, 完整 `property`，见下文 |
| `schematic.modifyWire` | 改颜色/线宽/线型/网名（可按网名批量，如 3V3 全网标红） | `primitiveId` 或 `net`, `color?`, `lineWidth?`, `lineType?`, `newNet?` |
| `schematic.modifyNetLabel` | 改颜色/位置/改名/**文字方向**（可按网名批量） | `primitiveId` 或 `net`, `color?`, `newNet?`, `x?`, `y?`, `rotation?` |
| `schematic.modifyText` | 改注释文本 | `primitiveId` |
| `schematic.modifyRect` | 改位置/尺寸/样式（y 也是上沿） | `primitiveId`, `x?`, `y?`, `width?`, `height?` |

- 官方 modify 多字段合并改会整体失效（实测"位置+旋转"同传→什么都没改）——插件已**原子化拆分**（每字段独立步骤+逐步读回，不符挪 failed 带实际值），调用侧多字段照传。
- 官方 modify 有假失败也有假成功——凡修改，成败以读回/源码重扫为准。
- 镜像/rotation 180 都反字——正常标签 rotation 0、锚点压导线；官方属性接口不支持 mirror，被镜像的标签只能转正或删了重放。

#### modifyComponent 的完整属性与系统别名（0.10.94 候选）

`property` 必须明确包含这 14 项：`x`、`y`、`rotation`、`mirror`、`addIntoBom`、`addIntoPcb`、`designator`、`name`、`uniqueId`、`manufacturer`、`manufacturerId`、`supplier`、`supplierId`、`otherProperty`。`otherProperty` 须包含实例当前已有的自定义属性，避免 SDK 清掉漏传的键。

宿主把九个系统键放在专用字段中：`Add into BOM`→`addIntoBom`、`Convert to PCB`→`addIntoPcb`、`Designator`→`designator`、`Name`→`name`、`Unique ID`→`uniqueId`、`Manufacturer`→`manufacturer`、`Manufacturer Part`→`manufacturerId`、`Supplier`→`supplier`、`Supplier Part`→`supplierId`。插件按对应字段读回。

- 若 `otherProperty` 重复提供这些键，值须与顶层字段一致。布尔别名只接受 `"yes"` / `"no"`，分别对应 `true` / `false`。冲突在写入前报错。
- 顶层字符串为 `null`、别名为空字符串时表示清空。实际读回允许 `null`、`undefined` 或空字符串。其他字符串和布尔值保持严格比较。
- 返回的 `readback.otherProperty` 保持实际读回内容，可能没有上述系统键。不要据此判定漏写。
- 真正不匹配、读回失败或焦点变化仍报错。已尝试写入的失败带 `partial:true`、`retryable:false`；先核对现场，不能直接重发。
- 不要把库器件默认属性直接当作工程实例的修改请求。封装、符号和器件的工程内引用与库 UUID 可能不同。

该修复已通过本地回归及 0.10.94 隔离宿主测试：BOM=false、PCB=true、位号及唯一 ID 修改读回正确，保存关闭重开后属性保留、网表逐字一致。此结果只覆盖已测字段与器件，不代表所有属性组合均已实测。

## ③ 修复维护（出问题再用）

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `schematic.pruneFloatingLabels` | **【宏】清浮空标签**（附着残留、删线孤儿） | `dryRun?`（默认 `false`；预览须显式传 `true`）, `batchSize?`, `allowSourceRewrite?`（仅控制浮空标签处理的源码改写兜底） |
| `schematic.fixNetLabels` | **【宏】标签全科体检**：①浮空 ②重复 ③反字 ④位置不对 | `dryRun?`, `angle?`, `net?` |
| `schematic.repairNet` | **碎网修复宏**：审计→收养无名残线→补标签→网表前后对比 | `net`, `adoptWireIds?`, `dryRun?` |
| `schematic.dedupeWireNets` | 清"导线多个网络名"警告（仅历史图纸） | 无 |
| `schematic.delete` | 删图元（批量；先识别类型+删除后立即读回+终扫对账；仍在才按既有间隔复核；未知读回以 partial 停止后续写入） | `primitiveIds`, `batchSize?` |

- **浮空标签（parentId=$$root）官方删除盲区**：属性图元不支持删除（@internal），主通道**借尸还魂**（建临时导线→modify 挂 parentId→删导线级联带走→源码重扫验证）；官方 modify parentId 有假失败——以走完后的源码重扫为准。
- pruneFloatingLabels：`dryRun` 可预览浮空标签。插件按当前结果处理全部目标；已确认失败不因失败次数停工，超时或读回未知时停止后续写入。`batchSize` 只影响分批节奏，不能把任意失败次数当作页面损坏。
- **浮空标签处理的源码改写第三兜底默认禁用**（实机事故：离线字节级验证过 ≠ 运行时安全，官方写回有格式校验弹窗拒绝）：仅显式传入 `allowSourceRewrite:true` 才尝试，返回带 `warning`，操作前保存工程。此开关与普通 `TEXT` 删除使用的内部快照路径分开；全失败返回 `manualDelete` 世界坐标清单。
- 创建或删除失败时按实际读回判断，不能仅凭连续失败次数认定页面损坏。结果未知时停止依赖写入；关闭重开不代表已回滚。
- fixNetLabels：**dryRun 默认 true 只出四类体检报告**（id/net/世界坐标/问题/建议），确认后 `dryRun:false` 真修，逐条收错，修完自动 pruneFloatingLabels 复核。四类：浮空（parentId=$$root，DRC 来源）；重复（同线同网名>1 或锚点距<10）；反字（rotation 180）；位置不对（锚点离线>20 或导线戳出悬空端点）。
- repairNet：人工拖标签致网断后用它收尾；流程另见 pitfalls.md。
- **delete 加固**：先识别类型；删除调用后立即读回，只有仍在才按既有 400/600/1000ms 间隔复核，最后终扫对账。SDK 布尔返回不代表成功；写入超时或读回未知保持 partial，停止后续项和健康探针，不能用“终扫目标消失”清洗未知写入。`unprocessed` 只表示未处理，须先核对现场和写保护。非未知路径的健康探针仅单次串行创建/清理；探针不能代替保存重开。`taskId` 可用于查询原任务，超时不代表取消。`deletedBy` 含 `text` 时，日常统一用 `schematic.delete`，不自动保存；按任务另行 save→close→open 核验持久性。
- 导线中点的 NET 属性标签**不支持单独删**（delete 报"删后仍在"是预期）——只能删整根导线重画。

## ④ 查询与检查导出

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `schematic.getPageInfo` | 图页信息+图框尺寸（titleBlock width/height，单位 10mil；titleBlockData 键决定 modifyTitleBlock 能改什么） | `pageUuid?` |
| `schematic.listComponents` | 列器件 | `allPages?` |
| `schematic.listPins` | 列引脚（编号/名称/坐标） | `primitiveId` |
| `schematic.listWires` | 列导线（读回自查） | `net?` |
| `schematic.listNetLabels` | 列全部网络标签（含 attached 和颜色——浮空标签就是 DRC"没有连接导线"来源；0.10.46 起查标签一律用本指令，listLabels 已删） | `net?` |
| `schematic.listTexts` | 列注释文本（0.10.46 起带 `offGrid` 格点标记，接替已删 listLabels 的"不在格点"排查） | 无 |
| `schematic.listRects` | 列全部矩形（返回归一化 `span:{x1,y1,x2,y2}`，布局计算一律用 span） | 无 |
| `schematic.checkRectOverlap` | 矩形两两重叠检查（输出带 span） | 无 |
| `schematic.getComponentsInRect` | 区框内器件（按锚点判定；按 rectId 或显式 span；支持 margin 外扩） | `rectId` 或 `x1,y1,x2,y2`, `margin?` |
| `schematic.getPrimitivesInRegion` / `getPrimitiveAtPoint` | 区域/点查图元 | ⚠️ 文本类可能不被区域查询返回 |
| `schematic.runDrc` | 原理图 DRC（内部自动两遍取稳定值） | 无 |
| `schematic.runDrcDetailed` | DRC 逐条明细（**需 EDA v4.2+**；4.1 只返回聚合结构并标 `aggregated:true`，别假装支持或反复重试） | 无 |
| `schematic.structuralAudit` | **【0.10.60】整页结构+排版验收（只读）**：并查集编树+官方 net 对账。blocking=桥接(LABEL_NET_MISMATCH/树内多网名)/异网共线重叠/重复位号；candidate=孤立树/浮标/引脚穿线/十字交叉/区框重叠/器件出区/器件相碰(引脚云近似待目检)；info=零长段/悬端/同网重叠。九页验收逐页调用 | `ncExempt?`(豁免名单如 ["U2.2"]), `deviceMargin?`(相碰筛选外扩 mil,默认 10) |
| `schematic.exportNetlist` | 导网表（base64；须解析后逐网络核对引脚） | `fileName?`, `netlistType?` |
| `schematic.getNetlist` | 取得网表字符串（生成时可能自动更新位号/Unique ID并保存） | `netlistType?` |
| `schematic.save` | 保存原理图 | 无 |

- 2026-10-12实测与宿主源码确认：生成网表可能先更新重复Designator/Unique ID并保存。`getNetlist`与`exportNetlist`不能当作只读来源查询；在隔离目标允许该变化时使用，随后按实际源码身份核对。
- 0.10.104 起，网表文件导出拒绝零字节文件及空 base64；`getNetlist` 拒绝纯空白文本。返回非空数据仍须解析并核对实际引脚，不能只看导出成功。
- 官方单对象 `get()` 对已删除 ID 永久返回缓存旧对象——存在性判断用全量列表/源码重扫，别用 `get()`。
- **structuralAudit 宿主语义边界（0.10.61 实测）**：①宿主会把物理相接的异网名导线**合并成一个 wire** 并把 net 定为其中一个名——桥接实际由 LABEL_NET_MISMATCH[blocking] 抓获，MULTI_NET_TREE 只在字段可伪造的场景出现，不触发属正常；②画线穿过引脚会被官方**吸附拆分**、引脚成为端点=合法连接——PIN_INTERIOR_LANDING 在宿主数据上通常不触发，规则保留作防御；③图框 (0,0) 会被报 COMP_OUTSIDE_REGION[candidate]，图框不是器件，可忽略。
- 官方 `getAll(net)` 网络过滤不可靠——插件已改全量取回手动过滤。
- 人工在 EDA 界面**拖网络标签会丢附着甚至删标签、碎网**——拖后用 `listNetLabels` 查 attached 并审计成员完整性。
- **文档源码与 API 的 Y 轴符号相反**（API y=-600 ↔ 源码 y=+600）——两边比对必须翻转 Y。
- `createNetLabel` 有假失败（返回空但已创建附着）——复查按**属性值+坐标**匹配，别依赖导线网名的异步传播。

## ⑤ 宏指令（组合多个指令）

`cmd` 为 `macro`，`steps` 按序执行；步骤设 `id` 后，后续步骤可用 `$id` 或 `$id.字段` 引用其结果。**返回结果的键是 `steps`**（⚠️ 不是 result/data，解析时注意）。任一步失败即中断（`stopOnError:false` 可关闭）。

```json
{
	"cmd": "macro",
	"instanceId": "<已核对的实例ID>",
	"params": {
		"steps": [
			{ "id": "u1", "cmd": "schematic.placeDevice", "params": { "lcscId": "C25804", "x": 200, "y": 200 } },
			{ "cmd": "schematic.connectPin", "params": { "primitiveId": "$u1.primitiveId", "pin": "VDD", "net": "3V3" } },
			{ "cmd": "schematic.save" }
		]
	}
}
```

149候选在148安装版失败现场上增加限定的旧资源名称观察：仅真实换封装且新旧关联、资源来源、PAD及几何全部核验通过时，允许缓存名精确等于已验证的旧实际资源名称，返回retained-previous-resource-name、previousResourceName及evidence.previousResource，不写源码修名。未知第三个名称仍拒绝。2026-10-14官方API整窗重开后的完整入口已实际触发该分支并通过；保存关闭重开与资源几何通过。图框动态时间读值和一条新属性首次保存zIndex调整单独记证据，不放宽通用比较。148安装版失败记录保留；149安装版复验待完成，PCB同步、制造及视觉显示验收未完成。

2026-10-14安装版149已在专用测试工程完成两批四器件正式指令验收：首批实际触发retained-previous-resource-name并成功；第二批反向切换、文本清空、数值和布尔均成功。保存、真实关闭到Start Page、重开后的值、持久ID、原有格式及三条导线保持；封装来源、完整可比几何与焊盘读回通过。本次新建Installed149Number（afb6ac7a27dfa1ca）和Installed149Boolean（512ffd2cf4f8c6d9）仅首次保存zIndex变化，专家限定认可；原严格比较false保留，不普遍放宽规则。测试页已关闭。148失败partial仍保留；PCB同步、制造及视觉显示未验收。149包按构建时内容保持原SHA，不重新打包同版本。
