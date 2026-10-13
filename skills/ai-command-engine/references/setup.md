# Connections, routing, coordinates, and document activation

## 1. Health check and startup

For the first installation, obtain the complete source repository, run `npm ci` in the directory containing `package-lock.json`, then run `node bridge/command-proxy.mjs`. Node.js >=20.17.0 is required, and the proxy needs `ws`. Do not copy only the proxy script or use `npm ci --omit=dev`.

The default address is `http://127.0.0.1:49720`. The curl examples below use Bash syntax. Windows PowerShell users should use `Invoke-RestMethod`; the full steps are in the repository installation guide.

```bash
curl http://127.0.0.1:49720/health
curl http://127.0.0.1:49720/connections
```

### 1a. Proxy is not running

If the connection is refused, start `node bridge/command-proxy.mjs` in the repository directory with dependencies installed, or run `bridge/launch-proxy.bat` on Windows. Keep the process running and verify the health response.

Startup is manual by default. The repository includes `bridge/install-url-scheme.ps1` and `bridge/uninstall-url-scheme.ps1` to register/unregister the `ai-command-proxy://` protocol. Its automatic-start entry is `ai-command-proxy://start`. Registration only provides a startup entry point; it does not mean the proxy has started. Startup still requires installed dependencies and an explicit start action. Do not treat waiting for automatic recovery as a first-installation step.

After all instances disconnect, the proxy exits after 300 seconds by default. `PROXY_IDLE_MS=0` can be used for a local setup that must stay running. A launcher must check `ok`, `service`, and `lifecycleProtocol=1` in the health response. It must reject an older version or another service, and must not automatically stop or restart an existing service. After reconnecting, query instances again; do not guess whether their IDs changed.

Ordinary users should keep the default port 49720. Setting only the proxy's `PORT` does not update the target address in the extension, launcher, or Python helper.

### 1b. Proxy is running but has no instances

Confirm that EDA is open with a project, the extension is enabled, and external interaction is allowed. If needed, choose **AI Command → 连接指令代理 (Connect Command Proxy)**. If the user previously paused the instance from the disconnect menu, the user must choose connect to resume it. AI must not bypass the pause.

## 2. Identify the target window

`GET /connections` returns the instance, version, project information, and paused state. Match the target to the project specified by the user. If the project name or identity is still ambiguous, clarify first; do not automatically choose the newest version, most recent connection, or first item.

Every complete `/command` request must include the top-level `instanceId`, even when only one window is open. `POST /select` changes a global selection and does not replace request-level routing. Discovery endpoints such as `/help` use the globally selected instance, so their capabilities may not match the target version. Check the version before relying on them.

Windows share focus within a window. Different AIs must not edit the same window concurrently. After reinstalling, reconnecting, or coming back online, query and verify the target again. An unknown instance is not redirected to another window.

## 3. Send a complete request

Replace the placeholder with the instance ID you just verified:

```bash
curl -X POST http://127.0.0.1:49720/command -H 'Content-Type: application/json' -d '{"cmd":"project.getInfo","instanceId":"<verified-instance-ID>","params":{}}'
```

The top-level keys are `cmd`, `instanceId`, and optional `params`. The current proxy directly rejects requests to EDA that omit the ID; they do not fall through to the globally selected instance. Success returns `ok:true`. Failure may be an HTTP error or HTTP 200 with `ok:false`, so always inspect the response body.

For `UNKNOWN_INSTANCE` or `TARGET_OFFLINE`, query connections again and verify the identity. Do not clear the error by selecting a different project. A macro carries `instanceId` only on the outer request; child commands in `params.steps` inherit the same instance and are not routed individually.

## 4. Discover command capabilities

```bash
curl 'http://127.0.0.1:49720/help?cmd=schematic.placeDevice'
curl http://127.0.0.1:49720/help
```

If unsure about parameters, check the target version's manual and online help first. Do not guess parameters. Command tables describe `params`; they do not authorize omitting the instance ID.

## 5. Timeouts, progress, and write protection

The default wait is 300 seconds. Some long commands extend the wait through progress heartbeats, but an outer circuit breaker or host failure can still cause an error. Never promise that a command cannot time out.

A timeout does not mean cancellation. For a long task with a `taskId`, use `task.get` to check its result and, if necessary, `task.list` to locate it. Then verify the state with read-only commands. Ordinary writes may not be recorded in the task table; an empty task table does not mean an earlier write has finished.

Since 0.10.73, when a write result is uncertain the instance enters write protection. The proxy checks both before enqueueing and before dequeueing. Reads may continue, but writes are rejected. Protection can be cleared only by a trusted late result for that command or an explicit `write.acknowledge` after confirming the old write's state. Do not clear it automatically or by waiting. Do not generalize long-task deduplication into permission to resend every command unchanged.

Writes are queued by window. `editor.openDocument` and `editor.closeDocument` are queued too; a macro occupies one channel for its entire run. Queuing does not guarantee that the host operation succeeded. Always check per-item results and readback. Logs are in the proxy directory as `lane-log-*.jsonl`; disk-write errors are also recorded in `lane-log-error.txt`. See [pitfalls](pitfalls.md) for more handling details.

## 6. Coordinates and units (⚠️ easy to confuse)

| Canvas | Unit | Y axis | Valid range |
| --- | --- | --- | --- |
| Schematic/symbol | **10 mil** (1 unit = 10 mil) | +Y points up | Check the sheet frame first. A4 is about 1170 × 825 units; leave a margin of 50. |
| PCB/footprint | **mil** (1 mm ≈ 39.37 mil) | +Y points up | Use the board outline as the limit. |

- ⚠️ The units differ by a factor of 10. Mixing them can place objects extremely far away.
- Schematic grid snapping: coordinates should be **multiples of 10**. Otherwise DRC may report “网络图元不在原理图格点上” (schematic primitive is not on the schematic grid).
- **Read sheet dimensions:** For schematics, use `schematic.getPageInfo` (it returns `width` and `height` in `titleBlock`, in 10 mil units; A4 is 1170 × 825 and A3 about 1630 × 1150, subject to actual readback). For PCB outline dimensions, scan the whole board with `pcb.getPrimitivesInRegion` to find Region primitives and convert their dimensions, or compare against a screenshot.
- Sheet-frame dimensions are not fixed. Read `width` and `height` with `schematic.getPageInfo` before placing components.
- ⚠️ **Rectangle “top-left corner”:** Schematic +Y points up. The official rectangle anchor is the world-coordinate top-left point `(minX, maxY)`. The supplied `y` is the rectangle's **top edge**; the rectangle extends downward (toward smaller Y) by `height`. Do not use screen coordinates, where Y points down, as world coordinates. Since 0.9.4, `listRects` and `checkRectOverlap` return normalized `span:{x1,y1,x2,y2}`; always use `span` for calculations.
- **Changing the sheet/frame (clarified in 0.9.4):** `project.modifyTitleBlock` can change only fields that already exist in the current title block. First check the keys in `titleBlockData` from `schematic.getPageInfo`; the official API throws a TypeError for a missing key. **Page Size / Symbol cannot be changed through this interface.** The user must change the sheet in the EDA UI. After the change, `getPageInfo` may show new `width`/`height` while the size/Symbol fields still show old values; trust `width`/`height`.
- Layers: `"top"` / `"bottom"`.

## 7. Activate the document (⚠️ type guard since 0.8.2)

Before any `schematic.*` or `pcb.*` command, activate a document of the matching type:

```json
{ "cmd": "editor.openDocument", "instanceId": "<verified-instance-ID>", "params": { "uuid": "<schematic-page-or-PCB-uuid>" } }
```

- Get a schematic-page UUID from `project.listSchematicPages`; verify other documents in the document tree returned by `project.getInfo`. After activation, include `params.__docUuid` in page-level commands as a check; do not check only the document type.
- ⚠️ If focus is wrong, the command reports an explicit error. This is a guard, not a bug; call `openDocument` again.

## 8. Other editor operations

| Command | Description | Key parameters |
| --- | --- | --- |
| `editor.listTabs` | List all open tabs (troubleshoot “wrong canvas was edited”) | None |
| `editor.screenshot` | Capture a screenshot (⚠️ use `zoomToAll:true` for the full drawing; otherwise only the current viewport is captured. **When the window is in the background, this captures a cached frame.** Identical bytes in consecutive captures mean it did not redraw; do not use this for acceptance. See pitfalls K9.) | `zoomToAll?`, `tabId?` |
| `schematic.exportPng` | **Preferred for visual acceptance** (independent render pipeline; returns the full drawing even when the window is in the background. The base64 contains a ZIP of **all schematic pages** and starts with PK; unzip it to read each page's PNG.) | None |
| `editor.zoomToAll` | Zoom to all primitives | `tabId?` |
| `editor.zoomToRegion` | Zoom to a region (coordinates use document units: schematic 10 mil; PCB mil) | `left/right/top/bottom`, `tabId?` |
| `editor.closeDocument` | Close a specified document tab | `uuid?`, `tabId?` |

- **Capture a region** (no native command; a two-step macro has the same effect): use `zoomToRegion` to frame the area, then `screenshot` to capture the viewport.

```json
{
	"cmd": "macro",
	"instanceId": "<verified-instance-ID>",
	"params": {
		"steps": [
			{ "cmd": "editor.zoomToRegion", "params": { "left": 100, "right": 200, "top": 200, "bottom": 100 } },
			{ "cmd": "editor.screenshot", "params": {} }
		]
	}
}
```

(100/200 are example coordinates; replace them with the target region. `left<right`, `top>bottom`, with larger Y values toward the top. Screenshot data is base64 in `steps[1]` of the macro response.)

## Cold-start fix in 0.10.88 (host acceptance pending)

The HTTP forwarding layer in an installed host may wrap a refused connection to `127.0.0.1` as HTTP 500 JSON. This caused the extension to mistake a stopped bridge for an incompatible service and skip startup. In 0.10.88, only the extension's internal health probe changed to `http://localhost:49720/health`, using the host's direct request path for that address. WebSocket, listen address, and Windows launcher are unchanged. A real unrelated service or old service is still rejected; an HTTP 500 alone does not start another process. Verify how localhost resolves inside the current host and test a full cold start with the installed build. A successful manual start does not count as a cold-start pass.

If you see “WebSocket debug mode connection retry reached maximum” or a request to run `npm run dev`, that concerns the host extension's development/debug connection. It is separate from reconnecting the AI Command bridge. The installed extension package does not require a development server; do not hide a bridge problem by starting an unrelated debug service.
