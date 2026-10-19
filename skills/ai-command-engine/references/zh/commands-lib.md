# 器件库

# 符号/封装/器件库管理指令（lib.*）

> 本页表格保留选用场景和限制；参数、返回字段与示例以已核对所选窗口版本的 `/help?cmd=<命令名>` 为准。
> 发送 `/command` 时外层必须带 `cmd`、顶层 `instanceId` 和所需 `params`。
> 宏仅外层路由，步骤继承实例。
> 完整示例见 [setup](setup.md)。

lib命令用于维护个人库和系统库资源。

官方默认搜系统库，**本组指令默认个人库**（libraryUuid 留空=个人库）。

## 1. 工程内选料

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `library.searchDevice` | 搜索器件库（立创商城料） | 选料或核对库资源时使用。 | 按目标实例帮助确认可用参数。 |
| `library.getDeviceByLcsc` | 按立创编号查器件 | 选料或核对库资源时使用。 | 按目标实例帮助确认可用参数。 |

普通放置优先查询已有器件。
自建库操作不等于已经放入工程。

## 2. 建立或维护自有库资源

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `lib.symbolCreate` | 建空白符号 | 维护自建库资源时使用。 | 写入未知时停止后续写入。 |
| `lib.symbolUpdateSource` | 符号文档源码写回库 | 维护自建库资源时使用。 | 写前保存原始内容。 |
| `lib.symbolSearch` / `symbolGet` / `symbolCopy` / `symbolModify` / `symbolDelete` | 查询、读取、复制、修改或删除符号。 | 查询或维护同类库资源时使用。 | 修改后UUID可能变化。 |
| `lib.footprintCreate` / `footprintUpdateSource` / `footprintSearch` / `footprintGet` / `footprintCopy` / `footprintModify` / `footprintDelete` | 创建、读写、查询、复制、修改或删除封装。 | 查询或维护同类库资源时使用。 | 修改后UUID可能变化。 |
| `lib.footprintGetSource` | 直接读取库封装原始源码，用于封装内容分析或格式问题定位。<br>不打开编辑器、不修改库 | 选料或核对库资源时使用。 | 按目标实例帮助确认可用参数。 |
| `lib.deviceCreate` | 组装库器件：绑定已有符号，或新建空符号，再关联封装及3D | 维护自建库资源时使用。 | 写入未知时停止后续写入。 |
| `lib.deviceSearch` / `deviceGet` / `deviceGetByLcscIds` / `deviceCopy` / `deviceModify` / `deviceDelete` | 查询、读取、复制、修改或删除库器件。 | 查询或维护同类库资源时使用。 | 修改后UUID可能变化。 |
| `lib.symbolOpenInEditor` / `lib.footprintOpenInEditor` | 在符号/封装编辑器中打开库元件（编辑内容用。<br>打开后配合 project.getDocumentSource 读源码） | 查询或维护同类库资源时使用。 | 官方未返回有效页签 ID 时明确报失败；系统库资源可能被宿主拒绝打开，需另查原因。 |

符号、封装和器件使用相同的操作分类。

v0.20.29 候选中，`lib.deviceCreate` 在写入前读取显式提供的 3D 模型，核对模型 UUID 和库 UUID；缺省模型库使用器件库。模型不可读、身份不符或接口不支持核对时明确失败，不创建器件。此路径尚待新版宿主验收。

`lib.symbolOpenInEditor` 和 `lib.footprintOpenInEditor` 遇到精确的 `[object Object]` SDK 错误时补充目标信息并保留原 cause；不据此断言资源不存在。此新增提示尚待新版宿主验收。

- Create创建空白资源并返回UUID。
- UpdateSource把文档源码写回库。
- Search按关键字、分类和分页查询。
- key为空时列出全部资源。
- classification限定分类。
- `page`指定页码，须为正整数，省略时为1。
- `itemsOfPage`指定每页数量，须为正整数，省略时为20。
- Get读取指定资源。
- `lib.footprintGet` 遇到官方返回 `[object Object]` 时，会提示错误原因不可判定并保留原异常。不要把该提示当成“封装不存在”的证明。
- Copy把资源复制到目标库。
- Modify修改资源属性。
- `lib.symbolModify` 写前核对符号 UUID 和库 UUID；省略 `name` 时保留原名称及大小写。SDK 修改返回成功后，以新鲜 `get` 读回逐项比较请求值和非请求属性；UUID 改变时搜索唯一候选并再读回。核对字段包括 `name`、`description`、`classification`、`type`、`libraryType`、`cbbUuid`、`subPartNames`、`otherProperty`，并确认库身份。若不一致，抛出操作失败并在 `cause` 保留 `partial:true`、`retryable:false`、`sdkModified:true`、`before`、`after`、`differences`、`candidateUuid`、`uuid`、`verify`；不要补写或自动重试。宏会因 `partial:true` 停止后续步骤，即使 `stopOnError:false`。A02 的 v0.20.33 宿主测试通过：仅修改临时符号的 `description`，新鲜 `get` 确认原 `name` 大小写及所有非请求字段保持。此结果只覆盖该修改形态，不代表其他属性组合均已验收。
- Delete删除指定资源。
- Copy必须提供targetLibraryUuid。
- 目标库重名时复制可能失败。
- Modify把属性设为null时会清除该属性。

Search 返回 `[{uuid, name, description, ...}]`。

特例：

- `lib.deviceCreate` 用于把符号和封装绑定成库器件。
- 跨库时分别提供 `symbolLibraryUuid` 和 `footprintLibraryUuid`，省略时使用创建器件的 `libraryUuid`。
- 例如 `{"libraryUuid":"目标库UUID","name":"测试电阻","symbolUuid":"符号UUID","symbolLibraryUuid":"符号库UUID","footprintUuid":"封装UUID","footprintLibraryUuid":"封装库UUID"}`。
- 新建普通空符号可传`symbolType:2`，此时无需`symbolUuid`。
- 该分支的可用性以当前安装版帮助和读回为准。
- 创建后优先`get`读回。
- 工程库不支持该查询时，按名称搜索并匹配创建返回的UUID读回，不会再次创建。
- 134已证明跨库资源可以进入工程，但旧版末尾`get`会误报。
- 创建成功不能代替完整回执和资源核对。

- `lib.deviceGetByLcscIds`：`lcscIds` 支持单值或数组批量查（如 "C1523" 或 ["C1523","C17168"]）。
- `allowMultiMatch?` 同 C 号多匹配时全返回。
- v0.20.28 增加 `diagnostic?: boolean`，默认关闭；EDA 4.1.78 的一次宿主查询已确认诊断输出生效，历史身份异常本次未复现。
- `diagnostic:true` 成功时返回 `{ result, diagnostic }`；`result` 是未筛选的 SDK 返回，诊断包含实际三个参数的调用前快照和调用起止 UTC 时间。
- 诊断只调用一次 SDK，不重试；返回空或抛错仍按原错误处理，可能没有诊断信息。
- EDA 4.1.78 曾出现请求库 A 却返回库 B；`ok=true` 不能证明库身份一致，诊断结果不能直接作为放置或复制的身份验收。
- ⚠️ 私有化部署环境不可用。
- `lib.deviceModify` 支持改绑：`symbolUuid`/`footprintUuid` 换绑，`property` 改 designator/manufacturer/supplier 等。

⚠️ 要点：

- 普通放置别走这里：从立创商城选料用 `library.searchDevice`/`library.getDeviceByLcsc`（工程内放置）。
- 本组管的是**自建库元件**的沉淀与维护。
1. 用symbolCreate创建符号。
2. 在编辑器绘制符号。
3. 用symbolUpdateSource写回符号内容。
4. 按相同流程创建封装。
5. 用deviceCreate绑定符号和封装。
6. 用`library.searchDevice`查询绑定后的器件。
