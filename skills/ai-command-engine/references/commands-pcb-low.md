# Less Frequently Used PCB Commands

“Less frequently used” means commands called for specific tasks; it does not mean they are useless or unverified. The 76 commands below, together with the [frequently used PCB commands](commands-pcb-high.md), cover the current set of 94 `pcb.*` commands. See [Detailed PCB Guidance](commands-pcb.md), [PCB Geometry Commands](commands-pcb-special.md), and its Network and Export and Order Check sections for parameters and known limitations.

| Scenario | Commands |
| --- | --- |
| Autorouting, fanout, and local geometry | `pcb.autoRouteStart`, `pcb.autoRouteStatus`, `pcb.autoRouteStop`, `pcb.importAutoRouteSes`, `pcb.exportDsn`, `pcb.getFanoutPlan`, `pcb.fanout`, `pcb.getPadExpansionPlan`, `pcb.expandPads`, `pcb.groupBySchematicRegions`, `pcb.sourceRollback` |
| Automatic copper and silkscreen | `pcb.getAutoCopperPlan`, `pcb.autoCopper`, `pcb.getPourFillReadback`, `pcb.getNetSilkscreenPlan`, `pcb.generateNetSilkscreen`, `pcb.listStrings`, `pcb.placeString`, `pcb.modifyString`, `pcb.modifyPour` |
| Rules, nets, and checks | `pcb.runDrcDetailed`, `pcb.runDfm`, `pcb.runSmtDfm`, `pcb.checkSameNetPadSpacing`, `pcb.getNetRules`, `pcb.getNetLength`, `pcb.getNetPrimitives`, `pcb.highlightNet`, `pcb.setNetLock`, `pcb.startRealTimeDrc`, `pcb.stopRealTimeDrc`, `pcb.getRealTimeDrcStatus` |
| Net classes, differential pairs, and equal-length groups | `pcb.createDiffPair`, `pcb.listDiffPairs`, `pcb.deleteDiffPair`, `pcb.createNetClass`, `pcb.listNetClasses`, `pcb.addNetToClass`, `pcb.removeNetFromClass`, `pcb.deleteNetClass`, `pcb.renameNetClass`, `pcb.createEqualLengthGroup`, `pcb.listEqualLengthGroups`, `pcb.renameEqualLengthGroup`, `pcb.deleteEqualLengthGroup`, `pcb.addNetToEqualLengthGroup`, `pcb.removeNetFromEqualLengthGroup` |
| Layers and stackups | `pcb.getCurrentLayer`, `pcb.selectLayer`, `pcb.setCopperLayers`, `pcb.setLayerVisible`, `pcb.setLayerLocked`, `pcb.listStackingConfigs`, `pcb.getStackingConfig`, `pcb.applyStackingConfig`, `pcb.saveStackingConfig`, `pcb.renameStackingConfig`, `pcb.deleteStackingConfig`, `pcb.setDefaultStackingConfig`, `pcb.addCustomLayer`, `pcb.removeCustomLayer`, `pcb.modifyLayer`, `pcb.setPcbType` |
| Locating, primitives, and selection | `pcb.getSelection`, `pcb.select`, `pcb.clearSelection`, `pcb.crossProbe`, `pcb.listLines`, `pcb.modifyLine`, `pcb.listVias`, `pcb.modifyVia`, `pcb.getPrimitivesInRegion`, `pcb.getPrimitiveAtPoint`, `pcb.delete` |
| Project sync and other exports | `pcb.importChanges`, `pcb.exportNetlist` |

The current operating boundary for `pcb.importChanges` is described in the skill entry point and [Detailed PCB Guidance](commands-pcb.md). Check the target and results before stackup changes, autorouting, and bulk geometry operations.

The temporary v0.20.38 policy also checks all `routeTrack` segments, SES input segments, and planned-difference segments before writing. If any segment is shorter than 1 mil (25.4 μm), the request is rejected, even if that geometry already exists. This threshold is a plugin policy, not an SDK minimum. See [Detailed PCB Guidance](commands-pcb.md).

After a write failure, skip a recovery write only when comparison of the complete document identity and source confirms that content did not change; the command still reports failure. If this cannot be confirmed, continue the original recovery process. This candidate behavior is awaiting host acceptance.

In the v0.20.38 candidate, `pcb.autoRouteStatus` only queries task status and disables automatic back-import. See [Detailed PCB Guidance](commands-pcb.md) for disabled-result and slot handling. Run DRC separately after any historical back-import; do not treat an unreadable violation count as zero violations.

Historical v0.20.29 record: on the first SES import failure, five short track segments did not appear and recovery was unconfirmed. Multiline `wire`, `path`, and coordinate-pair output had been considered as a format-compatibility candidate. Manual `importAutoRouteSes` still appends only geometry not already present on the current board; if all geometry already exists, it returns `imported:false`, `alreadyPresent:true`. The older `autoRouteStatus` preserved locked primitives according to SDK lock state and replaced unlocked copper-layer routing. Current automatic back-import is disabled. Tracks and arcs on other layers are retained as out-of-scope content; reconstructed wire/via objects do not carry the original `type` field and are not guaranteed to preserve all wire metadata.

The v0.20.36 local candidate selects the backend automatically before writing. A15 adds and verifies new content before deleting old routes; failures from either SES backend use dedicated recovery hooks. See [Detailed PCB Guidance](commands-pcb.md) for detailed conditions. The candidate passed focused local regression and final review; host acceptance remains pending.

The v0.20.37 candidate only changes local deep copies of three internal JSON snapshots. It adds no polyfill and does not change geometry or recovery semantics. Focused local regression and final review passed; host retest remains pending. See [Detailed PCB Guidance](commands-pcb.md).

`sesGeometryVerified:true` in a success receipt means only that SES geometry readback passed. See above for handling of missing drill sizes, existing vias, and unconfirmed recovery. On failure, inspect the diagnostic reference, status, and inline record in `cause.sesDiagnostic`. Diagnostic stages have a 500 ms limit; a timeout or storage failure does not block recovery. Successful receipts do not include the large diagnostic record.

## EDA Version Restrictions

The user has decided to pause the following 11 features on the current EDA 4.1.78 host. In v0.20.49, each was verified to reject before calling the target interface, and the test PCB source remained unchanged. Keep the command entry points and version guards; do not automatically try an older-version fallback. Reassess restoration only after obtaining results from the applicable host and per-command acceptance tests.

Live calls on EDA 4.1.78 to all 11 commands below explicitly report that EDA 4.2 is required. Do not count rejection as a successful feature test. The 14 previously identified EDA 4.2-specific commands still require individual verification in a real EDA 4.2 environment. Actual execution, saving, and readback for the commands listed here have not been verified.

| Category | Commands unsupported in 4.1.78 |
| --- | --- |
| Current layer | `pcb.getCurrentLayer` |
| Physical stackup | `pcb.listStackingConfigs`, `pcb.getStackingConfig`, `pcb.applyStackingConfig`, `pcb.saveStackingConfig`, `pcb.renameStackingConfig`, `pcb.deleteStackingConfig`, `pcb.setDefaultStackingConfig` |
| Real-time DRC | `pcb.startRealTimeDrc`, `pcb.stopRealTimeDrc`, `pcb.getRealTimeDrcStatus` |

## PCB Layers, Copper Pours, Vias, and Text

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.addCustomLayer` / `pcb.removeCustomLayer` | Add or remove custom layers (starting at `CUSTOM_1=71`; only CUSTOM layers can be removed) | When configuring or checking PCB working layers. | Only CUSTOM custom layers can be removed. |
| `pcb.modifyLayer` / `pcb.setLayerLocked` | Change layer properties (name/type/color/opacity) / lock a layer | When configuring or checking PCB working layers. | If the write outcome is unknown, stop further writes. |
| `pcb.listPours` / `pcb.modifyPour` / `pcb.rebuildPour` | Inspect, modify, or rebuild copper pours (`listPours` can filter by net/layer) | When creating or checking copper regions. | The v0.20.42 candidate temporarily rejects changes to a different net or name, including mixed fields; source and fresh getter must agree. Same-value fields are skipped, and other allowed properties are checked as usual. This does not confirm fill freshness. |
| `pcb.listVias` / `pcb.modifyVia` | Inspect or modify vias (net/location/drill/outer diameter) | When checking or adjusting vias. | If the write outcome is unknown, stop further writes. |
| `pcb.listStrings` / `pcb.modifyString` / `pcb.placeString` | Inspect, modify, or place PCB text (silkscreen) | When adding board notes or silkscreen. | If the write outcome is unknown, stop further writes. |
| `pcb.setPcbType` | Board type (rigid `NORMAL` / flexible `FPC`) | When changing an existing object covered by this section. | Accepts only `normal` or `fpc`; the command reports failure if the SDK returns false. |

## Less Frequently Used Net Class, Differential Pair, and Stackup Commands

`pcb.deleteNetClass` deletes the net class and does not restore member nets' colors. In an EDA 4.1.78 / ACE 0.20.24 sample, net-specific colors remained after deletion and after save/reopen. `deleted:true` does not mean the entire pre-creation state was restored; this does not prove that all current versions retain colors.

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.deleteNetClass` / `pcb.removeNetFromClass` / `pcb.renameNetClass` | Delete a net class, remove a member, or rename it | When managing rules by net group. | Confirm the target and make a backup first. |
| `pcb.deleteDiffPair` | Delete a differential pair (see PCB topics for creating/listing pairs) | When configuring or checking differential signals. | Confirm the target and make a backup first. |
| `pcb.deleteStackingConfig` / `pcb.setDefaultStackingConfig` | Delete a stackup configuration or set the default (see `commands-pcb.md` for creating/applying) | When configuring or checking multilayer stackups. | Confirm the target by configuration name. |
| `pcb.removeNetFromEqualLengthGroup` | Remove a net from an equal-length group | When managing nets that require equal length. | Confirm the target and make a backup first. |
| `pcb.getNetPrimitives` | Inspect all primitives on a net (tracks/vias/pads) | When analyzing connected objects on a specified net. | Confirm available parameters using help for the target instance. |
