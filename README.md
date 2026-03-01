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
- Commit title and summary are generated in Chinese, while commit type keywords remain English, for example: `feat: 切换默认模型为 GLM 4.7`.
- You can choose:
  - `Confirm`: run add + commit + push.
  - `Regenerate`: call model again.
  - `Cancel`: exit without changes.
- During `Confirm`, the terminal shows clear progress for `git add`, `git commit`, and `git push`.

## Notes

- If neither staged nor working tree changes exist, command exits with error.
- Push requires current branch remote tracking configured.
