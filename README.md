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
# set OPENAI_API_KEY in .env
gai
```

## Behavior

- Prioritizes staged changes; if none exist, falls back to working tree changes.
- Commit title is normalized to: `feat: ...`, `fix: ...`, or `chore: ...`.
- You can choose:
  - `Confirm`: run add + commit + push.
  - `Regenerate`: call model again.
  - `Cancel`: exit without changes.

## Notes

- If neither staged nor working tree changes exist, command exits with error.
- Push requires current branch remote tracking configured.
