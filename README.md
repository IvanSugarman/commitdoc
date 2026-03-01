# gai

Generate commit title and summary from git changes, then choose to confirm/regenerate/cancel in an Ink TUI. Confirm action will run `git add -A && git commit && git push`.

## Install

```bash
npm install
npm link
```

## Usage

```bash
cp .env.example .env
# set GAI_API_KEY in .env
gai
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
- `.env` existence
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

- `GAI_API_KEY`
- `GAI_BASE_URL`
- `GAI_MODEL`

If a value is already configured, pressing enter keeps the current value.

## Model Config

Default configuration uses Zhipu GLM 4.7 coding endpoint:

```env
GAI_API_KEY=your_zhipu_api_key_here
GAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
GAI_MODEL=glm-4.7
```

The CLI uses OpenAI-compatible chat completions, so you can switch providers later by changing `GAI_BASE_URL`, `GAI_MODEL`, and `GAI_API_KEY`.

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
