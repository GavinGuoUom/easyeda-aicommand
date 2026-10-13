# Reusable Module Commands (`cbb.*`, 12 commands since 0.10.34)

> The tables and parameter objects on this page describe commands and `params`; they are not complete HTTP requests. A `/command` request must include outer `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

Library management, placement, and export for reusable modules (the official “模块” / Module feature). Always get library UUIDs from `cbb.listLibraries` first (system/personal/project/favorite categories). By default, the official search uses the system library; personal libraries hold modules saved by the user.

| Command | Description | Key parameters |
| --- | --- | --- |
| `cbb.listLibraries` | Get UUIDs for all four library categories (source for `libraryUuid` in other `cbb.*` commands) | None |
| `cbb.search` | Search modules (empty keyword lists all) | `key?`, `libraryUuid?`, `page?`, `itemsOfPage?` |
| `cbb.get` | Get module details | `cbbUuid`, `libraryUuid?` |
| `cbb.create` | Create an empty module project in a specified library (then open it with `openProject` and draw in it) | `libraryUuid`, `name`, `description?` |
| `cbb.copy` | Copy a module to another library (for example, copy an official module to a personal library before adapting it; fails if the target library already has the name) | `cbbUuid`, `libraryUuid`, `targetLibraryUuid`, `newName?` |
| `cbb.delete` | Delete a module | `cbbUuid`, `libraryUuid` |
| `cbb.openProject` | ⚠️ Open the module project (switches the current project; unsaved changes are lost; after opening, use `editor.listTabs` to get page/PCB UUIDs) | `cbbUuid`, `libraryUuid` |
| `cbb.placeSymbol` | Place a module symbol on the current schematic (entry to hierarchical design; schematic coordinates use 10 mil units and must be multiples of 5) | `libraryUuid`, `cbbUuid`, `x`, `y`, `rotation?`, `mirror?` |
| `cbb.placeSchematicPage` | Place the contents of a module schematic page on the current page (get its UUID with `openProject` + `listTabs` first) | `libraryUuid`, `cbbUuid`, `uuid`, `x`, `y`, `reimportWhenNameRepeated?` |
| `cbb.placePcb` | **The most reusable command:** place the whole module PCB, including placement and routing, on the current PCB; reuse mature power/minimum-system layouts (coordinates in mil) | `libraryUuid`, `cbbUuid`, `uuid`, `x`, `y`, `reimportWhenNameRepeated?` |
| `cbb.openSymbolInEditor` | Open the module symbol editor (⚠️ call `openProject` first) | `cbbUuid`, `libraryUuid`, `splitScreenId?` |
| `cbb.exportFile` | Export a module as epro (base64; requires permission to download team modules) | `cbbUuid`, `libraryUuid?`, `fileName?` |

⚠️ Notes:

- `cbb.openProject` and `cbb.openSymbolInEditor` switch the project/focus. To return to your project, activate it again with `editor.openDocument`.
- In newer SDKs, `reimportWhenNameRepeated` controls whether a repeated module name is imported again. The EDA 4.1.71 runtime SDK does not forward this option, so do not infer duplicate-name behavior or net isolation from its value.
- Verify placement by reading back: after `cbb.placePcb`, audit nets with `pcb.listComponents` + `getComponentPads`.

On 2026-10-12, an isolated sample on EDA 4.1.71 explicitly passed the source schematic-page UUID, read back three test points and one wire, and saved. The current runtime SDK looks up by page UUID; when given the parent schematic UUID and no page matches, it falls back to the first page. An earlier successful call with the parent UUID does not prove that it selected the requested page. An SDK `true` only confirms the call returned; inspect the actual contents.

For native PCB transfer, `Reuse Block` names on components are matched against PCB templates. In a test project, matching the associated PCB copy's name to that value let one `pcb.importChanges` call and the host's “Apply Changes” action bring in placement, tracks, vias, the board outline, and copper pours. Preserve group and channel identifiers, then check the result after save and reopen. This evidence covers only the tested small sample; placing the schematic and PCB separately does not prove that they are associated.
