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

## Do Not Use RTK For

Do not use `rtk` for these commands:

```bash
npx playwright ...
playwright ...
Get-Content -Raw ...
type ...
```

Reasons:

- Playwright output can be filtered incorrectly.
- Chinese text can become garbled.

Use PowerShell 7 (`pwsh`) for raw commands:

```bash
pwsh -NoProfile -Command "Get-Content -Raw 'README.md'"
pwsh -NoProfile -Command "npx playwright test --config playwright.config.ts --list --reporter=line"
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

## PowerShell Builtins

Use PowerShell 7 only.

- Use `pwsh`, never `powershell`.
- Use `rtk pwsh`, never `rtk powershell`.

Bad:

```bash
rtk Get-Content -Raw README.md
rtk powershell -NoProfile -Command "Get-Content -Raw 'README.md'"
powershell -NoProfile -Command "Get-Content -Raw 'README.md'"
```

Good:

```bash
pwsh -NoProfile -Command "Get-Content -Raw 'README.md'"
rtk pwsh -NoProfile -Command "git status --short"
```

`powershell` starts Windows PowerShell 5.1 on Windows.

## Rule

When RTK output looks suspicious, verify with a raw command. Use `rtk proxy` only for commands where encoding and structured output are not a concern.
