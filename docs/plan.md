技术方案：LLM 驱动的 Git Code Change Summary & Commit Assistant

1. 项目目标

构建一个 本地 CLI 工具，利用大模型对 **git staged changes（暂存区代码变更）**进行分析和总结，并协助完成开发流程中的以下步骤：1. 自动分析当前 git 暂存区代码变更 2. 生成高质量代码变更总结 3. 生成 commit message 4. 生成 Code Review Description 5. 在用户确认后执行：

git add
git commit
git push

该工具主要解决的问题：
• 提高 commit message 和 CR Description 质量
• 减少开发者手写 commit message 的时间
• 提供可读性强的代码变更总结
• 为 code review 提供结构化说明

工具运行环境：
• 本地 CLI
• Node.js / TypeScript
• Git 仓库环境
⸻

2. 核心设计原则

2.1 Token 成本优化

模型输入必须经过压缩处理，不直接传递完整 diff。

采用 Context Engineering Pipeline：

Raw Git Diff
↓
Noise Filtering
↓
Change Extraction
↓
Intermediate Representation (IR)
↓
LLM Summarization

核心策略：1. 仅分析 git staged diff 2. 优先使用

git diff --cached --unified=0

只获取变更行 3. 根据文件重要程度进行 上下文补充 4. 通过 AST / 语义分析提取核心变更 5. 构建结构化 IR，再交给 LLM

⸻

3. 系统整体架构

系统整体结构：

CLI Layer
│
├── Git Layer
│ ├── staged diff reader
│ ├── git stats
│ └── file change metadata
│
├── Change Analysis Layer
│ ├── diff parser
│ ├── noise filter
│ ├── AST analyzer
│ └── context extractor
│
├── Context Compression Layer
│ ├── change summarizer
│ ├── file priority scoring
│ └── IR builder
│
├── LLM Layer
│ ├── summary generation
│ ├── commit title generation
│ └── CR description generation
│
└── Execution Layer
├── preview
├── git commit
└── git push

⸻

4. 核心数据流

完整流程：

git staged diff
↓
collect change metadata
↓
filter noise
↓
extract semantic change
↓
build intermediate representation
↓
LLM summarization
↓
generate commit message
↓
generate CR description
↓
user confirm
↓
git commit + git push

⸻

5. Token 优化策略

5.1 Diff 读取策略

读取 staged diff：

git diff --cached --name-only
git diff --cached --numstat
git diff --cached --unified=0

得到：
• 修改文件列表
• 新增/删除行数
• diff hunks

⸻

5.2 Noise Filtering

以下内容在本地过滤或压缩：

低价值变更：
• formatting changes
• import reorder
• whitespace
• lockfile changes
• generated files
• snapshot files

例如：

pnpm-lock.yaml → summarized as dependency changes

⸻

5.3 文件优先级策略

根据路径决定上下文预算：

高优先级：
src/
service/
controller/
api/
schema/
db/

中优先级：
tests/
types/
docs/

低优先级：

lockfile
dist
generated
coverage

⸻

5.4 上下文补充策略

第一阶段：

读取最小 diff：
--unified=0

第二阶段：
对关键文件补充：
±30 lines around hunk
function scope
class scope

⸻

5.5 AST 分析（JS / TS）
对于 TypeScript / JavaScript 文件：

使用：
typescript compiler API
ts-morph
babel parser

提取：
• modified functions
• modified classes
• exported symbols
• signature changes
• dependency changes

示例：

symbols_changed:

- function getUserList
- class UserService

⸻

6. Intermediate Representation (IR)
   为了减少模型输入，需要构建中间数据结构。
   示例：
   {
   "overview": {
   "files_changed": 6,
   "added_lines": 120,
   "deleted_lines": 34
   },
   "changes": [
   {
   "file": "src/user/service.ts",
   "type": "logic",
   "symbols": ["getUserList"],
   "summary": "added retry logic for user list request"
   },
   {
   "file": "src/user/types.ts",
   "type": "contract",
   "symbols": ["UserDTO"],
   "summary": "added optional status field"
   }
   ],
   "tests": [
   "__tests__/user.test.ts"
   ]
   }

LLM 只读取 IR + 少量关键代码片段。
⸻

7. LLM 输出设计

系统需要生成三种输出。
⸻

7.1 Commit Title
示例：
feat(user): add retry logic and improve empty state handling

要求：
• 1 行
• 符合 conventional commit

⸻
7.2 Commit Summary
示例：

- add retry handling for user list requests
- improve empty state rendering logic
- update related tests and types

用于：
• commit body
• CLI preview

⸻

7.3 CR Description
输出结构必须固定模板：

## Change Purpose

Explain why this change is needed.

## Key Changes

- change 1
- change 2

## Impact Scope

- modules
- API
- schema
- configs

## Reviewer Focus

Potential risks or tricky logic.

## Testing & Validation

Explain how the change was verified.

⸻

8. CLI 设计
   遵循现有 Cli 设计，先允许用户选择生成哪种类型的 brief

⸻

9. Prompt 输入结构

9.1 System Prompt

你是一名资深软件工程师，拥有丰富的代码评审（Code Review）、软件架构设计以及团队协作开发经验。

你的任务是分析来自 Git 仓库的代码变更，并生成高质量的工程总结，帮助其他开发者快速理解这次代码变更的目的、影响范围以及潜在风险。

请以一名经验丰富的代码评审者的视角进行分析，就像在评审一个 Pull Request 或 Merge Request 一样。

你的分析重点应放在 **理解变更的意图（intent）和系统影响（impact）**，而不仅仅是复述代码差异。

在分析代码变更时，请优先识别以下内容：

• 这次变更的主要目的是什么  
• 系统行为或功能是否发生变化  
• 是否涉及公共 API、数据结构或接口契约的变化  
• 是否对系统架构或模块职责产生影响  
• 是否可能引入潜在风险或副作用  
• 测试代码是否与行为变化相匹配

不要机械地列出修改了哪些文件，也不要逐行复述 diff 内容。

相反，请将代码变更提炼为一个清晰的工程总结，说明：

- 这次改动解决了什么问题
- 为什么需要这个改动
- 改动对系统产生了什么影响

在分析过程中，请遵循以下原则：

1. 优先关注 **系统行为的变化**，而不是简单的代码修改。
2. 尝试根据实现方式推断 **变更背后的工程目的**。
3. 指出 **代码评审者需要重点关注的部分**。
4. 识别可能的 **边界情况、回归风险或副作用**。
5. 如果涉及测试代码变更，需要评估测试是否覆盖了新的行为。

你的表达应该：

- 精确
- 专业
- 简洁

风格应类似成熟工程团队中资深工程师撰写的 commit message 或 Pull Request 描述。

避免：

- 冗长的解释
- 无根据的猜测
- 编造问题或风险

只有在代码变更能够合理推断出风险时，才进行提示。

最终输出应清晰、有结构，并面向需要进行代码评审的工程师阅读。
在合理的情况下，可以指出代码评审者可能需要关注的潜在风险或边界情况。

例如：

- 接口契约变化
- 重试逻辑可能带来的副作用
- 并发或状态一致性问题

但不要编造不存在的问题。

⸻

11. 性能优化

1 并行分析

本地分析：

file diff
AST parsing
context extraction

并行执行

⸻

2 LLM 调用减少

仅调用一次 LLM：

IR → summary

⸻

3 Cache

缓存：

blob SHA → AST summary
diff hash → LLM result
