# Projects and pages

# Project and board management commands (`project.*`)

> This page preserves use cases and limitations. Use `/help?cmd=<command-name>` from the verified target window version for parameters, return fields, and examples.
> A `/command` request must include outer `cmd`, top-level `instanceId`, and the required `params`.
> A macro routes only at the outer level; its steps inherit the instance.
> See [setup](setup.md) for a complete example.

Commands for creating, copying, deleting, and associating projects, boards, and schematic pages.

Always get document-tree UUIDs from `project.getInfo`; do not guess them.

## Verify projects by team

`project.list` accepts an optional non-empty string `teamUuid`; when supplied, it is passed to the SDK unchanged.

When omitted, the host's default query scope is used.

The response is an array of project UUIDs.

With `detail:true`, the command returns an ordered array of `{ uuid, info }`.

If the host returns `undefined`, `null`, a non-array, or an array containing a non-string or empty-string item, report an explicit error; do not treat it as “no projects.”

Preserve project IDs as returned by the host; do not guess their format.

A genuine empty array still returns `[]`, but compare it with a known project from the same team.

Do not infer from an empty list alone that a previous import did not happen.

This command is read-only. It does not clear unknown-write protection or automatically retry an import.

```json
{"instanceId":"currently verified window ID","cmd":"project.list","params":{"teamUuid":"target team UUID recorded from the import result","detail":true}}
```

## Project-level commands

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `project.getInfo` | Current project information (name and document-tree UUIDs) | Confirm the current project before an operation. | Check available parameters in the target instance's help. |
| `project.getInfoOf` | Information for a specified project | Verify the document tree of a specified project. | Check available parameters in the target instance's help. |
| `project.list` | List projects. Can specify a team (`detail:true` fetches each project's information and is slower). | Find projects for a target team. | Check available parameters in the target instance's help. |
| `project.create` | Create a project. | Start a separate project. | If the write result is unknown, stop later writes. |
| `project.open` | Open a specified project and switch the current project. The official API fails with “project open failed” when the current project has unsaved changes; run `schematic.save` before switching. | Switch to a specified project or document. | Save unsaved changes in the current project first. |
| `project.moveToFolder` | Move a project into a folder (empty means root). | Organize project folders. | If the write result is unknown, stop later writes. |
| `project.exportFile` | Export `.epro` or `.epro2` (save the base64 locally for backup or migration). | Backup, delivery, or independent inspection. | Successful export does not prove content acceptance. |
| `project.importFile` | Import an external file as a new project (since 0.10.35; `.PcbDoc`, `.SchDoc`, `.epro`, etc. infer `fileType`; if omitted, uses the current team and `New Project`). | Receive an external design or synchronize content. | Treat empty return or exception as an unknown result; do not resend. |
| `project.getDocumentSource` | Read JSON source data of the active document (faster for whole-document read-only analysis than querying primitives individually). | Verify effective records read-only. | Source coordinates cannot be used directly as public API coordinates. |
| `project.modifyTitleBlock` | Modify the title block. `data` keys must already exist in the frame; check `titleBlockData` with `getPageInfo` first. The API cannot switch `Page Size` or `Symbol`. | Update existing title-block fields. | Only modifies existing fields; does not change paper size. |

## Boards and associations

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `project.getBoardInfo` | Current board information and schematic/PCB association status. Use to diagnose an orphan PCB after `pcb.importChanges` reports failure. | Verify or create a schematic-to-PCB association. | Check available parameters in the target instance's help. |
| `project.associateBoard` | Associate a schematic and PCB with a board (repair an orphan PCB). | Verify or create a schematic-to-PCB association. | If the write result is unknown, stop later writes. |
| `project.copyBoard` | Copy a board. | Reuse existing design content. | If the write result is unknown, stop later writes. |
| `project.deleteBoard` | Delete a specified board. On official API failure, includes current target information and does not retry automatically. | Remove a verified target. | Verify the target and back up first. |
| `project.renameBoard` | Rename a board. Matches by name, so duplicate names can select the wrong board; verify with `getBoardInfo` first. | Rename an unambiguous board. | If the write result is unknown, stop later writes. |

## Schematics and pages

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `project.createSchematic` | Create a schematic. If `boardName` is provided, it must be an existing board; if omitted, associate it later with `associateBoard`. | Add a schematic to a project. | Any supplied `boardName` must already exist. |
| `project.createSchematicPage` | Create a page under a specified schematic (`uuid` is the Schematic node, not a page). | Add a page to an existing schematic. | `schematicUuid` must refer to the parent schematic, not a page. |
| `project.deleteSchematicPage` | Delete a page. | Remove a verified target. | Verify the target and back up first. |
| `project.copySchematicPage` | Copy a page. | Reuse existing design content. | If the write result is unknown, stop later writes. |
| `project.renameSchematicPage` | Rename a page by UUID. | Organize page names and order. | Activate the target in this window and save the document once first. |
| `project.listSchematicPages` | List all schematic pages. | Select or verify a schematic page. | Check available parameters in the target instance's help. |
| `project.reorderSchematicPages` | Change page order. Must include every page. | Organize page names and order. | Supply UUIDs for all pages. |

### Additional notes for `project.copySchematicPage`

- If the target `schematicUuid` is omitted, the page is copied within the same schematic.
- Since 0.10.37, the copy is read back and verified. The response includes `name`, `parentSchematicUuid`, and `sourcePageUuid`; an ownership anomaly includes a warning.
- The new page name may be generated as `source-name_N`.

### Additional notes for `project.renameSchematicPage`

- Renames by UUID. Since 0.10.59, it compares snapshots before and after renaming and trusts `renamed` only when the snapshot confirms it.
- ⚠️ The target page must be open and active in this window, and its document must have been saved once in this window; otherwise the official API may falsely fail.
- An older host once failed to rename an old page from another window.
- That sample recovered after successfully renaming a new page in this window.
- Do not treat this historical behavior as a universal prerequisite for all windows.

## PCBs

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `project.createPcb` | Create a PCB. If `boardName` is provided, it must be an existing board. | Add a PCB to a project. | Any supplied `boardName` must already exist. |
| `project.copyPcb` | Copy a PCB. `boardName` is the destination Board name for the copy, not the copy's name. | Reuse existing design content. | If omitted, creates an orphan PCB. |
| `project.deletePcb` | Delete a PCB. | Remove a verified target. | Verify the target and back up first. |
| `project.listPcbs` | List all PCBs. | Select or verify a PCB document. | Check available parameters in the target instance's help. |

- **`project.copyPcb`:** if `boardName` is omitted, an orphan PCB is created.
- You do not need to prove an existing Board association in advance.
- If a nonexistent Board name is supplied and the SDK returns an empty result, the underlying cause is unknown.
- If the SDK returns empty or throws, the outcome is unconfirmed. The plugin returns `error.cause.partial=true` and stops dependent macro steps.
- Do not retry automatically.
- First inspect with `project.getInfo` and `project.listPcbs` (read-only).
- A successful copy is identified by the returned `pcbUuid`.

```json
{
  "instanceId": "current project window ID",
  "cmd": "project.copyPcb",
  "params": { "pcbUuid": "source PCB UUID", "boardName": "destination Board name for the copy" }
}
```

If `error.cause.partial=true`, do not copy again. Follow the read-only checks above.

## Unknown result from project import

If `project.importFile` returns empty, throws, or does not return a valid project UUID after calling the SDK, report `partial:true`, `retryable:false`, and `outcome:unknown`.

This means the import result cannot be confirmed; it does not mean no project was created.

First inspect using the target name and folder from the error. Do not automatically import again.

Parameter errors before the call are ordinary rejections.

Even a successful response requires a separate check of project contents.
