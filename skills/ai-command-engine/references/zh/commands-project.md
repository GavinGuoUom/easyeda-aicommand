# 工程与图页

# 工程与板子管理指令（project.*）

> 本页表格保留选用场景和限制；参数、返回字段与示例以已核对所选窗口版本的 `/help?cmd=<命令名>` 为准。
> 发送 `/command` 时外层必须带 `cmd`、顶层 `instanceId` 和所需 `params`。
> 宏仅外层路由，步骤继承实例。
> 完整示例见 [setup](setup.md)。

工程/板子/图页的创建、复制、删除、关联。

文档树 uuid 一律从 `project.getInfo` 读，不猜。

## 按团队核对工程

`project.list` 的 `teamUuid` 为可选非空字符串，提供时原样传给 SDK。`detail` 须为布尔值，省略时为 false。

省略时沿用宿主默认查询范围。

返回工程 UUID 数组。

`detail:true` 时按顺序返回 `{ uuid, info }` 数组。

宿主返回 undefined、null、非数组或含非字符串、空字符串项的列表时明确报错，不当作“没有工程”。

工程 ID 按宿主字符串保留，不额外猜测格式。

真实空数组仍返回 `[]`，但需用同团队已知工程作对照。

不能只凭空列表认定此前导入未发生。

此命令只读，不解除未知写入保护，也不自动重试导入。

```json
{"instanceId":"当前核实的窗口 ID","cmd":"project.list","params":{"teamUuid":"导入结果中记录的目标团队 UUID","detail":true}}
```

## 工程级

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `project.getInfo` | 当前工程信息（名称+文档树 uuid） | 操作前确认当前工程时使用。 | 按目标实例帮助确认可用参数。 |
| `project.getInfoOf` | 指定工程信息 | 核对指定工程的文档树时使用。 | 按目标实例帮助确认可用参数。 |
| `project.list` | 工程列表。<br>可指定团队（`detail:true` 逐个查信息，较慢） | 查找目标团队工程时使用。 | 按目标实例帮助确认可用参数。 |
| `project.create` | 新建工程 | 开始一个独立工程时使用。 | 写入未知时停止后续写入。 |
| `project.open` | 打开指定工程并切换当前工程。SDK 声明可能直接丢失旧工程未保存的数据；不能把返回失败当作未保存保护。 | 当前工程内容已确认保存，或用户明确允许丢弃未保存内容时使用。 | 恢复未确认或需保留未保存现场时不要调用。目标不存在或无权限会在调用 openProject 前拒绝，但合法目标不具备未保存保护。 |
| `project.moveToFolder` | 移动工程到文件夹（留空=根目录） | 整理工程所属目录时使用。 | 写入未知时停止后续写入。 |
| `project.exportFile` | 导出 .epro/.epro2（base64 自行落盘做备份/迁移） | 备份、交付或独立检查时使用。 | 需要工程管理中的“下载工程”权限；`fileType` 仅接受 epro 或 epro2，省略时为 epro；导出成功不等于内容验收通过。 |
| `project.importFile` | 导入外部文件成新工程。<br>.PcbDoc/.SchDoc/.epro/.epro2 等可推断 fileType。<br>`newProjectName` 设置新工程显示名。 | 接收外部设计或同步内容时使用。 | 在线 .epro2 省略新名时从可靠根元数据 title 派生；名称派生与描述保留已在 EDA 4.1.78 的限定样例通过。无法可靠取名或重名时要求显式名称；空返回或异常按未知结果处理，不重发。 |
| `project.getDocumentSource` | 读当前激活文档源数据 JSON（只读整体分析，比逐个查图元快） | 只读核对文档有效记录时使用。 | 源码坐标不能直接当作公开API坐标。 |
| `project.modifyTitleBlock` | 改标题栏（⚠️ data 键必须是图框已存在字段，先 getPageInfo 查 titleBlockData。<br>Page Size/Symbol 不能接口切换） | 更新现有图框字段时使用。 | 只改已有字段，不切换纸张。 |

## 板子（Board）与关联

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `project.getBoardInfo` | 当前板子信息与原理图/PCB 关联状态。<br>`pcb.importChanges` 报导入失败时用它排查游离 PCB | 核对或建立原理图与PCB关联时使用。 | 按目标实例帮助确认可用参数。 |
| `project.associateBoard` | 关联原理图+PCB 到板子（修复游离 PCB） | 核对或建立原理图与PCB关联时使用。 | 写入未知时停止后续写入。 |
| `project.copyBoard` | 复制板子 | 复用已有设计内容时使用。 | 写入未知时停止后续写入。 |
| `project.deleteBoard` | 删除指定板子。<br>官方返回失败时附带当前目标信息，不自动重试 | 清理已核对的目标内容时使用。 | 先核对目标并备份。 |
| `project.renameBoard` | 重命名板子（⚠️ 按名字匹配，重名会改错——先 getBoardInfo 确认） | 修改明确目标板名时使用。 | 写入未知时停止后续写入。 |

## 原理图与图页

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `project.createSchematic` | 新建原理图（`boardName` 必须是已存在板子名。<br>新建省略后用 associateBoard 关联） | 为工程增加原理图时使用。 | boardName若提供，必须是已有板名。 |
| `project.createSchematicPage` | 指定原理图下新建图页（uuid 是 Schematic 节点，非图页） | 为已有原理图增加图页时使用。 | schematicUuid必须指向父原理图，不是图页。 |
| `project.deleteSchematicPage` | 删图页 | 清理已核对的目标内容时使用。 | 先核对目标并备份。 |
| `project.copySchematicPage` | 复制图页 | 复用已有设计内容时使用。 | 写入未知时停止后续写入。 |
| `project.renameSchematicPage` | 按 UUID 改图页名 | 整理图页名称和顺序时使用。 | 先在本窗口激活目标并保存一次。 |
| `project.listSchematicPages` | 列全部图页 | 选择或核对原理图图页时使用。 | 按目标实例帮助确认可用参数。 |
| `project.reorderSchematicPages` | 调图页顺序（⚠️ 须包含全部图页） | 整理图页名称和顺序时使用。 | 必须提供全部图页UUID。 |

### `project.copySchematicPage`：补充说明

- 省略目标schematicUuid时复制到同一原理图。
- 0.10.37 起复制后读回验证，返回 name/parentSchematicUuid/sourcePageUuid，归属异常带 warning。
- 新页名可能按“源名_N”自动生成。
- 若 SDK 未返回可接受的新 UUID，失败的 `error.cause` 可包含 `sdkResultType`、安全的 `sdkResultValue` 和 `sdkResultIsSourceUuid`。诊断区分 `null`、`undefined`、标量及其他类型，不递归检查对象，也不调用其 `toJSON` 或 `toString`。
- 此诊断不改变 UUID 接受规则或单次调用；失败仍返回 `partial:true` / `retryable:false`，不重试、不保存、不回退。它只补充失败证据，不表示 SDK 复制或 UUID 持久性已修复。0.20.49 独立窗口的一次二代复制已确认 SDK 返回 undefined；此前两次失败当时未记录原始值。失败后观察时点的64份文档及元数据保持，不证明失败原子性或无延迟副作用。旧 UID 变化及偶发失败根因仍未知，不能据此推断版本回归。

### `project.renameSchematicPage`：补充说明

- 按 UUID 改图页名（0.10.59 加固：改名前后快照比对，renamed 只信快照）。
- ⚠️ 目标页**须在本窗口打开激活、且所在文档在本窗口 save 过一次**，否则官方假失败。
- 旧宿主曾出现跨窗口旧页改名失败。
- 该样本在本窗口新页成功改名后恢复。
- 不把该历史现象当作所有窗口的固定前置条件。

## PCB

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `project.createPcb` | 新建 PCB（boardName若提供，必须是已有板名） | 为工程增加PCB时使用。 | boardName若提供，必须是已有板名。 |
| `project.copyPcb` | 复制 PCB。<br>`boardName` 是副本归属的目标 Board 名称，不是副本名称 | 复用已有设计内容时使用。 | 不传boardName时创建游离PCB。 |
| `project.deletePcb` | 删除 PCB | 清理已核对的目标内容时使用。 | 先核对目标并备份。 |
| `project.listPcbs` | 列全部 PCB | 选择或核对PCB文档时使用。 | 按目标实例帮助确认可用参数。 |

- **`project.copyPcb`**：省略 `boardName` 时创建游离 PCB。
- 不要求预先证明已有 Board 归属。
- 若指定不存在的 Board 名而 SDK 返回空，具体根因未知。
- SDK 空返回或抛错时结果未确认，插件以 `error.cause.partial=true` 返回并停止依赖宏步骤。
- 不自动重试。
- 先用 `project.getInfo` 与 `project.listPcbs` 只读核对。
- 成功返回以 `pcbUuid` 标识副本。
- 复制读回异常或保存重开后出现对象身份、几何或网络差异时，先停止并核实影响；不手工改 `Unique ID`，不自动重拷或生成网表。

```json
{
  "instanceId": "当前工程窗口 ID",
  "cmd": "project.copyPcb",
  "params": { "pcbUuid": "源 PCB UUID", "boardName": "副本归属的目标 Board 名" }
}
```

遇 `error.cause.partial=true` 时不要再次复制。

按上文只读核对结果处理。

## 工程导入结果不明

EDA 4.1.78 的导入 API 使用 `newProjectFriendlyName` 作为新工程显示名。

插件把 `newProjectName` 参数映射到该字段。

传入名称时，插件在调用前检查当前团队是否已有同名工程。

未指定名称时，普通归档导入沿用归档中的工程名称；应先确认不会与现有工程重名。v0.20.39 起对 `.epro2` 仅从归档根目录 `project2.json.title` 派生新工程名。无法可靠读取该标题或名称已重名时，要求显式提供 `newProjectName`；不从文件名推断、不追加后缀，也不覆盖已有工程。元数据名称派生已在 EDA 4.1.78 限定样例通过；其他格式及离线路径不据此判为通过。

v0.20.44 起描述透传仅适用于在线 JLCEDA Pro 的 `.epro2`：只从唯一、可靠解析为普通对象的根 `project2.json` 读取字符串 `description`，包括空串、空白和换行原样传入同一次 SDK 调用的 `saveTo.newProjectDescription`。名称派生仍按严格校验并 trim 后的 `title`；显式 `newProjectName` 时可选提取描述，坏 metadata 不新增导入前置拒绝。未增加用户参数，不做后置改写、重试或另行保存；超时按原期限错误传播，不吞超时。离线导入、其他格式、`introduction`、`tags` 和 Panel 行为均不变。本地检查及 EDA 4.1.78 的中文换行描述、名称派生、信息与归档双读回和工程重开已通过。空描述、显式名和坏元数据等其他宿主分支未据此全部验收；不承诺无损导入或已布线 PCB/POURED 持久性。

`project.importFile` 调用 SDK 后返回空、异常或无合法工程 UUID 时，报告 `partial:true`、`retryable:false`、`outcome:unknown`。

这表示导入结果不能确认，不表示没有创建工程。

先按错误中的目标名称和目录核对，禁止自动再导入。

调用前参数错误仍是普通拒绝。

成功返回也须另验工程内容。

## v0.20.39 起的项目操作保护

- 写入前核对目标类型、当前工程和目标 Board 槽位；目标不匹配时先拒绝，不调用 SDK 写入。
- 工程操作使用共享 SDK 总时限。超时不表示已取消已发出的调用；结果未明确前不启动依赖写入。
- 复制原理图图页或 PCB 后读回新对象身份及归属。SDK 返回 `false`、空值或结果未知时按失败或部分结果报告，不包装成外层成功，也不自动重发写入。
- 删除后从工程树读回确认目标已移除；移动工程时按请求的 UUID 核对移动前后位置。
- `project.getDocumentSource` 只读取当前激活文档，不提供 UUID 参数。焦点无效或文档身份无法确认时明确拒绝，不读取其他文档替代。
- 无活动文档及无效对象等8项拒绝已在 EDA 4.1.78 验证。有效空 Board 复制和一项图页复制保存重开已按限定样例通过；图页复制仍有失败及旧 UID 未解项。非根目录移动缺真实 folder UUID，离线目录仍未验证，不据此切换目录。
