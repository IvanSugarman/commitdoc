# gai

在 Ink TUI 中基于 Git 变更生成工作区摘要。CLI 支持生成 commit title、commit summary 和 CR description；在 commit 流程中确认后会执行 `git add -A && git commit && git push`。

## 安装

```bash
npm install
npm link
```

## 校验

```bash
npm run typecheck
npm test
npm run verify
```

## 使用方式

```bash
gai profiles
gai
gai commit
gai brief commit-title
gai brief commit-summary
gai brief cr-description
```

## 核心结构

CLI 当前采用分层流水线：

1. `workspace snapshot`
   - 收集 staged、unstaged 和 untracked 变更
2. `change analysis`
   - 过滤噪音文件
   - 进行文件分类与优先级排序
   - 构建 semantic hints 和 IR
3. `prompt assembly`
   - 基于结构化证据构建不同 brief 的 prompt
4. `provider execution`
   - 将 prompt 发送给 Ark / Zhipu / OpenAI-compatible provider
5. `response parsing`
   - 解析模型返回的 JSON
   - 对轻微 schema 漂移做恢复
   - 仅在解析失败或返回内容不可用时才 fallback

关键模块：

- `src/cli.ts`
  - Ink TUI 入口
  - 命令分发
  - loading / submitting 面板
  - doctor 与 debug 输出
- `src/git.ts`
  - workspace snapshot
  - summary 组装
  - 自适应策略选择
- `src/change-analysis/*`
  - patch 解析
  - 文件分类
  - 上下文提取
  - AST / IR 构建
- `src/prompt.ts`
  - system prompt
  - 不同 brief 的 prompt builder
  - prompt section 组装
- `src/fallback-suggestion.ts`
  - response parser
  - malformed JSON 恢复
  - fallback brief 生成
- `src/providers/*`
  - provider adapter
  - usage 归一化
  - brief cache 行为
- `src/model-log.ts`
  - model request log
  - pipeline state log
  - JSON cache helper
- `src/briefs.ts`
  - brief render model
  - commit payload 提取
- `src/commands.ts`
  - CLI 命令解析
  - help text

## Profile Env

项目当前使用多文件 env profile：

- `.env/profiles/*.env`：每个文件对应一个 model profile
- `.env/active-profile`：记录当前激活的 profile 名称
- `.env/active.env`：CLI 运行时加载的文件
- `.env/example.env`：本地示例模板

内置 profile：

- `ark-coding-plan`
- `zhipu-glm-4.7`
- `openai-gpt-4.1-mini`
- `openai-compatible-default`

切换 profile：

```bash
gai use ark-coding-plan
gai use openai-gpt-4.1-mini
```

## Shell 安装

```bash
gai install
```

该命令会：

- 向 `~/.zshrc` 追加 `gai` shell function
- 在全新的 zsh 子进程中校验命令可用性
- 如果当前 shell 尚未重载，会提示执行 `source ~/.zshrc`

## Doctor

```bash
gai doctor
```

该命令会检查：

- Node.js 版本
- Git 是否可用
- 当前 Git 仓库状态
- `.env/active.env` 是否存在
- `GAI_API_KEY` / `OPENAI_API_KEY` 是否可用
- model 和 base URL 配置
- `~/.zshrc` 安装状态
- `gai` 是否能在 zsh 中被解析

```bash
gai doctor --token
```

该命令会输出：

- 当前 source：mixed workspace、staged 或 working tree
- 当前选择的策略：incremental、contextual 或 compressed
- 改动文件数与忽略文件数
- patch / prompt 字符规模
- 预估输入 token 使用量

```bash
gai doctor --debug
gai doctor --debug --brief commit-summary
gai doctor --debug --section ir
gai doctor --debug --brief cr-description --section context
```

该命令会输出当前 provider 下的开发者调试视图。它不会实际调用模型，而是打印预计发送给模型的完整 prompt 内容。

支持的调试筛选项：

- `--brief <type>`
  - 仅输出单个 brief 的 prompt
  - 支持值：`commit`、`commit-title`、`commit-summary`、`cr-description`
- `--section <section>`
  - 仅输出 prompt 的某个 section
  - 支持值：
    - `meta`：provider、source、strategy、output profile 相关 block
    - `system`：仅输出 system prompt
    - `rules`：首个 prompt block 之前的输出规则
    - `ir`：`IR_OVERVIEW`、`IR_CHANGES`、`IR_RISKS`、`MODULE_CLUSTERS`、`PRIMARY_CHANGES`、`THEME_CHECKLIST`
    - `context`：`NARRATIVE_HINT`、`ACTION_CHECKLIST`、`SEMANTIC_HINTS`、`FILES_OVERVIEW` 等叙事和辅助上下文 block
    - `patch`：`PATCH_SUMMARY` 和 `PATCH`
    - `prompt`：所选 brief 的完整 user prompt

典型调试流程：

1. `gai doctor --debug --brief commit-summary`
   - 检查最终 user prompt
2. `gai doctor --debug --brief commit-summary --section ir`
   - 验证 IR 证据是否已经抓住正确主线
3. `gai doctor --debug --brief cr-description --section context`
   - 检查 narrative guidance、review focus、semantic hints 和 file overview

## Config

```bash
gai config
```

该命令会以交互方式写入：

- `GAI_PROVIDER`
- `GAI_API_KEY`
- `GAI_BASE_URL`
- `GAI_MODEL`
- `GAI_FORMAT_MODEL`
- `GAI_ENABLE_THINKING`

如果某个值已经存在，直接回车会保留当前值。
该命令会修改 `.env/profiles/` 下当前激活的 profile 文件，并同步 `.env/active.env`。
当你切换 `GAI_PROVIDER` 时，默认的 `GAI_BASE_URL`、`GAI_MODEL`、`GAI_FORMAT_MODEL` 和 `GAI_ENABLE_THINKING` 也会一起切换到对应 provider 的默认值。

## Model Config

默认配置使用 Volcengine Ark Coding Plan：

```env
GAI_PROVIDER=ark
GAI_API_KEY=
GAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
GAI_MODEL=ark-code-latest
GAI_FORMAT_MODEL=ark-code-latest
GAI_ENABLE_THINKING=false
```

CLI 当前采用 provider adapter 架构。内置 provider：

- `ark` (default)
- `zhipu`
- `openai`
- `openai-compatible`

运行时优先读取 `GAI_API_KEY`，其次回退到 `OPENAI_API_KEY`。

你可以通过修改 `GAI_PROVIDER`、`GAI_BASE_URL`、`GAI_MODEL` 和 `GAI_API_KEY` 来切换 provider。

OpenAI 示例：

```env
GAI_PROVIDER=openai
GAI_API_KEY=your_openai_api_key_here
GAI_BASE_URL=https://api.openai.com/v1
GAI_MODEL=gpt-4.1-mini
GAI_FORMAT_MODEL=gpt-4.1-mini
GAI_ENABLE_THINKING=false
```

如果你的 Zhipu 账号不支持这套 CLI 使用的 coding endpoint，可以将 `GAI_BASE_URL` 改为：

```env
GAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

## 行为说明

- 默认输入源是 mixed workspace：
  - staged changes
  - unstaged working tree changes
  - untracked files
- 使用自适应 token 控制：
  - 小改动只发送 incremental patch
  - 中等改动增加 file summary 和部分 context
  - 大改动优先压缩 patch section，并忽略低价值噪音文件
- `gai` 会先让你选择要生成的 brief 类型。
- `gai commit` 会生成中文 commit title 和 summary，但 commit type keyword 保持 English，例如：`feat: 切换默认模型为 GLM 4.7`。
- `gai brief commit-title` 仅生成 commit title。
- `gai brief commit-summary` 仅生成 commit summary。
- `gai brief cr-description` 生成结构化的 CR description 预览。
- 你可以选择：
  - `Confirm`：接受当前结果；在 commit 流程中会执行 add + commit + push
  - `Regenerate`：重新调用模型
  - `Back`：返回 brief 选择
  - `Cancel`：退出且不做修改
- 在 `Confirm` 期间，终端会展示 `git add`、`git commit` 和 `git push` 的清晰进度。
- `Confirm` 成功后 CLI 会直接退出。

## 工程说明

- 分析流水线当前是 `workspace snapshot -> change analysis -> IR -> prompt / fallback`。
- Brief 生成按类型分流：
  - `commit`
  - `commit-title`
  - `commit-summary`
  - `cr-description`
- 项目当前保持全局 TypeScript `strict` 关闭，避免将重构收尾演变成大规模 compile-fix。
- 当前回归测试重点覆盖：
  - command parsing
  - patch utilities
  - IR generation
  - brief parsing 与 fallback generation

## Prompt Modules

发送给模型的 prompt 分为固定的 system layer 和结构化的 user layer。

System layer：

- `BASE_SYSTEM_PROMPT`
  - 定义 code review 视角
  - 强调 intent、impact、risk 和 test coverage

User layer：

- `OUTPUT_PROFILE`
  - 根据改动规模控制输出密度
- `NARRATIVE_HINT`
  - 提供高层叙事主线
- `ACTION_CHECKLIST`
  - 引导输出偏向工程动作，而不是文件清单
- `REVIEWER_FOCUS_TEMPLATE`
  - 约束 reviewer focus，围绕兼容性、缓存、解析和回归风险展开
- `USER_VISIBLE_SURFACES`
  - 在存在时强调用户可感知的行为变化
- `IR_OVERVIEW`
  - 全局变更统计
- `IR_CHANGES`
  - 结构化的文件级语义变化
- `IR_RISKS`
  - 从工作区推断出的潜在 review 风险
- `MODULE_CLUSTERS`
  - 模块级分组映射
- `PRIMARY_CHANGES`
  - 最高优先级的改动
- `THEME_CHECKLIST`
  - 模型应尽量覆盖的主题
- `FILES_OVERVIEW`, `FILE_SUMMARY`, `NAME_STATUS`, `TEST_FILES`
  - 辅助性的文件级证据
- `PATCH_SUMMARY`, `PATCH`
  - 低层 diff 证据，仅作为补充而非主叙事来源

## Notes

- 如果 staged 和 working tree 都没有改动，命令会直接报错退出。
- `push` 依赖当前分支已配置 remote tracking。

## 迁移

在另一台机器上的基础初始化流程：

```bash
npm install
gai config
gai install
gai doctor
```
