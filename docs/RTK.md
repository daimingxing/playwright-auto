# RTK - Rust Token Killer (Codex CLI)

**Usage**: Token-optimized CLI proxy for shell commands.

## Default Rule

Use `rtk` for compact, low-risk command output.

Examples:

```bash
rtk git status --short
rtk git diff --stat
rtk rg "keyword"
rtk npm run lint
rtk npm run test
rtk npm run build
```

## PowerShell

Use PowerShell 7 only.

- Use `pwsh`, never `powershell`.
- Use `rtk pwsh`, never `rtk powershell`.

```bash
pwsh -NoProfile -Command "Get-Content -Raw 'README.md'"
rtk pwsh -NoProfile -Command "Get-Content -Raw 'README.md'"
```

`powershell` starts Windows PowerShell 5.1 on Windows and can garble UTF-8 Chinese text.

## Verify Suspicious Output

When RTK output looks suspicious, verify with raw `pwsh` or `rtk proxy`.

Examples:

```bash
pwsh -NoProfile -Command "npx playwright test --config playwright.config.ts --list --reporter=line"
rtk proxy git diff -- path/to/file
```

## Exact Git Output

Use raw commands or `rtk proxy` when exact git output is needed:

```bash
git show ...
git diff -- path/to/file
rtk proxy git show ...
rtk proxy git diff -- path/to/file
```

Keep using `rtk` for summaries:

```bash
rtk git status --short
rtk git diff --stat
```

## Do Not Use

Bad:

```bash
rtk Get-Content -Raw README.md
rtk powershell -NoProfile -Command "Get-Content -Raw 'README.md'"
powershell -NoProfile -Command "Get-Content -Raw 'README.md'"
```

## Rule

Prefer `rtk` by default. Enforce `pwsh` for all PowerShell commands. Verify questionable output with raw `pwsh` or `rtk proxy`.
