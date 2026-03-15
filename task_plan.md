# Task Plan: Generalize CR Summarization

## Goal
在已完成目录分层重构的基础上，把 `gai` 的 CR 总结链路收敛为“Evidence-first IR -> Generic prompt -> Minimal fallback”，减少 fallback 和仓库特异处理，提升对目录迁移 / 架构重组场景的总结准确度。

## Current Phase
Phase 5

## Phases
### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define technical approach
- [x] Create target directory structure
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Reorganize files and imports step by step
- [x] Preserve CLI behavior and public commands
- [x] Keep changes reviewable and incremental
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Verify build and typecheck path
- [x] Document verification status in progress.md
- [x] Fix any issues found
- **Status:** complete

### Phase 5: Delivery
- [x] Review touched files
- [x] Summarize architecture changes and remaining risks
- [ ] Deliver outcome to user
- **Status:** in_progress

## Key Questions
1. 当前 summary 跑偏的根因在 prompt、IR 还是 fallback？
2. 仅靠 Git `Rxxx` rename 是否足以支持“纯迁移”判断？
3. 如何在不继续堆路径特判的前提下，让 summary 稳定识别“架构重组而非行为变更”？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 主题判断前移到 IR | 让 prompt 组织语言而不是继续猜测代码意图 |
| 为迁移场景增加 `relocation` / `structure` / `behavior` 语义 | 通用 CR 助手需要的是证据，而不是仓库路径特判 |
| fallback 只保留兜底格式化职责 | 降低主模型失手时的二次误判概率 |
| 为 `D + A` 增加纯迁移识别 | Git 未识别 rename 时仍要能判断“仅转移文件” |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- 本轮改造不再增加新的仓库特异 prompt 规则，而是优先补足 IR 事实表达能力。
- 架构重组场景下，summary 必须优先解释目录分层、职责迁移和边界收敛，不能把文件迁移虚构成用户交互变化。
- 已完成类型检查、构建和测试验证，后续仍可继续提升 relocation 相似度匹配策略。
