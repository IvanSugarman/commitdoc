# gai

Generate workspace briefs from git changes in an Ink TUI. The CLI can generate commit title, commit summary, and CR description. Commit flow can confirm and run `git add -A && git commit && git push`.

## Install

```bash
npm install
npm link
```

## Validate

```bash
npm run typecheck
npm test
npm run verify
```

## Usage

```bash
gai profiles
gai
gai commit
gai brief commit-title
gai brief commit-summary
gai brief cr-description
```

## Profile Env

The project now uses multi-file env profiles:

- `.env/profiles/*.env` stores one model profile per file
- `.env/active-profile` stores the current active profile name
- `.env/active.env` is the runtime file loaded by the CLI
- `.env/example.env` is the local example template

Built-in profiles:

- `ark-coding-plan`
- `zhipu-glm-4.7`
- `openai-gpt-4.1-mini`
- `openai-compatible-default`

Switch profile with one command:

```bash
gai use ark-coding-plan
gai use openai-gpt-4.1-mini
```

## Shell Install

```bash
gai install
```

This command will:

- append a `gai` shell function to `~/.zshrc`
- verify the command in a fresh zsh subprocess
- print a reminder to run `source ~/.zshrc` if your current shell has not reloaded yet

## Doctor

```bash
gai doctor
```

This command checks:

- Node.js version
- Git availability
- current Git repository status
- `.env/active.env` existence
- `GAI_API_KEY` / `OPENAI_API_KEY` availability
- model and base URL config
- `~/.zshrc` install status
- whether `gai` can be resolved in zsh

```bash
gai doctor --token
```

This command reports:

- current source: mixed workspace, staged, or working tree
- selected strategy: incremental, contextual, or compressed
- changed file count and ignored file count
- patch / prompt character size
- estimated input token usage

## Config

```bash
gai config
```

This command interactively writes:

- `GAI_PROVIDER`
- `GAI_API_KEY`
- `GAI_BASE_URL`
- `GAI_MODEL`
- `GAI_FORMAT_MODEL`
- `GAI_ENABLE_THINKING`

If a value is already configured, pressing enter keeps the current value.
The command edits the current active profile file under `.env/profiles/` and then syncs `.env/active.env`.
When you switch `GAI_PROVIDER`, the default `GAI_BASE_URL`, `GAI_MODEL`, `GAI_FORMAT_MODEL`, and `GAI_ENABLE_THINKING` values will automatically switch to that provider's defaults.

## Model Config

Default configuration uses Volcengine Ark Coding Plan:

```env
GAI_PROVIDER=ark
GAI_API_KEY=
GAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
GAI_MODEL=ark-code-latest
GAI_FORMAT_MODEL=ark-code-latest
GAI_ENABLE_THINKING=false
```

The CLI now uses a provider adapter architecture. Current built-in providers:

- `ark` (default)
- `zhipu`
- `openai`
- `openai-compatible`

The runtime reads `GAI_API_KEY` first and falls back to `OPENAI_API_KEY`.

You can switch providers by changing `GAI_PROVIDER`, `GAI_BASE_URL`, `GAI_MODEL`, and `GAI_API_KEY`.

Example for OpenAI:

```env
GAI_PROVIDER=openai
GAI_API_KEY=your_openai_api_key_here
GAI_BASE_URL=https://api.openai.com/v1
GAI_MODEL=gpt-4.1-mini
GAI_FORMAT_MODEL=gpt-4.1-mini
GAI_ENABLE_THINKING=false
```

If your Zhipu account does not support the coding endpoint for this custom CLI, switch `GAI_BASE_URL` to:

```env
GAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

## Behavior

- Default input source is mixed workspace:
  - staged changes
  - unstaged working tree changes
  - untracked files
- Uses adaptive token control:
  - small changes use incremental patch only
  - medium changes add file summary and selected context
  - large changes compress patch sections and ignore low-value noise files first
- `gai` first lets you choose which brief type to generate.
- `gai commit` generates commit title and summary in Chinese, while commit type keywords remain English, for example: `feat: 切换默认模型为 GLM 4.7`.
- `gai brief commit-title` only generates commit title.
- `gai brief commit-summary` only generates commit summary.
- `gai brief cr-description` generates a structured CR description preview.
- You can choose:
  - `Confirm`: accept current result. In commit flow it will run add + commit + push.
  - `Regenerate`: call model again.
  - `Back`: return to brief selection.
  - `Cancel`: exit without changes.
- During `Confirm`, the terminal shows clear progress for `git add`, `git commit`, and `git push`.
- After `Confirm` succeeds, the CLI exits directly.

## Engineering Notes

- The analysis pipeline now follows `workspace snapshot -> change analysis -> IR -> prompt / fallback`.
- Brief generation is type-specific:
  - `commit`
  - `commit-title`
  - `commit-summary`
  - `cr-description`
- The project currently keeps global TypeScript `strict` disabled to avoid turning the refactor close-out into a broad compile-fix pass.
- Regression coverage currently focuses on:
  - command parsing
  - patch utilities
  - IR generation
  - brief parsing and fallback generation

## Notes

- If neither staged nor working tree changes exist, command exits with error.
- Push requires current branch remote tracking configured.

## Migration

On another machine, the basic setup flow is:

```bash
npm install
gai config
gai install
gai doctor
```
