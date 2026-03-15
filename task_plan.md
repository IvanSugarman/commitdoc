# Task Plan: Assess docs alignment and refactor plan

## Goal
基于 `docs/plan.md` 对比当前项目实现，评估功能完成度、实现优劣与结构问题，并输出以重构为目标的分阶段改动方案。

## Current Phase
Phase 5

## Phases
### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Implementation Assessment
- [x] Read technical documentation and map target architecture
- [x] Inspect current code paths and module boundaries
- [x] Evaluate completion, strengths, and weaknesses
- **Status:** complete

### Phase 3: Refactor Planning
- [x] Identify highest-leverage refactor themes
- [x] Propose phased change plan with scope and risks
- [x] Define validation strategy
- **Status:** complete

### Phase 4: Review & Delivery
- [x] Review conclusions against source files
- [x] Ensure plan is actionable and prioritized
- [x] Deliver assessment and refactor plan to user
- **Status:** complete

### Phase 5: Engineering Close-Out
- [x] Add regression tests for core modules
- [x] Add repeatable verification scripts
- [x] Sync README and current validation strategy
- **Status:** complete

## Key Questions
1. `docs/plan.md` 定义的目标能力，当前实现覆盖到了哪些部分？
2. 当前代码结构的主要问题是功能缺失、抽象失衡，还是工程化能力不足？
3. 如果以重构为目标，最小可落地且收益最高的切入顺序是什么？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 以 `docs/plan.md` 作为主要设计基线 | 用户明确要求基于技术文档做对照评估 |
| 本轮优先产出方案而非直接大规模改代码 | 用户要求“优先输出改动方案” |
| 以“能力缺口 + 结构债务 + 工程保障”三层输出重构方案 | 便于区分产品缺失与代码治理问题 |
| Phase 1 先落命令语义与 mixed workspace 默认输入 | 这是后续重构的产品边界前提 |
| 收尾阶段优先补测试与验证脚本，不强行开启全局 strict | 避免把收尾扩展成大规模编译修复工程 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `doc` 目录不存在，实际为 `docs` | 1 | 改用 `docs/plan.md` 继续分析 |

## Notes
- 先完成文档与代码映射，再输出重构建议
- 避免在未读源码前给出具体重构结论
- 当前结论指向渐进式重构，而非推倒重写
