# Findings & Decisions

## Requirements
- 基于现有代码重新整理文件目录分层和架构设计。
- 优先一次到位，但要基于现有实现而不是凭空设计。
- 需要兼顾长期可维护性，不能只做表层文件搬运。

## Research Findings
- 仓库是一个 TypeScript ESM CLI 工具，入口为 `src/cli.ts`，构建产物在 `dist/`。
- 当前 `src` 下已有 `change-analysis`、`git`、`providers` 三个子目录，但 `briefs.ts`、`commands.ts`、`openai.ts`、`prompt.ts`、`loading-state.ts`、`model-log.ts` 等核心流程模块仍平铺在根目录。
- `src/cli.ts` 体量很大，既处理 UI/交互，也处理 env/profile、命令分发、调用编排，说明目前最主要的问题不只是目录平铺，还存在入口聚合过多职责。
- `env.ts` 和 `model-log.ts` 都依赖 `import.meta.url` 反推项目根目录，因此目录迁移时必须同步修正 `PROJECT_ROOT` 计算。
- `providers` 与 `change-analysis` 已经是相对稳定的目录边界，本轮更适合先吸收平铺文件，而不是同时重写这两个子系统。
- 目录分层重构完成后，`gai` 的 summary 仍会把 `loading-state` 这类文件迁移误写成“交互反馈调整”，说明当前总结偏差主要来自 IR 表达能力不足和 prompt 主题诱导过强。
- 现有 IR 只表达 `added / removed / renamed / updated`，不足以区分“纯迁移”“架构重组”“契约变化”“行为变化”。
- 当前仅在 Git 显式给出 `Rxxx` rename 时能较好识别文件迁移；若变更表现为 `D + A`，系统不能稳定判断这只是 relocation。
- fallback 仍承担主题推断职责，会放大 prompt 的误判，违背“通用性 CR 总结助手”的目标。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 采用“运行层 + 领域层”混合分层 | 现有代码既有稳定领域模块，也有明显的 CLI 应用层职责，单纯按类型工具拆分不够 |
| 新增 `app / application / domain / infrastructure` 四层 | 能把原根目录文件按职责归位，同时不打断既有目录 |
| 在第二轮移除根目录兼容出口 | 运行时代码已完成切换，测试也可以直接依赖真实目录 |
| 用 `docs/architecture.md` 固化依赖方向 | 避免目录整理后再次回到无边界状态 |
| IR 扩展为证据优先的通用语义层 | 让 prompt 和 fallback 都消费统一事实，而不是重复猜主题 |
| 新增 `primaryIntent` 与 `hasPureRelocations` 总览字段 | 给 summary 一条稳定的高层叙事主线 |
| 在 patch 级别补充 `D + A` relocation matching | 解决 Git 未识别 rename 时的纯迁移识别问题 |
| prompt 规则改为“无行为证据就不写行为变化” | 避免目录重组被误写成交互或体验优化 |
| fallback 降级为最小兜底 | 只负责格式化 IR 事实，不再主动发明主题 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `src/cli.ts` 内部职责仍然偏重 | 本轮先不拆入口逻辑，只完成外围目录归位与边界文档 |
| 目录迁移会破坏路径推导常量 | 已同步修复 `env.ts` 和 `model-log.ts` 的项目根路径计算 |
| 旧测试夹具缺少 `changeKinds` 等新 IR 字段 | 在 prompt 代码中增加向后兼容兜底，并同步补齐测试夹具 |
| prompt 曾把 `loading-state` 文件迁移解读为交互优化 | 通过 `primaryIntent`、`hasPureRelocations` 和 `behavior` 证据约束修正 |

## Resources
- `/Users/jiangmengqi/Documents/code/commitdoc/src/cli.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/commands.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/app`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/application`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/domain`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/infrastructure`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/change-analysis`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/providers`
- `/Users/jiangmengqi/Documents/code/commitdoc/docs/architecture.md`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/change-analysis/types.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/change-analysis/ir-builder.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/change-analysis/patch-utils.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/domain/prompt.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/src/infrastructure/fallback-suggestion.ts`
- `/Users/jiangmengqi/Documents/code/commitdoc/tests/patch-utils.test.js`
- `/Users/jiangmengqi/Documents/code/commitdoc/tests/briefs-ir.test.js`

## Visual/Browser Findings
- 当前没有视觉资源需要记录。
