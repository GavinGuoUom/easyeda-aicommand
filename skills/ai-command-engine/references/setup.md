# Connection, routing, coordinates, and activation

## First installation and startup

For first-time installation, obtain the full source repository, run `npm ci` in the directory containing `package-lock.json`, then run `node bridge/command-proxy.mjs`.

Node.js >=20.17.0 is required; the proxy requires `ws`.

Do not copy only a single proxy script or run `npm ci --omit=dev`.

The default address is `http://127.0.0.1:49720`. This skill can be installed independently; it does not depend on the author's other local skills or a debug gateway.

Enable the extension in EDA and allow external interaction. The companion command proxy must be running. SMT part lookup is performed locally by the proxy and does not require EDA to be online.

Before sending commands to EDA, query `GET /connections` and verify the instance and project. Every request has top-level `cmd`, `instanceId`, and optional `params`; `/select` does not replace request routing. Only one writer may operate on a window at a time.

Refresh the connection and verify the target before each request. Do not rely only on version, connection time, or `selected`. Explicitly reject an offline target; do not route it to another window. On failure, inspect `error.message`, `suggestion`, and partial-completion details.

Use `project.getInfo` on the explicitly verified instance to obtain document UUIDs and `editor.openDocument` to activate the target. Use `GET /help?cmd=<command-name>` or `__help` on the specified instance to check parameters. The target installation's help is authoritative. Do not guess parameters or invent `eda.*` commands.

If an instance shows `paused:true`, the user must resume the connection from the EDA menu. Do not bypass the pause.

The following `curl` examples use Bash syntax. Windows PowerShell users should use `Invoke-RestMethod`; full steps are in the repository installation guide.

```bash
curl http://127.0.0.1:49720/health
curl http://127.0.0.1:49720/connections
```

### 1a. Proxy is not running

When the connection is refused, start `node bridge/command-proxy.mjs` in the repository directory with dependencies installed, or use `bridge/launch-proxy.bat` on Windows.

Keep the process running and verify the health response.

Manual startup is the default.

The repository provides `bridge/install-url-scheme.ps1` and `bridge/uninstall-url-scheme.ps1` to register or unregister the `ai-command-proxy://` protocol.

The automatic startup entry point is `ai-command-proxy://start`.

Registration provides a startup entry point; it does not mean the proxy is already running.

Startup still requires installed dependencies and an explicit startup action. Waiting for automatic recovery is not a first-installation step.

By default, the proxy exits 300 seconds after all instances disconnect.

Set `PROXY_IDLE_MS=0` for a local setup that needs the proxy to remain running.

The launcher must check `ok`, `service`, and `lifecycleProtocol=1` in the health response.

Reject an older version or another service; do not automatically stop or restart an existing service.

After reconnecting, query instances again; do not assume the ID stayed the same.

Ordinary users should keep the default port, 49720.

Setting only the proxy's `PORT` does not also change the destination address used by the extension, launcher, or Python helper.

### 1b. Proxy is running but there are no instances

Confirm that EDA has a project open and that the extension is enabled with external interaction allowed.

If needed, click **AI Command → Connect Command Proxy**.

If the user paused the instance from the disconnect menu, the user must click Connect to resume it. AI must not bypass the pause.

## Verify the window

`GET /connections` returns instances, versions, project information, and pause status.

Verify the target against the project specified by the user.

If the project name or identity is still ambiguous, clarify first. Do not automatically choose the newest version, newest connection, or first item.

Every complete `/command` request includes top-level `instanceId`, even when there is only one window.

`POST /select` sets a global selection; it does not replace request-level routing.

Discovery endpoints such as `/help` use the globally selected instance. Its capabilities may differ from the target version; verify the version before using the results.

Windows share focus. Different AI agents must not modify the same window concurrently.

After reinstallation, reconnection, or offline time, query again and verify the target. An unknown instance is never rerouted to another window.

## Query command capabilities

```bash
curl 'http://127.0.0.1:49720/help?cmd=schematic.placeDevice'
curl http://127.0.0.1:49720/help
```

If unsure about parameters, check the target version's manual and online help. Do not guess.

Command category tables mainly describe `params`; they do not permit omitting the instance ID.

## Coordinates and units (⚠️ easy to confuse)

| Canvas | Unit | Y axis | Working range |
| --- | --- | --- | --- |
| Schematic/symbol | **10 mil** (1 unit = 10 mil) | +Y points up | Check the actual page dimensions first; A4 is about 1170 × 825 units |
| PCB/footprint | **mil** (1 mm ≈ 39.37 mil) | +Y points up | Use the actual board outline |

- ⚠️ The units differ by a factor of 10; mixing them can place primitives extremely far from the intended area.
- Schematic grid snapping follows the current page settings.
- The coordinate unit is 10 mil; do not impose a fixed multiple of 5 or 10 as a command restriction.
- The current DRC rules determine whether a point is on-grid.
- **Querying sheet size:** use `schematic.getPageInfo` for a schematic; `titleBlock.width` and `titleBlock.height` are in 10 mil. A4 is 1170 × 825; A3 is about 1630 × 1150. Use the actual returned values. A paper-size change is confirmed by dimensions, not by `size` or `Symbol` text.
- For PCB outline dimensions, scan the full board with `pcb.getPrimitivesInRegion` to find Region primitives and convert their bounds, or compare with a screenshot.
- Frame dimensions are not fixed. Read `width` and `height` from `schematic.getPageInfo` before placing components.
- Positive schematic Y points up.
- A rectangle's anchor is its top-left corner `(minX,maxY)`.
- The supplied `y` is the rectangle's top edge.
- `height` extends in the decreasing-Y direction.
- When converting layout coordinates, do not use screen coordinates (positive Y downward) directly as world coordinates.
- Since 0.9.4, `listRects` and `checkRectOverlap` return normalized `span:{x1,y1,x2,y2}`; use `span` for all calculations.
- **Changing sheet/frame settings (clarified since 0.9.4):** `project.modifyTitleBlock` can change only fields that already exist in the current frame. First check available keys in `titleBlockData` using `schematic.getPageInfo`.
- The official API throws `TypeError` for a nonexistent key.
- This API cannot change the paper through `Page Size` or `Symbol`.
- The user must change paper settings in the EDA interface.
- After a change, verify dimensions using `width` and `height` from `getPageInfo`.
- `size` or `Symbol` may still display old text.
- Layer values: `"top"` and `"bottom"`.
- `pcb.drawOutline` public `x`/`y` coordinates specify the lower-left corner.

## Activate the document (⚠️ type guard since 0.8.2)

Before any `schematic.*` or `pcb.*` command, activate a document of the corresponding type:

```json
{ "cmd": "editor.openDocument", "instanceId": "<verified instance ID>", "params": { "uuid": "<page or PCB UUID>" } }
```

- Get schematic page UUIDs from `project.listSchematicPages`; verify other documents in the document tree returned by `project.getInfo`.
- After activation, include `params.__docUuid` in page-level commands for verification; checking only the document type is insufficient.
- ⚠️ If focus is wrong, the command reports an explicit error. This is a guard, not a bug; run `openDocument` again.

## Send a complete request

Send each command to `POST /command` with `Content-Type: application/json`.

Replace the placeholder with the instance ID just verified:

```bash
curl -X POST http://127.0.0.1:49720/command -H 'Content-Type: application/json' -d '{"cmd":"project.getInfo","instanceId":"<verified instance ID>","params":{}}'
```

The top-level fields are `cmd`, `instanceId`, and optional `params`.

The current proxy directly rejects EDA requests without an ID; it does not fall back to the globally selected instance.

Success returns `ok:true`.

Failure may be an HTTP error or HTTP 200 with `ok:false`; always inspect the response body.

For `UNKNOWN_INSTANCE` or `TARGET_OFFLINE`, query connections again and verify identity.

Do not switch to another project to get rid of an error.

Only the outer macro request includes `instanceId`. Commands in `params.steps` inherit that instance and are not routed separately.

## Other editor operations

| Command | Purpose | When to use | Usage | Limitation |
| --- | --- | --- | --- | --- |
| `editor.listTabs` | List tabs in the current window. | Select or verify a document tab. | None | Obtain tab IDs from the current window's response. |
| `editor.screenshot` | Capture the current editor viewport. | Inspect the current canvas appearance. | `zoomToAll?`, `tabId?` | A background window may return a cached old frame. |
| `schematic.exportPng` | **Preferred for visual acceptance** (separate rendering pipeline; exports the full drawing even when the window is in the background. Returns base64 of **all schematic pages in a ZIP**, beginning with PK; unzip it to read each page PNG.) | Backup, delivery, or independent inspection. | None | No side may exceed 4096 px. |
| `editor.zoomToAll` | Zoom to all primitives. | Inspect the overall layout. | `tabId?` | Successful zoom does not prove the background canvas redrew. |
| `editor.zoomToRegion` | Zoom to a specified region. | Inspect a local area. | `left/right/top/bottom`, `tabId?` | Coordinate units depend on the current document. |
| `editor.closeDocument` | Close a specified tab and check the result. | Close a page after saving. | `uuid?`, `tabId?` | An unknown tab state does not mean it is closed. |

- **Region screenshot** (no native command; equivalent to a two-step macro): aim `zoomToRegion` at the area, then capture it with `screenshot`.

```json
{
	"cmd": "macro",
	"instanceId": "<verified instance ID>",
	"params": {
		"steps": [
			{ "cmd": "editor.zoomToRegion", "params": { "left": 100, "right": 200, "top": 200, "bottom": 100 } },
			{ "cmd": "editor.screenshot", "params": {} }
		]
	}
}
```

100 and 200 are example coordinates. Replace them with the target region before use.

`left < right`, `top > bottom`, and the larger Y value is higher.

The screenshot result is in `steps[1].base64` in the macro response.

## Timeouts, progress, and write protection

The default wait is 300 seconds.

Some long-running commands extend the wait with progress heartbeats, but an outer circuit breaker or host error may still fail; a timeout can never be ruled out.

A timeout does not mean cancellation.

For a long-running task with a `taskId`, query it with `task.get`; if necessary, find it with `task.list`, then inspect the current state read-only.

Progress updates from supported long commands reset the proxy's 300-second wait. A connection ping/pong does not prove that a task is progressing.

Ordinary writes may not be recorded in the task table. An empty task table does not prove an old write has finished.

Since 0.10.73, an uncertain write result places that instance under write protection; checks happen both when queuing and dequeuing a write.

Reads may continue during this state; writes are rejected.

Protection can be cleared only by a trusted late result for the corresponding command, or by an explicit `write.acknowledge` after the old write's status is confirmed.

Do not clear it automatically or merely by waiting. Do not generalize long-task deduplication into permission to resend every command unchanged.

Write commands are queued per window.

Prefer one batch request over concurrent single-item creation. Inspect failed items, `batches`, `unprocessed`, and `partial` results.

`editor.openDocument` and `editor.closeDocument` are queued as well; a macro occupies one lane as a whole.

Queueing does not guarantee a successful host operation. Always check each result and read back the state.

Logs are in the proxy directory as `lane-log-*.jsonl`; write failures are also recorded in `lane-log-error.txt`.

After reconnecting, verify the instance, project, and document again. Reconnect or stop/start may preserve an ID; reloading the extension may change it. Keep write protection when recovery is unconfirmed.

See [pitfalls](pitfalls.md) for further handling.

## Cold-start and development-debug connection issues

The installed host's HTTP forwarding layer may wrap a refused connection to `127.0.0.1` as HTTP 500 JSON. The extension may then mistake a stopped bridge for an incompatible service and skip starting it.

The extension's internal health probe uses `http://localhost:49720/health`. This address is for requests made directly by the host.

WebSocket, listen address, and Windows launcher remain unchanged.

Still reject an actual unrelated or old service; do not start a new process blindly just because of an HTTP 500.

The complete cold-start flow must be verified separately on the current host. Successful manual startup does not prove cold start works.

If a message says “maximum retries reached for WebSocket debug mode” or asks for `npm run dev`, it refers to the host extension-development debug connection, not AI Command's bridge reconnection. These are separate paths.

The installed package does not require a development server for normal use.

Do not mask a bridge failure by starting an unrelated debug service.

## Upgrade and heartbeat

Update the extension and proxy together. The version in `/connections` describes the extension; also verify the proxy process path, start time, and files in use. Replacing files does not update a running process. Before an upgrade, finish or safely stop operations, save, and close the old EDA window. If the old proxy remains resident, check in-flight tasks, queued writes, and unknown-result write protection before ending it. Do not force-stop a shared proxy blindly.

On EDA 4.1.60, the background 10-second timer was observed slowing to about 60 seconds. Since 0.10.80, the proxy sends an application ping about every 20 seconds and the extension responds with a pong. A timer delay alone does not establish a disconnect. On silence, probe first; retire the connection only if there is no response and no in-flight command.

For upgrade or connection repair, test two normally installed windows independently: query tabs and verify each `instanceId`; test menu reconnect, stop, and start; confirm there are no duplicate instances, the other window remains usable, and an offline ID is rejected. For a background test, actually trigger the slowdown condition and then verify connection identity, time, and queries. Perform temporary diagnostics only when authorized, then clean them up. Distinguish mock, host-module, and installed-package evidence. On 2026-10-07, EDA 4.1.60 with the official v0.10.80 package passed these two-window and approximately 60-second slowdown checks.

## Optional project skills

Use **hw-project** for project goals, records, and stage acceptance. Use **eda-schematic-layout** when improving the readability of an existing schematic. For official design references, use the hw-project skill's “Official sources and verification scope” material. These skills are optional and are distributed separately from this skill.
