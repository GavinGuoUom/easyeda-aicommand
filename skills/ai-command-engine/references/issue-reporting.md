# Reporting Plugin Issues

Use this process with the AI Command Engine skill when an issue occurs, such as a plugin error or a mismatch between a read-back value and the returned result. The AI prepares a report in the format below, tells the user what it will submit, then submits it using the user's current GitHub identity to `quhuii-lgtm/easyeda-aicommand`. Do not ask for separate confirmation for each step. If the user explicitly says not to submit, follow that instruction.

## Instructions for the AI

1. Record only plugin issues encountered during the current task. Fill in missing reproduction details first. If the version cannot be confirmed, use “unknown”. Distinguish observed facts from suspected causes.
2. Use only necessary evidence already obtained in the task that can be made public. Remove secrets, tokens, personal information, and private project content. Do not scan the entire project or upload complete logs or project files for a report. The tool does not redact automatically; the AI must inspect the report before writing it.
3. Save a UTF-8 JSON report in the system temporary directory, run `preview` from the plugin repository directory, and read the title and body that will be submitted.
4. Tell the user in the conversation which repository will receive a public report under their GitHub identity, its title, the main content, and what evidence it includes. Then run `submit` without asking for another per-step confirmation. Tool output alone does not count as informing the user.
5. Return the Issue link after a successful submission. If the user is not logged in, the tool is unavailable, or GitHub rejects the request, report that accurately and keep the local draft; do not claim it was submitted. GitHub rejections return a generic message; do not infer an authorization or rate-limit cause from a status code.
6. If the submission result is unknown, check the issue list before trying again. If the Issue was created but read-back failed, provide the retained Issue link and explain that verification is incomplete; do not create a duplicate.

This is a local tool explicitly run by the AI, not background error monitoring. EDA command execution does not automatically upload data. The script cannot verify whether the user was informed in the conversation; the AI is responsible for following these steps.

## Initial setup

- Node.js >=20.17.0 is installed (the same requirement as the command proxy).
- Install [GitHub CLI](https://cli.github.com/) and have the user sign in once:

```powershell
gh auth login --hostname github.com --web
gh auth status --hostname github.com
```

The tool uses the currently active GitHub CLI identity. `GH_TOKEN` / `GITHUB_TOKEN`, if configured in the environment, may also affect which identity is used. To switch accounts, the user must switch accounts through GitHub CLI. Being signed in to a browser or Git does not mean GitHub CLI is signed in.

The tool does not request, print, or save GitHub tokens; GitHub CLI manages credentials. Do not put a token in the report, plugin source, or chat. This feature does not require EDA to be open, a connection to the command proxy, or an `instanceId`.

## Report format

All fields are strings. Required: `title`, `pluginVersion`, `edaVersion`, `os`, `steps`, `expected`, `actual`. Optional: `command`, `evidence`. Other fields are not supported and will not be silently discarded.

```json
{
  "title": "[问题] 保存后返回成功，但目标文本仍存在",
  "pluginVersion": "0.10.87",
  "edaVersion": "未知",
  "os": "Windows 11",
  "steps": "1. 打开测试图页\n2. 执行删除目标文本\n3. 保存后重新读取目标",
  "expected": "目标文本被删除，读回确认不存在。",
  "actual": "返回成功，但读回仍存在。此处仅为格式示例，不是真实缺陷证据。",
  "command": "schematic.delete；对象标识已替换",
  "evidence": "只放与问题有关且已脱敏的错误片段。"
}
```

The sample above demonstrates the format only. Do not submit it as a real issue. `evidence` is body text; attachments and file paths are not read automatically. Use one report per issue and avoid duplicate reports for an issue that has already been recorded.

## Preview and submit

Run these commands from the plugin repository directory containing `bridge`. The `--file` option points to the report created by the AI:

```powershell
node bridge/report-issue.mjs preview --file "$env:TEMP\aicommand-issue.json"
node bridge/report-issue.mjs submit --file "$env:TEMP\aicommand-issue.json"
```

`preview` performs local format validation and renders the body without going online. `submit` publicly creates an Issue: it first checks GitHub CLI login, submits the report, then reads the created Issue back by number and checks its title, body, and link. Calls are fixed to `github.com/quhuii-lgtm/easyeda-aicommand`; they do not use another repository from the current directory.

Exit code 0 means the operation succeeded. For a non-zero exit code, read the JSON error result. There is no automatic login, retry, or background resubmission. An unknown submission result does not mean that no Issue was created.

The GitHub web form is in `.github/ISSUE_TEMPLATE/bug_report.yml` in the repository and uses the same information fields. Web submissions and API submissions are validated separately; the web form does not replace this tool's input validation.

## Verification limits

Local simulation: `node test/issue-report-regression.mjs`. The simulation does not create a public Issue and cannot replace verification using a real GitHub login and network connection.

Official references: [GitHub CLI login](https://cli.github.com/manual/gh_auth_login), [GitHub CLI API](https://cli.github.com/manual/gh_api), [Create an Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue).
