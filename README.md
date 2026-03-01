# gai

Generate commit title and summary from git changes, then choose to confirm/regenerate/cancel in an Ink TUI. Confirm action will run `git add -A && git commit && git push`.

## Install

```bash
npm install
npm link
```

## Usage

```bash
gai profiles
gai
```

## Profile Env

The project now uses multi-file env profiles:

- `.env/profiles/*.env` stores one model profile per file
- `.env/active-profile` stores the current active profile name
- `.env/active.env` is the runtime file loaded by the CLI
- `.env/example.env` is the local example template

Built-in profiles:

- `zhipu-glm-4.7`
- `openai-gpt-4.1-mini`
- `openai-compatible-default`

Switch profile with one command:

```bash
gai use zhipu-glm-4.7
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
- `GAI_API_KEY` availability
- model and base URL config
- `~/.zshrc` install status
- whether `gai` can be resolved in zsh

```bash
gai doctor --token
```

This command reports:

- current source: staged or working tree
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
- `GAI_DISABLE_THINKING`

If a value is already configured, pressing enter keeps the current value.
The command edits the current active profile file under `.env/profiles/` and then syncs `.env/active.env`.
When you switch `GAI_PROVIDER`, the default `GAI_BASE_URL`, `GAI_MODEL`, `GAI_FORMAT_MODEL`, and `GAI_DISABLE_THINKING` values will automatically switch to that provider's defaults.

## Model Config

Default configuration uses Zhipu GLM 4.7 coding endpoint:

```env
GAI_PROVIDER=zhipu
GAI_API_KEY=your_zhipu_api_key_here
GAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
GAI_MODEL=glm-4.7
GAI_FORMAT_MODEL=glm-4.7-flash
GAI_DISABLE_THINKING=true
```

The CLI now uses a provider adapter architecture. Current built-in providers:

- `zhipu` (default)
- `openai`
- `openai-compatible`

You can switch providers by changing `GAI_PROVIDER`, `GAI_BASE_URL`, `GAI_MODEL`, and `GAI_API_KEY`.

Example for OpenAI:

```env
GAI_PROVIDER=openai
GAI_API_KEY=your_openai_api_key_here
GAI_BASE_URL=https://api.openai.com/v1
GAI_MODEL=gpt-4.1-mini
GAI_FORMAT_MODEL=gpt-4.1-mini
GAI_DISABLE_THINKING=true
```

If your Zhipu account does not support the coding endpoint for this custom CLI, switch `GAI_BASE_URL` to:

```env
GAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

## Behavior

- Prioritizes staged changes; if none exist, falls back to working tree changes.
- Uses adaptive token control:
  - small changes use incremental patch only
  - medium changes add file summary and selected context
  - large changes compress patch sections and ignore low-value noise files first
- Commit title and summary are generated in Chinese, while commit type keywords remain English, for example: `feat: 切换默认模型为 GLM 4.7`.
- You can choose:
  - `Confirm`: run add + commit + push.
  - `Regenerate`: call model again.
  - `Cancel`: exit without changes.
- During `Confirm`, the terminal shows clear progress for `git add`, `git commit`, and `git push`.
- After `Confirm` succeeds, the CLI exits directly.

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
