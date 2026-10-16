# Less Frequently Used PCB Commands

“Less frequently used” means commands for specific tasks; it does not mean they are useless or unverified. The 76 commands below, together with the [frequently used PCB commands](commands-pcb-high.md), cover the current set of 93 `pcb.*` commands. See [PCB command reference](commands-pcb.md), [PCB geometry commands](commands-pcb-special.md), and the network, export, and order-check sections in [PCB geometry commands](commands-pcb-special.md) for parameters and known limitations.

| Scenario | Commands |
| --- | --- |
| Autorouting, fanout, and local geometry | `pcb.autoRouteStart`, `pcb.autoRouteStatus`, `pcb.autoRouteStop`, `pcb.importAutoRouteSes`, `pcb.exportDsn`, `pcb.getFanoutPlan`, `pcb.fanout`, `pcb.getPadExpansionPlan`, `pcb.expandPads`, `pcb.groupBySchematicRegions`, `pcb.sourceRollback` |
| Automatic copper and silkscreen | `pcb.getAutoCopperPlan`, `pcb.autoCopper`, `pcb.getPourFillReadback`, `pcb.getNetSilkscreenPlan`, `pcb.generateNetSilkscreen`, `pcb.listStrings`, `pcb.placeString`, `pcb.modifyString`, `pcb.modifyPour` |
| Rules, nets, and checks | `pcb.runDrcDetailed`, `pcb.runDfm`, `pcb.runSmtDfm`, `pcb.checkSameNetPadSpacing`, `pcb.getNetRules`, `pcb.getNetLength`, `pcb.getNetPrimitives`, `pcb.highlightNet`, `pcb.setNetLock`, `pcb.startRealTimeDrc`, `pcb.stopRealTimeDrc`, `pcb.getRealTimeDrcStatus` |
| Net classes, differential pairs, and equal-length groups | `pcb.createDiffPair`, `pcb.listDiffPairs`, `pcb.deleteDiffPair`, `pcb.createNetClass`, `pcb.listNetClasses`, `pcb.addNetToClass`, `pcb.removeNetFromClass`, `pcb.deleteNetClass`, `pcb.renameNetClass`, `pcb.createEqualLengthGroup`, `pcb.listEqualLengthGroups`, `pcb.renameEqualLengthGroup`, `pcb.deleteEqualLengthGroup`, `pcb.addNetToEqualLengthGroup`, `pcb.removeNetFromEqualLengthGroup` |
| Layers and stackups | `pcb.getCurrentLayer`, `pcb.selectLayer`, `pcb.setCopperLayers`, `pcb.setLayerVisible`, `pcb.setLayerLocked`, `pcb.listStackingConfigs`, `pcb.getStackingConfig`, `pcb.applyStackingConfig`, `pcb.saveStackingConfig`, `pcb.renameStackingConfig`, `pcb.deleteStackingConfig`, `pcb.setDefaultStackingConfig`, `pcb.addCustomLayer`, `pcb.removeCustomLayer`, `pcb.modifyLayer`, `pcb.setPcbType` |
| Locating, primitives, and selection | `pcb.getSelection`, `pcb.select`, `pcb.clearSelection`, `pcb.crossProbe`, `pcb.listLines`, `pcb.modifyLine`, `pcb.listVias`, `pcb.modifyVia`, `pcb.getPrimitivesInRegion`, `pcb.getPrimitiveAtPoint`, `pcb.delete` |
| Project sync and other exports | `pcb.importChanges`, `pcb.exportNetlist` |

The current operating boundary for `pcb.importChanges` is described in the skill entry point and [PCB command reference](commands-pcb.md). Check the target and results before stackup changes, autorouting, and bulk geometry operations.

## PCB Layers, Copper Pours, Vias, and Text

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.addCustomLayer` / `pcb.removeCustomLayer` | Add or remove custom layers (starting with `CUSTOM_1=71`; only CUSTOM layers can be removed) | When configuring or checking PCB working layers. | Only CUSTOM layers can be removed. |
| `pcb.modifyLayer` / `pcb.setLayerLocked` | Change layer properties (name/type/color/opacity) / lock a layer | When configuring or checking PCB working layers. | If the write outcome is unknown, stop further writes. |
| `pcb.listPours` / `pcb.modifyPour` / `pcb.rebuildPour` | Inspect, modify, or rebuild copper pours (`listPours` can filter by net/layer) | When creating or checking copper regions. | Cannot confirm that the fill is fresh. |
| `pcb.listVias` / `pcb.modifyVia` | Inspect or modify vias (net/location/drill/diameter) | When checking or adjusting vias. | If the write outcome is unknown, stop further writes. |
| `pcb.listStrings` / `pcb.modifyString` / `pcb.placeString` | Inspect, modify, or place PCB text (silkscreen) | When adding board notes or silkscreen. | If the write outcome is unknown, stop further writes. |
| `pcb.setPcbType` | Board type (rigid `NORMAL` / flexible `FPC`) | When changing an existing object covered by this section. | If the write outcome is unknown, stop further writes. |

## Less Frequently Used Net Class, Differential Pair, and Stackup Commands

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `pcb.deleteNetClass` / `pcb.removeNetFromClass` / `pcb.renameNetClass` | Delete a net class, remove a member, or rename it | When managing rules by net group. | Confirm the target and make a backup first. |
| `pcb.deleteDiffPair` | Delete a differential pair (see PCB topics for creating/listing pairs) | When configuring or checking differential signals. | Confirm the target and make a backup first. |
| `pcb.deleteStackingConfig` / `pcb.setDefaultStackingConfig` | Delete a stackup configuration or set the default (see `commands-pcb.md` for creating/applying) | When configuring or checking multilayer stackups. | Confirm the target by configuration name. |
| `pcb.removeNetFromEqualLengthGroup` | Remove a net from an equal-length group | When managing nets that require equal length. | Confirm the target and make a backup first. |
| `pcb.getNetPrimitives` | Inspect all primitives on a net (tracks/vias/pads) | When analyzing connected objects on a specified net. | Confirm available parameters using help for the target instance. |
