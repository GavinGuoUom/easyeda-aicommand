# Frequently Used PCB Commands

“Frequently used” refers to recommendations for common board-design workflows, not measured call counts. First check the target window using [Connections and Environment](setup.md). `GET /help?cmd=<command name>` uses the window currently selected by the proxy; confirm that it matches the target version before relying on its parameters. See [Detailed PCB Guidance](commands-pcb.md) for full restrictions. See [Less Frequently Used PCB Commands](commands-pcb-low.md) for specific rules, stackups, and specialized operations.

| Stage | Recommended commands | Purpose |
| --- | --- | --- |
| Inspect current state | `pcb.listComponents`, `pcb.getComponentPads`, `pcb.listNets`, `pcb.listLayers` | Check components, pad nets, and layers. |
| Pad connection method | `pcb.connectComponentPadDirect` | The compatibility entry point is temporarily disabled; calls are rejected before accessing the project or SDK. |
| Placement and outline | `pcb.moveComponent`, `pcb.checkPlacement`, `pcb.drawOutline` | Place components, check clearance, and create the board outline. |
| Routing | `pcb.routeTrack`, `pcb.placeVia` | Draw tracks and change layers. The temporary plugin policy requires each `routeTrack` segment to be at least 1 mil (25.4 μm); shorter segments are rejected before writing. This is not an SDK limit. |
| Copper pour | `pcb.pourCopper`, `pcb.listPours`, `pcb.rebuildPour` | Create, inspect, and rebuild copper regions. |
| Checks | `pcb.runDrc`, `pcb.getNetInfo` | Check design rules and target nets. |
| Save and manufacturing | `pcb.save`, `pcb.exportGerber`, `pcb.exportPickPlace` | Save and generate manufacturing files as needed. |

This page covers 18 commands. PCB coordinates and lengths use mil. A `routeTrack` return ID alone does not prove the track was written; rely on primitive readback. See [Detailed PCB Guidance](commands-pcb.md). `pourCopper` creates only a copper boundary; use `rebuildPour` to inspect the actual fill. Do not report a pour as complete when the result is `no-fill`. A DRC result with no errors alone does not prove manufacturability.

The name and parameters of `pcb.connectComponentPadDirect` are retained for compatibility with existing calls. Required parameters are `documentUuid`, `componentId`, and `padNumber`; optional `padId` distinguishes pads with the same number.

The command always throws a temporarily disabled error. `error.cause` is `{ disabled:true, retryable:false, writeAttempted:false }`. Rejection occurs before any project or SDK access, so the call performs no read or write and does not return a `partial` write result.

The command is temporarily disabled because the tested host's public interface cannot reliably read back thermal-relief settings. This does not mean that every setter in the host version is broken. Reassess restoration when a reliable readback interface or official fix is available. The read-only diagnostic `pcb.getComponentPads` remains available; routing, copying sheets, and module reuse are unaffected.

`heatWelding` from `pcb.getComponentPads` is a per-pad, read-only diagnostic. Its statuses distinguish `null`, `config`, `unavailable`, `exception`, and `invalid`. A read exception returns `{status:"exception",error:{message}}`; an invalid return value returns `{status:"invalid",returnedType,reason}`. `config` means only that a configuration was read; it does not prove rule priority or the connection rule actually used by the host.

When `heatWelding.status:"invalid"`, the response also includes `rawFields`, a fixed list of `connectionMethod`, `divergenceSpacing`, `divergenceLineWidth`, and `divergenceAngle`. Each field independently returns `status` and `type`; `value` is returned only for safe scalars. Undefined fields and read exceptions are labeled `undefined` and `exception`. Non-finite numbers include only `finite:false`. Objects, functions, Symbols, and BigInts are recorded by type only; no arbitrary fields are read, and they are not converted or serialized. Each SDK field is read at most once. This diagnostic does not change the invalid-value determination or direct-write behavior.

The optional `_timeoutMs` for `pcb.connectComponentPadDirect` defaults to 290000 ms and has a maximum of 2147483647 ms. Budgets below 1000 ms are treated as 1000 ms.
