# 项目架构分层

## 目标

本轮重构以“先收敛职责边界，再逐步拆分超大入口”为原则，先把原来平铺在 `src/` 根目录的核心实现迁移到明确分层中，同时保留根目录兼容出口，避免一次性打断 CLI 入口、测试路径和外部引用。

## 当前目录分层

```text
src
├── app
│   ├── commands.ts
│   └── loading-state.ts
├── application
│   └── git-summary.ts
├── change-analysis
├── domain
│   ├── briefs.ts
│   └── prompt.ts
├── git
│   └── workspace.ts
├── infrastructure
│   ├── env.ts
│   ├── fallback-suggestion.ts
│   ├── model-log.ts
│   └── openai.ts
├── providers
└── cli.ts
```

## 分层职责

### `app`

- 负责 CLI 交互入口侧的协议定义与展示模型。
- 只处理命令解析、展示态等“界面/交互”概念，不直接承载 Git 分析、Prompt 拼装或 Provider 细节。

### `application`

- 负责跨模块编排，把 Git 工作区、变更分析、缓存日志组合成可直接被 CLI 调用的应用服务。
- 当前的 `git-summary.ts` 是应用服务层，不直接持有交互状态。

### `domain`

- 负责代码变更总结领域的核心语义。
- `briefs.ts` 负责结果结构和渲染协议。
- `prompt.ts` 负责将结构化摘要压缩为模型输入。
- `change-analysis/` 继续承担 IR、上下文提取、文件分类等纯业务分析职责。

### `infrastructure`

- 负责环境变量、模型调用门面、fallback 解析、缓存与日志等基础设施细节。
- 这些模块允许依赖外部 SDK、文件系统与环境变量，但不应反向依赖 CLI 交互状态。

## 依赖方向

建议长期遵守以下方向：

```text
cli.ts
  -> app
  -> application
  -> domain
  -> infrastructure

application
  -> domain
  -> change-analysis
  -> git
  -> infrastructure

domain
  -> app (仅类型协议)
  -> change-analysis

infrastructure
  -> domain / app (仅在模型解析等少数场景引用类型)
```

约束重点：

- `app` 不直接读取 Git 或 Provider 细节。
- `domain` 不直接执行 shell、读写缓存或访问环境变量。
- `infrastructure` 不负责拼装 CLI 视图状态。

## 下一步建议

1. 将 `src/cli.ts` 中的 profile/env 管理提取到 `infrastructure/profile-store`。
2. 将 `doctor`、`config`、`profiles`、`interactive generate flow` 拆成独立 command handler。
3. 继续把 `providers` 与 `git/workspace` 进一步并入 `infrastructure` 子目录，减少根层目录语义漂移。
