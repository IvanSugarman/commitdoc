# Findings & Decisions

## Requirements
- 基于技术文档评估当前实现的完成度、优劣和结构问题
- 以重构为目标给出整体项目优化方案
- 本轮优先输出“改动方案”，不以直接实现为第一目标

## Research Findings
- 项目技术文档位于 `docs/plan.md`，不存在 `doc/` 目录
- 当前仓库是一个 TypeScript CLI 项目，核心代码集中在 `src/`
- `docs/plan.md` 目标是构建分层的 Git 变更分析与上下文压缩流水线，再交给 LLM 生成 commit/summary/CR description
- 当前 `src/cli.ts` 体量很大，混合了 CLI 交互、环境配置、profile 管理、生成流程和执行逻辑，存在明显职责堆叠
- 当前 `src/providers/index.ts` 已具备多 provider 适配能力，这是现有实现里相对完整的扩展点
- `src/git.ts` 已实现忽略低价值文件、路径分组、补丁压缩、上下文补充、语义提示等启发式逻辑，说明项目并非只有“原始 diff + prompt”
- 但当前分析层仍以字符串规则和路径启发式为主，尚未落地文档中的 `--unified=0`、AST 分析、IR builder、CR description 生成
- README 中暴露的能力重点是 `profiles/config/install/doctor` 等工程配套，而不是文档强调的核心分析流水线
- `docs/plan.md` 明确要求输出三类结果：commit title、commit summary、CR description，并允许用户先选择生成哪种 brief；当前 CLI 仅覆盖 commit title + bullets
- `src/cli.ts` 单文件 1009 行，`src/git.ts` 755 行，`src/fallback-suggestion.ts` 760 行，主要复杂度集中在少数大文件
- `tsconfig.json` 当前关闭 `strict`，仓库中也未发现测试文件，工程约束与回归保护偏弱

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 先读取文档、入口、provider 和支撑模块 | 这些模块决定了目标能力、调用链和可扩展性 |
| 先做“设计能力映射”再给重构方案 | 当前更可能是架构偏移而非局部 bug，先判断偏移位置更重要 |
| 把“已实现但实现方式偏弱”和“完全缺失的能力”分开评估 | 这会直接影响重构优先级和改造范围 |
| 推荐渐进式重构 | 当前已有可复用模块，完全重写的回报率不高 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 用户描述中的 `doc` 目录与仓库实际结构不一致 | 以 `docs/plan.md` 作为唯一技术文档基线 |

## Assessment Summary
- 完成度：已完成“commit title + summary + 一键执行 add/commit/push”的可用版本，但仅部分覆盖文档目标
- 优点：已有 token 压缩意识、provider 适配层、fallback 兜底、doctor/config/profile 等工程能力
- 缺点：分析层偏启发式、CLI 入口耦合过高、输出类型不完整、类型与测试保护不足
- 重构重点：先拆架构边界，再补 IR / CR description / 测试，而不是继续在现有大文件上叠加逻辑

## Incremental Plan Summary
- 输入策略已调整为默认混入 staged、working tree 和 untracked files
- 渐进式执行顺序为：先拆主流程边界，再重构分析管线，再补 brief 类型，最后补测试与类型约束
- 每一阶段都应保持 CLI 可用，避免推倒重写

## Long-Term Review Rule
- 后续每次用户要求“检查 / 审视 / 评估 / review”本项目代码时，都需要把当前 `gai` 生成的 `summary` 和 `description` 一并纳入评估
- 评估时必须给出 `summary` 与 `description` 的主观完整度打分，并将该打分作为判断当前实现代码完整度的重要依据
- 如果检查结论涉及生成质量问题，应优先说明是 `summary`、`description` 还是两者同时存在完整度偏差

## Phase 1 Implementation
- 已新增命令解析层 `src/commands.ts`，统一 `gai`、`gai commit`、`gai brief <type>` 等入口语义
- 已新增 `src/briefs.ts`，把 brief 渲染从 CLI 主文件中拆出
- 已将默认改动来源切换为 mixed workspace，并在 CLI / doctor --token / README 中同步文案
- `gai` 现在先选择 brief 类型，再进入生成流程；`gai commit` 可直达提交流
- 当前 `cr-description` 先采用基于现有建议结果的结构化渲染，真正的 IR 驱动生成留到后续阶段

## Phase 2 Implementation
- 已新增 `src/git/workspace.ts`，把 mixed workspace 快照采集和 Git 命令执行从 `src/git.ts` 中抽离
- 已新增 `src/change-analysis/types.ts`，统一摘要输入与分析层类型
- 已新增 `src/change-analysis/patch-utils.ts`，集中处理 name-status 合并、patch 拆分、重命名压缩、补丁统计与代表性样本选择
- 已新增 `src/change-analysis/file-classifier.ts`，集中处理 noise filter、文件角色识别、分组摘要、文件概览与更通用的语义提示
- 已新增 `src/change-analysis/context-extractor.ts`，集中处理高上下文文件摘要
- `src/git.ts` 已收敛为摘要策略与结果编排器，不再承担全部 Git 读取与字符串处理职责
- 已移除原先带 `crawler` 历史假设的语义提示逻辑，当前摘要更偏向通用工程仓库

## Phase 3 Implementation
- 已新增 `src/change-analysis/ast-analyzer.ts`，使用 TypeScript compiler API 提取基础符号与导出信息
- 已新增 `src/change-analysis/ir-builder.ts`，将文件列表、补丁、符号信息、测试线索与风险提示收敛为统一 `ChangeIR`
- `src/change-analysis/types.ts` 已扩展 `ChangeIR` 与 `SummaryChanges.ir`，摘要结果现在内建结构化 IR
- `src/git.ts` 已在摘要编排阶段构建 IR，Prompt 输入从“半结构化 patch 摘要”升级为“IR 优先 + patch 证据”
- `src/prompt.ts` 已新增 `IR_OVERVIEW`、`IR_CHANGES`、`IR_RISKS` 段，模型主路径优先依赖结构化信息
- `src/fallback-suggestion.ts` 已接入 IR 段作为兜底推断来源，避免 fallback 只盯原始 patch
- 当前 AST/IR 是基础版：已能提供文件级 symbol / dependency / risk 信息，但还未细化到 function scope context 与完整契约分类

## Phase 4 Implementation
- `src/briefs.ts` 已从“基于同一份 commit suggestion 做不同展示”升级为真正的 `GeneratedBrief` 协议，覆盖 `commit`、`commit-title`、`commit-summary`、`cr-description`
- `src/prompt.ts` 已按 brief 类型生成不同 JSON schema 约束，Prompt 不再默认只要求 commit suggestion
- `src/fallback-suggestion.ts` 已支持按 brief 类型解析模型输出，并提供 `buildFallbackBrief` / `buildBriefFromReasoning`
- `src/providers/*` 已接入 brief 类型参数，provider 层现在知道自己在生成哪种 brief，而不是统一返回 commit suggestion
- `src/cli.ts` 已改为消费真正的 brief 输出；commit 流程从 `RenderedBrief.commitPayload` 执行 Git，非 commit brief 不再依赖 commit 渲染兜底
- 已通过本地 smoke test 验证四种 brief 在 fallback 路径下都能独立产出结构化结果

## Close-Out Implementation
- 已新增 `tests/commands.test.js`、`tests/patch-utils.test.js`、`tests/briefs-ir.test.js`，覆盖命令解析、patch 工具、IR 构建、brief 解析与 fallback 逻辑
- `package.json` 已新增 `npm test` 与 `npm run verify`，形成可重复执行的验证入口
- `README.md` 已补充 `Validate` 与 `Engineering Notes`，说明当前验证方式和工程取舍
- 修复了 `commit-title` 解析中误删 conventional commit 前缀的问题，验证脚本现已全通过
- 当前仍保留全局 `strict: false`，这是刻意的收尾边界，避免将本轮 refactor 收尾扩展成全面类型治理


## Resources
- `/Users/jiangmengqi/Documents/code/commitdoc/docs/plan.md`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/cli.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/providers`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/git.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/prompt.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/fallback-suggestion.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/tsconfig.json`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/git/workspace.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/change-analysis`

## Visual/Browser Findings
- 本轮未使用视觉或浏览器工具
