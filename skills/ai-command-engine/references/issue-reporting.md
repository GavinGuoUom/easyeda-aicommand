# Plugin issue reporting

This workflow is part of the AI Command Engine skill.

When a plugin error or a mismatch between a command response and readback occurs, prepare a report in the format below. Before submission, tell the user that it will be submitted under their current GitHub identity to `quhuii-lgtm/easyeda-aicommand`.

After telling the user, proceed under their existing authorization without asking for separate confirmation for each report.

Follow an explicit request from the user not to submit.

## Initial setup

- Node.js >=20.17.0 is installed, matching the command proxy requirement.
- Install [GitHub CLI](https://cli.github.com/). The user completes sign-in once:

```powershell
gh auth login --hostname github.com --web
gh auth status --hostname github.com
```

The tool uses the currently active GitHub CLI identity. `GH_TOKEN` or `GITHUB_TOKEN` configured in the environment may also affect that identity.

The user switches accounts through GitHub CLI when needed.

A browser or Git sign-in does not mean GitHub CLI is signed in.

The tool does not request, print, or save GitHub tokens.

GitHub CLI manages credentials.

Do not put a token in the report, plugin source, or chat.

This feature does not require EDA to be open, the command proxy to be connected, or an `instanceId`.

## AI operating rules

1. Record only plugin issues actually encountered in the current task.
   - If key reproduction details are missing, fill them in first. Use “Unknown” for a version that cannot be confirmed.
   - Separate observed facts from suspected causes.
2. Use only necessary, public evidence already obtained during the task.
   - Remove secrets, tokens, personal information, and private project content.
   - Do not scan the whole project or upload complete logs or project files for a report.
   - The tool does not redact automatically. The AI must review the report before writing it.
3. Save a UTF-8 JSON report in the system temporary directory. From the plugin repository, run `preview` and read the title and body that will be submitted.
4. Tell the user in the conversation which repository will receive the public submission, along with the issue title, main content, and included evidence.
   - After telling the user, run `submit` without adding a per-report confirmation step.
   - Tool output alone does not mean the user has been told.
5. After a successful submission, return the Issue link.
   - If not signed in, a tool is missing, or GitHub rejects the request, report that accurately and keep the local draft. Do not claim it was submitted.
   - For GitHub rejection, the tool returns only a generic rejection. Do not infer a permissions or rate-limit cause from a status code.
6. If the creation result is unknown, check the issue list before taking further action; do not blindly submit again.
   - If the issue was created but readback failed, provide the Issue link retained by the tool and state that it has not been verified. Do not create it again.

This is an explicit local tool operated by the AI, not background error monitoring.

Running EDA commands does not itself upload data.

The script cannot prove whether the user was told in the conversation. The AI is responsible for following the steps above.

## Report format

All fields are strings.

Required: `title`, `pluginVersion`, `edaVersion`, `os`, `steps`, `expected`, `actual`.

Optional: `command`, `evidence`.

No other fields are supported.

Unknown fields are not silently discarded.

```json
{
  "title": "[Bug] Command reports success but target text remains after save",
  "pluginVersion": "0.10.87",
  "edaVersion": "Unknown",
  "os": "Windows 11",
  "steps": "1. Open the test schematic page\n2. Delete the target text\n3. Save and read the target again",
  "expected": "The target text is deleted and absent on readback.",
  "actual": "The command reports success, but the text remains on readback. This is a format example only, not evidence of a real defect.",
  "command": "schematic.delete; object identifier replaced",
  "evidence": "Include only relevant error excerpts that have been reviewed and redacted."
}
```

The example demonstrates the format only. Do not submit it as a real issue.

`evidence` is body text; the tool does not read attachments or file paths automatically.

Use one report per issue and avoid duplicate submissions for an issue already recorded.

## Preview and submit

Run from the plugin repository directory that contains `bridge`; `--file` points to the report prepared by the AI:

```powershell
node bridge/report-issue.mjs preview --file "$env:TEMP\aicommand-issue.json"
node bridge/report-issue.mjs submit --file "$env:TEMP\aicommand-issue.json"
```

`preview` performs local format validation and renders the body. It does not access the network.

`submit` publicly creates an Issue: it checks GitHub CLI sign-in, submits the report, then reads back the returned issue number and verifies the title, body, and link.

Every invocation is fixed to `github.com/quhuii-lgtm/easyeda-aicommand`; it does not use another repository from the current directory.

Exit code 0 means the operation succeeded.

For a non-zero exit code, read the JSON error result.

There is no automatic sign-in, retry, or background resubmission.

An unknown submission result does not mean no Issue was created.

The GitHub web form is in `.github/ISSUE_TEMPLATE/bug_report.yml` in the repository and uses the same information fields.

Web and API submissions are validated separately. The web form does not replace this tool's input validation.

## Verification boundary

Local mock test: `node test/issue-report-regression.mjs`.

The mock test does not create a public Issue and does not replace acceptance with a real GitHub login and network access.

Official references: [GitHub CLI login](https://cli.github.com/manual/gh_auth_login), [GitHub CLI API](https://cli.github.com/manual/gh_api), and [Create an issue](https://docs.github.com/en/rest/issues/issues#create-an-issue).
