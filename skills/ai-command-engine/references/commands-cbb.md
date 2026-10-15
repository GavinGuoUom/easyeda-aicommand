# Reusable Module Commands (`cbb.*`, 12 commands since 0.10.34)

> The tables and parameter objects on this page describe commands and `params`; they are not complete HTTP requests. A `/command` request must include outer `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

Library management, placement, and export for reusable modules (the official “模块” / Module feature). Always obtain library UUIDs with `cbb.listLibraries` first (system/personal/project/favorite categories). By default, official search uses the system library; personal libraries hold modules saved by the user.

| Command | Description | Key parameters |
| --- | --- | --- |
| `cbb.listLibraries` | Get UUIDs for all four library categories (source for `libraryUuid` in other `cbb.*` commands) | None |
| `cbb.search` | Search modules (an empty keyword lists all) | `key?`, `libraryUuid?`, `page?`, `itemsOfPage?` |
| `cbb.get` | Get module details | `cbbUuid`, `libraryUuid?` |
| `cbb.create` | Create an empty module project in a specified library; open it with `openProject` to draw in it | `libraryUuid`, `name`, `description?` |
| `cbb.copy` | Copy a module to another library (for example, copy an official module to a personal library before adapting it; fails if the target library already has that name) | `cbbUuid`, `libraryUuid`, `targetLibraryUuid`, `newName?` |
| `cbb.delete` | Delete a module | `cbbUuid`, `libraryUuid` |
| `cbb.openProject` | ⚠️ Open the module project (**switches the current project; unsaved changes are lost**; after opening, use `editor.listTabs` to get page/PCB UUIDs) | `cbbUuid`, `libraryUuid` |
| `cbb.placeSymbol` | Place a module symbol on the current schematic (entry to hierarchical design; schematic coordinates use 10 mil units) | `libraryUuid`, `cbbUuid`, `x`, `y`, `rotation?`, `mirror?` |
| `cbb.placeSchematicPage` | Place a specified source page's module content on the current page; the UUID is the source page UUID, so first check which schematic owns it | `libraryUuid`, `cbbUuid`, `uuid`, `x`, `y`, `reimportWhenNameRepeated?` |
| `cbb.placePcb` | **Most reusable command:** place the entire module PCB, including placement and routing, on the current PCB; reuse mature power/minimum-system layouts (coordinates in mil) | `libraryUuid`, `cbbUuid`, `uuid`, `x`, `y`, `reimportWhenNameRepeated?` |
| `cbb.openSymbolInEditor` | Open the module symbol editor (⚠️ call `openProject` first) | `cbbUuid`, `libraryUuid`, `splitScreenId?` |
| `cbb.exportFile` | Export a module as epro (base64; requires permission to download team modules) | `cbbUuid`, `libraryUuid?`, `fileName?` |

Notes:

- `cbb.openProject` and `cbb.openSymbolInEditor` switch project/focus. To return to your project, activate it again with `editor.openDocument`.
- In newer SDKs, `reimportWhenNameRepeated` controls whether a same-name module is imported again. The current EDA 4.1.71 runtime SDK does not forward this option; its value does not establish duplicate-name handling or net isolation.
- Read back placement: after `cbb.placePcb`, audit nets with `pcb.listComponents` and `getComponentPads`.

On 2026-10-12, an isolated EDA 4.1.71 sample explicitly passed the source page UUID, read back three test points and one wire, and saved. The current runtime SDK looks up a page UUID; if a parent schematic UUID does not match, it falls back to the first page. An earlier successful call with the parent UUID does not prove it selected the requested page. SDK `true` only means the call returned; inspect the actual content.

Native PCB transfer matches a component's `Reuse Block` name to a PCB template. In a test project, matching the companion PCB copy's name to this value allowed one `pcb.importChanges` call and the host “应用修改” (“Apply Changes”) action to bring in placement, tracks, vias, board outline, and copper pours. Preserve group and channel identifiers, then check after save/reopen. This evidence covers only the tested small sample; placing SCH and PCB separately does not prove they are associated.
