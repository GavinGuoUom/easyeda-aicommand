# Project and Board Commands (`project.*`)

> The tables and parameter objects on this page describe commands and `params`; they are not complete HTTP requests. A `/command` request must include outer `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

Create, copy, delete, and associate projects, boards, and schematic pages. Always read document-tree UUIDs from `project.getInfo`; do not guess them.

## Unclear result from project import (0.10.106 candidate)

If the SDK call to `project.importFile` returns empty, throws, or provides no valid project UUID, report `partial:true`, `retryable:false`, `outcome:unknown`. This means the import result cannot be confirmed; it does not mean that no project was created. Check the target name and directory from the error first; do not automatically import again. Invalid parameters before the call remain an ordinary rejection. A successful return still requires independent verification of project contents.

## Project-level commands

| Command | Description | Key parameters |
| --- | --- | --- |
| `project.getInfo` | Current project info (name + document-tree UUID) | None |
| `project.getInfoOf` | Info for a specified project | `projectUuid` |
| `project.list` | List all projects (`detail:true` reads each project's info and is slower) | `detail?` |
| `project.create` | Create a project | `name`, `projectName?` (English internal name), `description?` |
| `project.open` | Open/switch to a project. ⚠️ The official API fails directly when the current project has unsaved changes (“工程打开失败” / project open failed); run `schematic.save` before switching. | `projectUuid` |
| `project.moveToFolder` | Move a project to a folder (empty means root) | `projectUuid`, `folderUuid?` |
| `project.exportFile` | Export `.epro`/`.epro2` (decode base64 to disk for backup/migration) | `fileName?`, `fileType?` (epro\|epro2) |
| `project.importFile` | Import an external file as a new project (since 0.10.35; `.PcbDoc`/`.SchDoc`/`.epro` etc. infer `fileType`; if omitted, automatically use the current team and create a New Project) | `base64`, `fileName`, `fileType?`, `newProjectName?` |
| `project.getDocumentSource` | Read JSON source data for the active document (read-only; faster for whole-document analysis than querying primitives one by one) | None |
| `project.modifyTitleBlock` | Modify title block (⚠️ `data` keys must exist in the current frame; read `titleBlockData` using `getPageInfo` first. Page Size/Symbol cannot be changed through the API.) | `showTitleBlock?`, `data?` |

## Boards and associations

| Command | Description | Key parameters |
| --- | --- | --- |
| `project.getBoardInfo` | Current board info and schematic/PCB association state; use to diagnose a detached PCB when `pcb.importChanges` reports import failure | None |
| `project.associateBoard` | Associate a schematic and PCB with a board (repair a detached PCB) | `schematicUuid`, `pcbUuid` |
| `project.copyBoard` | Copy a board | `boardName` |
| `project.deleteBoard` | Delete a board | `boardName` |
| `project.renameBoard` | Rename a board (⚠️ matches by name and may rename the wrong board if names collide; verify with `getBoardInfo` first) | `boardName`, `newName` |

## Schematics and pages

| Command | Description | Key parameters |
| --- | --- | --- |
| `project.createSchematic` | Create a schematic (`boardName` must name an existing board; if omitted when creating, associate later with `associateBoard`) | `boardName?` |
| `project.createSchematicPage` | Create a page under the specified schematic (the UUID is the Schematic node, not a page) | `schematicUuid` |
| `project.deleteSchematicPage` | Delete a page | `pageUuid` |
| `project.copySchematicPage` | Copy a page (omit `schematicUuid` to copy within the same schematic; since 0.10.37 readback verifies the copy and returns name/parentSchematicUuid/sourcePageUuid; ownership anomalies carry a warning; the host deriving a new name as “sourceName_N” is normal) | `pageUuid`, `schematicUuid?` |
| `project.renameSchematicPage` | Rename a page by UUID (hardened in 0.10.59: compare snapshots before/after; `renamed` is based only on snapshots). ⚠️ The target page must be open and active in this window, and its document must have been saved at least once in this window; otherwise the official API can falsely fail. In a new window that has never renamed a page, it may permanently reject pages created in other windows; successfully rename a page created in this window once to unlock it. | `pageUuid`, `name` |
| `project.listSchematicPages` | List all pages | None |
| `project.reorderSchematicPages` | Reorder pages (⚠️ must include every page) | `schematicUuid`, `pageUuids[]` |

## PCB commands

| Command | Description | Key parameters |
| --- | --- | --- |
| `project.createPcb` | Create a PCB (same `boardName` rule as above) | `boardName?` |
| `project.copyPcb` | Copy a PCB; `boardName` names the target Board for the copy, not the copy itself | `pcbUuid`, `boardName?` |
| `project.deletePcb` | Delete a PCB | `pcbUuid` |
| `project.listPcbs` | List all PCBs | None |

- **`project.copyPcb`:** If `boardName` is omitted, creates a detached PCB; prior proof of board ownership is not required. If a nonexistent board name is specified and the SDK returns empty, the cause is unknown. On an empty SDK return or exception, the result is unconfirmed; the plugin returns `error.cause.partial=true` and stops dependent macro steps. Do not retry automatically. Inspect with read-only `project.getInfo` and `project.listPcbs`. A successful return identifies the copy with `pcbUuid`.

```json
{
  "instanceId": "current project window ID",
  "cmd": "project.copyPcb",
  "params": { "pcbUuid": "source PCB UUID", "boardName": "target Board name for the copy" }
}
```

If `error.cause.partial=true` is returned, do not copy again; inspect using the read-only checks above.
