# 连接、路由、坐标与激活

## 1. 健康检查与启动

首次安装：获取完整源码仓库，在包含 `package-lock.json` 的目录运行 `npm ci`，然后运行 `node bridge/command-proxy.mjs`。

要求 Node.js >=20.17.0，代理需要 `ws`。

不要只复制单个代理脚本，也不要使用 `npm ci --omit=dev`。

默认地址为 `http://127.0.0.1:49720`。本技能可独立安装，不依赖作者本机的其他技能或调试网关。

EDA 中须启用扩展并允许外部交互，配套指令代理须运行。SMT 物料查询由代理本地执行，不要求 EDA 在线。

发往 EDA 的命令先查询 `GET /connections`，核对实例与工程。每条请求顶层带 `cmd`、`instanceId` 和可选 `params`；`/select` 不能代替请求路由。同一窗口只由一个写入者操作。

用 `project.getInfo` 获取文档 UUID，用 `editor.openDocument` 激活目标。参数以所选窗口对应版本的 `GET /help?cmd=<命令名>` 为准；不猜参数或自行编写 `eda.*`。

实例显示 `paused:true` 时，由使用者在 EDA 菜单恢复连接，不自行绕过暂停。

下面 curl 示例使用 Bash 语法。

Windows PowerShell 用户使用 `Invoke-RestMethod`，完整步骤在仓库安装指南。

```bash
curl http://127.0.0.1:49720/health
curl http://127.0.0.1:49720/connections
```

### 1a. 代理未运行

连接拒绝时，在已安装依赖的仓库目录启动 `node bridge/command-proxy.mjs`，或 Windows 的 `bridge/launch-proxy.bat`。

保留进程并核对健康响应。

默认手动启动。

仓库提供 `bridge/install-url-scheme.ps1` 与 `bridge/uninstall-url-scheme.ps1` 注册/注销 `ai-command-proxy://` 协议。

自动启动入口为 `ai-command-proxy://start`。

注册只提供启动入口，不代表代理已经启动。

启动仍依赖已安装依赖及明确启动动作，不能把等待自动恢复当成首次安装步骤。

所有实例断开后代理默认 300 秒退出。

`PROXY_IDLE_MS=0` 可用于需要常驻的本机配置。

启动器须检查健康响应中的 `ok`、`service` 与 `lifecycleProtocol=1`。

旧版或其他服务应拒绝，不自动停止或重启现有服务。

重连后重新查询实例，不猜测 ID 是否改变。

普通用户保持默认 49720。

只设代理 `PORT` 不会同步修改插件、启动器和 Python 助手的目标地址。

### 1b. 有代理但无实例

确认 EDA 已打开工程，插件已启用且允许外部交互。

需要时点击 AI Command → 连接指令代理。

若用户曾点击断开菜单暂停该实例，必须由用户点击连接恢复，AI 不绕过暂停。

## 2. 核对窗口

`GET /connections` 返回实例、版本、工程信息与暂停状态。

按用户指定工程核对目标。

工程名或身份仍有歧义时先澄清，不自动选最新版本、最新连接或第一项。

每个完整 `/command` 请求都带顶层 `instanceId`，单窗口也一样。

`POST /select` 是全局选择，不替代请求级路由。

`/help` 等发现接口使用全局所选实例，其能力未必等于你的目标版本，核对版本后再使用。

同一窗口焦点共享。

不同 AI 不并发修改同一个窗口。

重装、重连或离线后重新查询并核对目标，未知实例不会改投其他窗口。

## 4. 查询指令能力

```bash
curl 'http://127.0.0.1:49720/help?cmd=schematic.placeDevice'
curl http://127.0.0.1:49720/help
```

参数拿不准先查目标版本手册和在线帮助，不猜参数。

分类指令表主要描述 `params`，不是省略实例 ID 的许可。

## 6. 坐标与单位（⚠️ 极易混淆）

| 画布 | 单位 | Y 轴 | 有效范围 |
| --- | --- | --- | --- |
| 原理图/符号 | **10mil**（1 单位 = 10mil） | +Y 向上 | 先查图框：A4 约 1170×825 单位，建议留 50 边距 |
| PCB/封装 | **mil**（1mm ≈ 39.37mil） | +Y 向上 | 以板框为准 |

- ⚠️ 两者相差 10 倍，混用会把图元放到十万八千里外。
- 原理图网格吸附按当前图页设置。
- 坐标单位为10mil，不把固定5或10倍数作为指令限制。
- 格点是否合规由当前DRC规则判断。
- **图纸尺寸查询**：原理图用 `schematic.getPageInfo`（返回 titleBlock 的 `width`/`height`，单位 10mil。
- A4 = 1170×825，A3 = 1630×1150 左右，以实际读取为准）。
- PCB 板框尺寸用 `pcb.getPrimitivesInRegion` 扫全板找 Region 图元换算，或截图比对。
- 图框尺寸不是定值：先 `schematic.getPageInfo` 读 `width`/`height` 再放器件。
- 原理图坐标的正Y方向向上。
- 矩形锚点是左上角(minX,maxY)。
- 传入的y表示矩形上沿。
- height沿Y减小方向延伸。
- 做布局换算时不要把屏幕坐标（向下为正）直接当世界坐标用。
- `listRects`/`checkRectOverlap`（0.9.4 起）返回归一化 `span:{x1,y1,x2,y2}`，一律用 span 计算。
- **图纸/图框切换（0.9.4 起明确）**：`project.modifyTitleBlock` 只能改当前图框**已存在**的字段（先 `schematic.getPageInfo` 看 titleBlockData 有哪些键）。
- 传不存在的键官方抛 TypeError。
- Page Size和Symbol不能通过该接口切换纸张。
- 用户须在EDA界面修改纸张。
- 修改后用`getPageInfo`的width和height核对尺寸。
- size或Symbol可能仍显示旧文本。
- 层：`"top"` / `"bottom"`。

## 7. 文档激活（⚠️ 0.8.2 起有类型守卫）

任何 `schematic.*` / `pcb.*` 指令前，必须先激活对应类型文档：

```json
{ "cmd": "editor.openDocument", "instanceId": "<已核对的实例ID>", "params": { "uuid": "<图页或PCB的uuid>" } }
```

- 原理图页 uuid 从 `project.listSchematicPages` 获取，其他文档从 `project.getInfo` 的文档树核对。
- 激活后在页级指令中携带 `params.__docUuid` 核对，不能只检查类型。
- ⚠️ 焦点不对时指令会明确报错（这是守卫，不是 bug），重新 openDocument 即可。

## 3. 发送完整请求

将占位符替换为刚核对的实例 ID：

```bash
curl -X POST http://127.0.0.1:49720/command -H 'Content-Type: application/json' -d '{"cmd":"project.getInfo","instanceId":"<已核对的实例ID>","params":{}}'
```

顶层是 `cmd`、`instanceId`、可选 `params`。

当前代理对发往 EDA 的缺 ID 请求直接拒绝，不会落到全局选中实例。

成功返回 `ok:true`。

失败可能为 HTTP 错误，也可能 HTTP 200 但 `ok:false`，必须检查返回体。

遇到 `UNKNOWN_INSTANCE` / `TARGET_OFFLINE`，重新查询连接并核对身份。

不要通过重选别的工程来消除报错。

宏仅在外层带 `instanceId`，`params.steps` 中的子命令继承同一实例，不各自路由。

## 8. 其他编辑器操作

| 指令 | 作用 | 使用时机 | 用法 | 限制 |
| --- | --- | --- | --- | --- |
| `editor.listTabs` | 列出当前窗口页签。 | 选择或确认文档页签时。 | 无 | 页签ID应从本窗口实际返回取得。 |
| `editor.screenshot` | 截取当前编辑器视口。 | 需要查看当前画布外观时。 | `zoomToAll?`, `tabId?` | 后台窗口可能返回旧缓存帧。 |
| `schematic.exportPng` | **视觉验收首选**（独立渲染管线，窗口后台也出全图。<br>返回**全部原理图页打包成 ZIP** 的 base64——PK 开头，先解 ZIP 再读每页 PNG） | 备份、交付或独立检查时使用。 | 无 | 单边尺寸不超过4096px。 |
| `editor.zoomToAll` | 缩放至全部图元。 | 需要查看整体布局时。 | `tabId?` | 缩放成功不证明后台画布已重绘。 |
| `editor.zoomToRegion` | 缩放至指定区域。 | 需要查看局部内容时。 | `left/right/top/bottom`, `tabId?` | 坐标单位取决于当前文档。 |
| `editor.closeDocument` | 关闭指定页签并检查结果。 | 已完成保存且需要关闭页面时。 | `uuid?`, `tabId?` | 未知页签状态不能当作已关闭。 |

- **区域截图**（无原生指令，两步 macro 等效）：`zoomToRegion` 对准区域 → `screenshot` 截视口。

```json
{
	"cmd": "macro",
	"instanceId": "<已核对的实例ID>",
	"params": {
		"steps": [
			{ "cmd": "editor.zoomToRegion", "params": { "left": 100, "right": 200, "top": 200, "bottom": 100 } },
			{ "cmd": "editor.screenshot", "params": {} }
		]
	}
}
```

100和200是演示坐标。
使用前替换为目标区域。

left<right、top>bottom，Y 向上取大值。

截图结果在macro返回的steps[1].base64中。

## 5. 超时、进度与写保护

默认等待为 300 秒。

部分长命令通过进度心跳延长等待，外层熔断、宿主异常仍可能失败，不能承诺永不超时。

超时不等于取消。

对有 taskId 的长任务用 `task.get` 查结果，必要时 `task.list` 找任务，再只读核对现场。

普通写不一定登记任务表，不能把任务表为空当作旧写已结束。

0.10.73 写结果不确定时进入实例写保护，入队和出队都检查。

期间读可继续，写被拒。

只有对应指令的可信迟到结果，或确认旧写状态后的显式 `write.acknowledge` 才能解除。

不能自动解除、靠等待解除，或将长任务去重推广为所有命令都可以原样重发。

写指令按窗口排队。

`editor.openDocument/closeDocument` 也会排队，宏整体占一条通道。

排队不保证宿主操作成功，始终检查逐项结果与读回。

日志在代理目录的 `lane-log-*.jsonl`，写盘异常另见 `lane-log-error.txt`。

更多处置见 [pitfalls](pitfalls.md)。

## 冷启动与开发调试连接排查

已安装宿主的 HTTP 转发层可能将 `127.0.0.1` 拒绝连接包装成 HTTP 500 JSON，导致扩展把未运行的桥接当成不兼容服务、跳过启动。

扩展内部健康探测使用`http://localhost:49720/health`。
该地址用于宿主直接请求路径。

WebSocket、监听地址和 Windows 启动器不变。

真实异服务/旧服务仍拒绝，不因 HTTP 500 盲目新起进程。

当前宿主的完整冷启动须单独验证。
手动启动成功不能证明冷启动通过。

若提示“WebSocket 调试模式连接重试已达最大次数”或要求 `npm run dev`，这是宿主扩展开发调试连接，与 AI Command 的桥接重连不是同一条链。

正常使用安装包不需要启动开发服务器。

不要靠启动无关调试服务来掩盖桥接故障。
