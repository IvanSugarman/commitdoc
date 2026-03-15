/** 系统级提示词 */
export const BASE_SYSTEM_PROMPT = `你是一名资深软件工程师，拥有丰富的代码评审（Code Review）、软件架构设计以及团队协作开发经验。

你的任务是分析来自 Git 仓库的代码变更，并生成高质量的工程总结，帮助其他开发者快速理解这次代码变更的目的、影响范围以及潜在风险。

请以一名经验丰富的代码评审者的视角进行分析，就像在评审一个 Pull Request 或 Merge Request 一样。

你的分析重点应放在理解变更的意图（intent）和系统影响（impact），而不仅仅是复述代码差异。

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

1. 优先关注系统行为的变化，而不是简单的代码修改。
2. 尝试根据实现方式推断变更背后的工程目的。
3. 指出代码评审者需要重点关注的部分。
4. 识别可能的边界情况、回归风险或副作用。
5. 如果涉及测试代码变更，需要评估测试是否覆盖了新的行为。

你的表达应该精确、专业、简洁。

风格应类似成熟工程团队中资深工程师撰写的 commit message 或 Pull Request 描述。

避免：

- 冗长的解释
- 无根据的猜测
- 编造问题或风险

只有在代码变更能够合理推断出风险时，才进行提示。

最终输出应清晰、有结构，并面向需要进行代码评审的工程师阅读。
在合理的情况下，可以指出代码评审者可能需要关注的潜在风险或边界情况，例如：

- 接口契约变化
- 重试逻辑可能带来的副作用
- 并发或状态一致性问题

但不要编造不存在的问题。`;
/**
 * @typedef {SummaryChanges} PromptInput
 */
/**
 * @description 生成用于模型总结代码改动的提示词。
 * @param {PromptInput} input 提供文件状态、补丁和上下文摘要。
 * @param {BriefType} briefType brief 类型。
 * @return {string} 返回完整提示词。
 */
export function buildPrompt(input, briefType) {
    const outputProfile = buildOutputProfile(input);
    /** @type {string} */
    const rules = [
        "你只能基于本次提供的 Git 变更信息进行分析。",
        ...buildBriefRules(briefType, outputProfile),
        "优先使用抽象但具体的表达，说明这次改动提升了什么能力、行为、稳定性、可维护性、诊断能力或性能。",
        "避免使用“优化逻辑”“调整代码”“更新内容”这类空泛表述，除非变更确实没有更明确的语义中心。",
        "不要罗列“新增变量、移动代码、重命名方法、调整 import”这类低层实现动作。",
        "如果改动属于内部工具或基础设施，请总结工程价值，而不是逐字复述文件修改。",
        "如果补丁里存在重复实现细节，请主动压缩为更高层的语义描述。",
        "如果改动自然形成 2 到 4 个簇，例如脚本、文档、请求样例、命令，请按簇总结，而不是随机挑文件。",
        "优先使用 [IR_OVERVIEW]、[IR_CHANGES]、[IR_RISKS] 作为主线结构信息。",
        "将 [NARRATIVE_HINT] 视为本次改动的高层叙事锚点，先回答为什么做这次改动，再展开关键变化与影响。",
        "将 [ACTION_CHECKLIST] 视为推荐的工程动作表达，优先总结统一协议、拆分职责、增强可观测性、自适应策略、测试校验等动作，而不是按文件逐项列举。",
        "将 [REVIEWER_FOCUS_TEMPLATE] 视为评审关注点模板，优先沿着契约传播、回退逻辑、provider 兼容、行为一致性这些高风险点来写。",
        "在 IR 仍需补充文件级证据时，再参考 [FILES_OVERVIEW]。",
        "当 [SEMANTIC_HINTS] 与路径和补丁内容一致时，应将其视为高优先级上下文。",
        "将 [GROUP_SUMMARY] 视为本次改动的结构地图，避免只盯某一个文件。",
        "将 [MODULE_CLUSTERS] 视为本次改动的主线地图，优先覆盖 3 到 4 个高影响语义簇，而不是只描述其中一个文件或一个配套改动。",
        "将 [THEME_CHECKLIST] 视为本次改动必须优先覆盖的主题清单；如果其中存在多个主题，输出时应尽量覆盖它们。",
        "如果存在命令入口、分析链路、provider/模型调用、缓存/日志、测试/文档等多个真实簇，请按影响度覆盖这些簇，但不要编造不存在的簇。",
        "不要把 README、package.json 或单个配套文件当作唯一主线，除非代码层改动非常少。",
        "当 IR 已经能清楚解释意图和影响时，应优先依据 IR，而不是原始 patch 细节。",
        "将 [PATCH] 仅视为辅助证据，而不是逐行改动清单。",
        "忽略代码 diff 中的占位符或哨兵字面量，例如 EMPTY、NONE、TODO、FIXME，除非它们明显属于用户可见语义。",
        "只有当文件名、API、库名或关键字确实有助于解释语义中心时，才引用它们。",
        "必要时可保留英文技术关键字、库名、API 名、文件名和 commit type 关键字。",
        "优先总结最重要的行为变化或架构变化，而不是格式化噪音。",
        "不要让每条 bullet 都以文件名、模块名或“新增 xxx.ts”开头；优先描述工程动作、目标和影响，再在必要时引用文件。",
        "如果本次改动属于跨层重构，应先说明它在收敛什么职责边界，再说明具体模块变化。",
        "输出的最后一行必须是最终 JSON 对象。",
        "最终 JSON 之后不要再输出任何文本。",
        "不要输出 Markdown 代码块。",
        "不要输出与本次改动无关的猜测。",
    ].join("\n");
    /** @type {string[]} */
    const blocks = [
        rules,
        `[BRIEF_TYPE]\n${briefType}`,
        `[SOURCE]\n${input.source}`,
        `[STRATEGY]\n${input.strategy}`,
        `[STATS]\nfileCount=${input.stats.fileCount}\nignoredFileCount=${input.stats.ignoredFileCount}\nhighContextFileCount=${input.stats.highContextFileCount}\npatchChars=${input.stats.patchChars}`,
        "[SUMMARY_STYLE]\n1. 先推断补丁背后的真实意图。\n2. 再总结主要的行为变化或架构变化。\n3. 最后提炼这次改动带来的价值或影响。\n4. 优先收敛为一个清晰的语义中心，而不是并列罗列多个低层动作。",
        `[IR_OVERVIEW]\n${buildIROverview(input)}`,
        `[OUTPUT_PROFILE]\n${formatOutputProfile(outputProfile)}`,
        `[NARRATIVE_HINT]\n${buildNarrativeHint(input, outputProfile)}`,
        `[ACTION_CHECKLIST]\n${buildActionChecklist(input)}`,
        `[REVIEWER_FOCUS_TEMPLATE]\n${buildReviewerFocusTemplate(input)}`,
        `[IR_CHANGES]\n${buildIRChanges(input)}`,
        `[MODULE_CLUSTERS]\n${buildModuleClusters(input)}`,
        `[THEME_CHECKLIST]\n${buildThemeChecklist(input)}`,
        `[PRIMARY_CHANGES]\n${buildPrimaryChanges(input)}`,
        `[NAME_STATUS]\n${input.nameStatus}`,
        `[FILES_OVERVIEW]\n${input.filesOverview}`,
        `[FILE_SUMMARY]\n${input.fileSummary}`,
    ].filter(Boolean);
    if (input.groupSummary) {
        blocks.push(`[GROUP_SUMMARY]\n${input.groupSummary}`);
    }
    if (input.semanticHints) {
        blocks.push(`[SEMANTIC_HINTS]\n${input.semanticHints}`);
    }
    if (input.contextSummary) {
        blocks.push(`[CONTEXT_SUMMARY]\n${input.contextSummary}`);
    }
    if (input.ir.risks.length > 0) {
        blocks.push(`[IR_RISKS]\n${input.ir.risks.join("\n")}`);
    }
    if (input.ir.tests.length > 0) {
        blocks.push(`[TEST_FILES]\n${input.ir.tests.join("\n")}`);
    }
    blocks.push(`[PATCH_SUMMARY]\n${buildPatchSummary(input.patch)}`);
    blocks.push(`[PATCH]\n${input.patch}`);
    return blocks.join("\n\n");
}
/**
 * @description 提取有限数量的摘要行。
 * @param {string} text 原始文本。
 * @param {number} limit 最大行数。
 * @return {string} 截断后的文本。
 */
function pickLines(text, limit) {
    return text
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(0, limit)
        .join("\n");
}
/**
 * @description 提取轻量级补丁摘要，优先保留新增语义行。
 * @param {string} patch 原始补丁。
 * @return {string} 轻量补丁摘要。
 */
function buildPatchSummary(patch) {
    const lines = patch
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^[+-]/.test(line))
        .filter((line) => !/^\+\+\+|^---|^@@/.test(line))
        .slice(0, 40);
    return lines.join("\n").slice(0, 1600);
}
/**
 * @description 为智谱构建更短的专用提示词，避免 token 被 reasoning 吃光。
 * @param {PromptInput} input 提供文件状态、补丁和语义摘要。
 * @return {string} 轻量提示词。
 */
export function buildZhipuPrompt(input, briefType) {
    const outputProfile = buildOutputProfile(input);
    const rules = [
        ...buildBriefRules(briefType, outputProfile),
        "优先提炼一个模块级或业务级语义中心。",
        "先根据 [NARRATIVE_HINT] 给出高层目标，再展开关键变化。",
        "优先参考 [ACTION_CHECKLIST]，把输出写成工程动作，而不是模块清单。",
        "优先按语义簇总结，例如脚本、文档、请求文件、命令或架构调整。",
        "如果存在多个高影响改动簇，必须覆盖 3 到 4 个簇，不要只保留一个配套改动。",
        "优先覆盖 [THEME_CHECKLIST] 中列出的主题，尤其是命令/brief、分析链路、provider/prompt、缓存/日志、测试/文档等真实存在的主题。",
        "优先覆盖命令入口、分析链路、provider/模型调用、缓存/日志、测试/文档等真实存在的高影响簇。",
        "如果 FILES_OVERVIEW 和 SEMANTIC_HINTS 已明显指向同一条主线，应直接总结这条主线，而不是复述 patch 细节。",
        "PATCH_SUMMARY 仅用于辅助措辞，不要将其当成变更流水账。",
        "不要解释推理过程。",
        "不要输出 Markdown。",
    ].join("\n");
    const blocks = [
        rules,
        `[BRIEF_TYPE]\n${briefType}`,
        `[SOURCE]\n${input.source}`,
        `[CHANGE_OVERVIEW]\nfiles=${input.stats.fileCount}\nstrategy=${input.strategy}`,
        `[IR_OVERVIEW]\n${buildIROverview(input)}`,
        `[OUTPUT_PROFILE]\n${formatOutputProfile(outputProfile)}`,
        `[NARRATIVE_HINT]\n${buildNarrativeHint(input, outputProfile)}`,
        `[ACTION_CHECKLIST]\n${buildActionChecklist(input)}`,
        `[REVIEWER_FOCUS_TEMPLATE]\n${buildReviewerFocusTemplate(input)}`,
        `[IR_CHANGES]\n${pickLines(buildIRChanges(input), 12)}`,
        `[MODULE_CLUSTERS]\n${buildModuleClusters(input)}`,
        `[THEME_CHECKLIST]\n${buildThemeChecklist(input)}`,
        `[PRIMARY_CHANGES]\n${buildPrimaryChanges(input)}`,
        `[FILES_OVERVIEW]\n${pickLines(input.filesOverview || input.fileSummary, 12)}`,
        `[SEMANTIC_HINTS]\n${input.semanticHints || pickLines(input.groupSummary || input.fileSummary, 6)}`,
        `[GROUP_SUMMARY]\n${pickLines(input.groupSummary || input.fileSummary, 8)}`,
        `[KEY_FILES]\n${buildKeyFiles(input)}`,
        `[TEST_FILES]\n${pickLines(input.ir.tests.join("\n"), 6)}`,
        `[IR_RISKS]\n${pickLines(input.ir.risks.join("\n"), 4)}`,
        `[FILE_SUMMARY]\n${input.fileSummary}`,
        `[NAME_STATUS]\n${pickLines(input.nameStatus, 12)}`,
        `[PATCH_SUMMARY]\n${buildPatchSummary(input.patch)}`,
    ].filter(Boolean);
    return blocks.join("\n\n");
}
/**
 * @description 构建 brief 级别规则。
 * @param {BriefType} briefType brief 类型。
 * @return {string[]} 规则列表。
 */
function buildBriefRules(briefType, outputProfile) {
    if (briefType === "commit") {
        return [
            "请返回严格 JSON，字段为：title、bullets。",
            'title 必须是一行简洁的 conventional commit 标题，内容使用中文，例如 "feat: 调整摘要生成链路"。',
            "commit type 关键字必须保留英文，且只能是 feat、fix、chore 之一。",
            `bullets 必须是 ${outputProfile.summaryMin} 到 ${outputProfile.summaryMax} 条有语义价值的中文短句，不能是流水账。`,
            "title 应概括本次改动的总主题，不要只写单个文件名或单个次级模块。",
            `bullets 应尽量覆盖不同的高影响主题，并遵循 [OUTPUT_PROFILE]；当前建议是 ${outputProfile.coverageHint}。`
        ];
    }
    if (briefType === "commit-title") {
        return [
            "请返回严格 JSON，字段只有：title。",
            "title 必须是一行简洁的 conventional commit 标题，内容使用中文。",
            "commit type 关键字必须保留英文，且只能是 feat、fix、chore 之一。",
            "不要返回 bullets 或任何额外字段。",
            "title 必须概括本次改动的总主题，优先收敛为 1 个能覆盖多个模块簇的抽象，而不是只点名某一个文件或某一个子模块。"
        ];
    }
    if (briefType === "commit-summary") {
        return [
            "请返回严格 JSON，字段只有：bullets。",
            `bullets 必须是一个数组，包含 ${outputProfile.summaryMin} 到 ${outputProfile.summaryMax} 条有语义价值的中文短句。`,
            "不要返回 title 或任何额外字段。",
            `每条 bullet 应尽量覆盖一个不同的高影响主题，并遵循 [OUTPUT_PROFILE]；当前建议是 ${outputProfile.coverageHint}。`,
            "第一条 bullet 优先概括本次改动的总体目标或重构方向，而不是直接列模块名。",
            "bullets 优先写成工程动作，例如统一协议、拆分职责、增强可观测性、引入自适应策略、补齐测试校验，而不是“新增 xxx.ts 模块”。",
            "如果本次改动明显跨越多个模块簇，宁可输出更多条目，也不要为了套模板压缩成 3 到 4 条。"
        ];
    }
    return [
        "请返回严格 JSON，字段为：changePurpose、keyChanges、impactScope、reviewerFocus、testingValidation。",
        "字段名保持英文，但字段内容请使用简体中文。",
        `changePurpose 必须使用 ${outputProfile.changePurposeStyle}，说明为什么需要这次改动。`,
        `keyChanges 必须是一个数组，包含 ${outputProfile.keyChangesMin} 到 ${outputProfile.keyChangesMax} 条中文要点。`,
        `impactScope 必须是一个数组，包含 ${outputProfile.impactScopeMin} 到 ${outputProfile.impactScopeMax} 条中文要点。`,
        "reviewerFocus 必须是一句到两句简洁中文。",
        "testingValidation 必须是一句到两句简洁中文。",
        "changePurpose 必须回答为什么要做这次改动，不要只描述如何拆文件或新增了哪些模块。",
        "changePurpose 应概括这次重构或变更的总体目标，而不是只描述单个子模块。",
        "keyChanges 优先写成工程动作，不要让每一条都以文件名或模块名开头。",
        "impactScope 优先描述受影响的系统层、运行时行为或协作边界，不要简单重复文件清单。",
        "reviewerFocus 必须优先遵循 [REVIEWER_FOCUS_TEMPLATE]，只允许在不改变风险类别的前提下做轻微措辞调整。",
        `keyChanges 和 impactScope 应尽量覆盖不同的高影响主题，并遵循 [OUTPUT_PROFILE]；当前建议是 ${outputProfile.coverageHint}。`
    ];
}
/**
 * @description 构建输出规格，按改动规模自适应调整条数要求。
 * @param {PromptInput} input 摘要输入。
 * @return {OutputProfile} 输出规格。
 */
function buildOutputProfile(input) {
    const changedLines = input.ir.overview.addedLines + input.ir.overview.deletedLines;
    const themeCount = getThemeChecklistItems(input).length;
    const clusterCount = new Set(sortChangesForPrompt(input).map((item) => getClusterKey(item.file))).size;
    if (input.strategy === "compressed" ||
        input.stats.fileCount >= 18 ||
        changedLines >= 700 ||
        themeCount >= 5 ||
        clusterCount >= 8) {
        return {
            scale: "expansive",
            summaryMin: 4,
            summaryMax: 6,
            keyChangesMin: 4,
            keyChangesMax: 6,
            impactScopeMin: 3,
            impactScopeMax: 5,
            changePurposeStyle: "1 到 2 句简洁中文",
            coverageHint: "优先覆盖 4 到 6 个真实存在的高影响主题"
        };
    }
    if (input.strategy === "contextual" ||
        input.stats.fileCount >= 8 ||
        changedLines >= 220 ||
        themeCount >= 3 ||
        clusterCount >= 4) {
        return {
            scale: "standard",
            summaryMin: 3,
            summaryMax: 4,
            keyChangesMin: 3,
            keyChangesMax: 4,
            impactScopeMin: 2,
            impactScopeMax: 4,
            changePurposeStyle: "1 句简洁中文",
            coverageHint: "优先覆盖 3 到 4 个真实存在的高影响主题"
        };
    }
    return {
        scale: "compact",
        summaryMin: 2,
        summaryMax: 3,
        keyChangesMin: 2,
        keyChangesMax: 3,
        impactScopeMin: 2,
        impactScopeMax: 3,
        changePurposeStyle: "1 句简洁中文",
        coverageHint: "优先覆盖 2 到 3 个最关键的真实主题"
    };
}
/**
 * @description 格式化输出规格，提供给模型和 fallback 共用。
 * @param {OutputProfile} profile 输出规格。
 * @return {string} 文本配置。
 */
function formatOutputProfile(profile) {
    return [
        `scale=${profile.scale}`,
        `summaryMin=${profile.summaryMin}`,
        `summaryMax=${profile.summaryMax}`,
        `keyChangesMin=${profile.keyChangesMin}`,
        `keyChangesMax=${profile.keyChangesMax}`,
        `impactScopeMin=${profile.impactScopeMin}`,
        `impactScopeMax=${profile.impactScopeMax}`,
        `changePurposeStyle=${profile.changePurposeStyle}`,
        `coverageHint=${profile.coverageHint}`
    ].join("\n");
}
/**
 * @description 构建高层叙事提示，帮助模型先说“为什么”，再说“改了什么”。
 * @param {PromptInput} input 摘要输入。
 * @param {OutputProfile} profile 输出规格。
 * @return {string} 高层叙事提示。
 */
function buildNarrativeHint(input, profile) {
    const themes = getThemeChecklistItems(input);
    const groups = new Set(sortChangesForPrompt(input).map((item) => getClusterKey(item.file)));
    const hasCommand = groups.has("src/briefs") || groups.has("src/commands") || groups.has("src/cli");
    const hasAnalysis = groups.has("src/git") || groups.has("src/change-analysis");
    const hasModel = groups.has("src/providers") || groups.has("src/prompt") || groups.has("src/fallback-suggestion");
    const hasLog = groups.has("src/model-log");
    const hasTests = input.ir.tests.length > 0;
    const topThemes = themes.slice(0, 4).join("、");
    if (profile.scale === "expansive" && hasCommand && hasAnalysis && hasModel) {
        const suffix = hasLog
            ? "并补齐缓存与诊断能力"
            : hasTests
                ? "并同步收敛测试与工程校验"
                : "并提升后续扩展的可维护性";
        return `这次改动更接近一次跨层重构，主线是统一命令入口、变更分析和模型生成协议，减少生成链路中的职责耦合，${suffix}。`;
    }
    if (themes.length >= 3) {
        return `这次改动同时覆盖 ${topThemes}，应先总结它们共同服务的工程目标，再展开具体模块变化。`;
    }
    return "应先总结这次改动解决了什么工程问题，再说明关键变化和受影响范围。";
}
/**
 * @description 构建工程动作清单，帮助模型避免退化成模块枚举。
 * @param {PromptInput} input 摘要输入。
 * @return {string} 工程动作清单。
 */
function buildActionChecklist(input) {
    const themes = getThemeChecklistItems(input);
    const semanticHints = input.semanticHints || "";
    const actions = [];
    if (themes.includes("命令入口与 brief 契约") || /命令入口|brief 契约/i.test(semanticHints)) {
        actions.push("统一命令入口与 Brief 契约，收敛 CLI 参数和内部输出协议");
    }
    if (themes.includes("变更分析与摘要压缩链路") || /变更分析与摘要压缩链路/i.test(semanticHints)) {
        actions.push("重构变更分析与摘要压缩链路，引入自适应策略和结构化分析结果");
    }
    if (themes.includes("模型调用、提示词与输出解析链路") || /模型调用|提示词|输出解析/i.test(semanticHints)) {
        actions.push("统一模型调用、提示词构建与输出解析协议，减少 provider 侧分支差异");
    }
    if (themes.includes("缓存结构与中间态日志能力") || /缓存结构|中间态日志|诊断日志/i.test(semanticHints)) {
        actions.push("增强缓存与中间态日志能力，提升可观测性和调试效率");
    }
    if (themes.includes("测试与工程校验") || /测试覆盖|验证逻辑|工程校验/i.test(semanticHints) || input.ir.tests.length > 0) {
        actions.push("补齐测试与工程校验入口，覆盖重构后的关键生成路径");
    }
    if (themes.includes("文档与配置配套") || /文档|配置|依赖相关/i.test(semanticHints)) {
        actions.push("同步更新文档与配置配套，确保命令语义和运行方式一致");
    }
    return actions.slice(0, 6).join("\n");
}
/**
 * @description 构建评审关注点模板。
 * @param {PromptInput} input 摘要输入。
 * @return {string} 评审关注点模板。
 */
function buildReviewerFocusTemplate(input) {
    const themes = getThemeChecklistItems(input);
    const semanticHints = input.semanticHints || "";
    const checks = [];
    if (themes.includes("命令入口与 brief 契约") || /命令入口|brief 契约/i.test(semanticHints)) {
        checks.push("BriefType 与命令解析结果在 CLI、渲染和 provider 间是否完整透传");
    }
    if (themes.includes("变更分析与摘要压缩链路") || /变更分析与摘要压缩链路/i.test(semanticHints)) {
        checks.push("自适应摘要策略与回退逻辑在大改动和小改动场景下是否保持一致");
    }
    if (themes.includes("模型调用、提示词与输出解析链路") || /模型调用|提示词|输出解析/i.test(semanticHints)) {
        checks.push("provider 参数结构与输出解析协议是否保持兼容");
    }
    if (themes.includes("缓存结构与中间态日志能力") || /缓存结构|中间态日志|诊断日志/i.test(semanticHints)) {
        checks.push("缓存命中、绕过缓存与中间态日志记录是否符合预期");
    }
    if (input.ir.risks.length > 0) {
        checks.push("跨模块改动后的行为一致性与回归风险是否有足够验证");
    }
    const selected = checks.slice(0, 4);
    if (selected.length === 0) {
        return "重点检查接口契约传播、回退逻辑和行为一致性。";
    }
    return `重点检查 ${selected.join('；')}。`;
}
/**
 * @description 构建 IR 概览文本。
 * @param {PromptInput} input 摘要输入。
 * @return {string} IR 概览文本。
 */
function buildIROverview(input) {
    const { overview, tests } = input.ir;
    return [
        `source=${overview.source}`,
        `strategy=${overview.strategy}`,
        `filesChanged=${overview.filesChanged}`,
        `addedLines=${overview.addedLines}`,
        `deletedLines=${overview.deletedLines}`,
        `testsChanged=${tests.length}`,
    ].join("\n");
}
/**
 * @description 构建 IR 变更文本。
 * @param {PromptInput} input 摘要输入。
 * @return {string} IR 变更文本。
 */
function buildIRChanges(input) {
    return sortChangesForPrompt(input)
        .slice(0, 14)
        .map((item) => {
        const symbols = item.symbols.length > 0 ? `\tsymbols=${item.symbols.join(",")}` : "";
        const dependencies = item.dependencyChanges.length > 0
            ? `\tdeps=${item.dependencyChanges.join(",")}`
            : "";
        return `${item.file}\trole=${item.role}\tstatus=${item.status}\t+${item.added}/-${item.removed}\tsummary=${item.summary}${symbols}${dependencies}`;
    })
        .join("\n");
}
/**
 * @description 构建高影响模块簇摘要。
 * @param {PromptInput} input 摘要输入。
 * @return {string} 模块簇摘要。
 */
function buildModuleClusters(input) {
    const groups = new Map();
    sortChangesForPrompt(input).forEach((item) => {
        const group = getClusterKey(item.file);
        const current = groups.get(group) || { count: 0, roles: new Set(), total: 0, files: [] };
        current.count += 1;
        current.roles.add(item.role);
        current.total += item.total;
        current.files.push(item.file);
        groups.set(group, current);
    });
    return Array.from(groups.entries())
        .sort((left, right) => {
        const totalDiff = right[1].total - left[1].total;
        if (totalDiff !== 0) {
            return totalDiff;
        }
        return right[1].count - left[1].count;
    })
        .slice(0, 6)
        .map(([group, meta]) => `${group}\tcount=${meta.count}\troles=${Array.from(meta.roles).join(",")}\ttotal=${meta.total}\tfiles=${meta.files.slice(0, 4).join(",")}`)
        .join("\n");
}
/**
 * @description 构建高影响变更证据。
 * @param {PromptInput} input 摘要输入。
 * @return {string} 证据文本。
 */
function buildPrimaryChanges(input) {
    return sortChangesForPrompt(input)
        .slice(0, 8)
        .map((item) => `${item.file}\t${item.summary}`)
        .join("\n");
}
/**
 * @description 构建主题清单，帮助模型覆盖关键改动簇。
 * @param {PromptInput} input 摘要输入。
 * @return {string} 主题清单文本。
 */
function buildThemeChecklist(input) {
    return getThemeChecklistItems(input).join("\n");
}
/**
 * @description 获取主题清单数组。
 * @param {PromptInput} input 摘要输入。
 * @return {string[]} 主题清单。
 */
function getThemeChecklistItems(input) {
    const groups = new Set(sortChangesForPrompt(input).map((item) => getClusterKey(item.file)));
    const themes = [];
    if (groups.has("src/briefs") || groups.has("src/commands") || groups.has("src/cli")) {
        themes.push("命令入口与 brief 契约");
    }
    if (groups.has("src/git") || groups.has("src/change-analysis")) {
        themes.push("变更分析与摘要压缩链路");
    }
    if (groups.has("src/providers") || groups.has("src/prompt") || groups.has("src/fallback-suggestion")) {
        themes.push("模型调用、提示词与输出解析链路");
    }
    if (groups.has("src/model-log")) {
        themes.push("缓存结构与中间态日志能力");
    }
    if (input.ir.tests.length > 0) {
        themes.push("测试与工程校验");
    }
    if (groups.has("README.md") || groups.has("package.json")) {
        themes.push("文档与配置配套");
    }
    return themes.slice(0, 6);
}
/**
 * @description 构建关键文件列表。
 * @param {PromptInput} input 摘要输入。
 * @return {string} 关键文件文本。
 */
function buildKeyFiles(input) {
    return sortChangesForPrompt(input)
        .slice(0, 10)
        .map((item) => `${item.status}\t${item.file}`)
        .join("\n");
}
/**
 * @description 对 IR 变更按影响度排序。
 * @param {PromptInput} input 摘要输入。
 * @return {PromptInput["ir"]["changes"]} 排序后的变更列表。
 */
function sortChangesForPrompt(input) {
    return [...input.ir.changes].sort((left, right) => {
        const scoreDiff = scoreChange(right) - scoreChange(left);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }
        return right.total - left.total;
    });
}
/**
 * @description 计算 IR 变更的提示词优先级。
 * @param {PromptInput["ir"]["changes"][number]} item IR 变更项。
 * @return {number} 优先级分数。
 */
function scoreChange(item) {
    const roleScoreMap = {
        script: 80,
        type: 72,
        config: 64,
        test: 56,
        request: 48,
        doc: 36,
        other: 24
    };
    const pathScore = /(src\/(cli|commands|briefs|git|prompt|fallback-suggestion|model-log))/i.test(item.file) ? 70 :
        /(src\/providers\/)/i.test(item.file) ? 66 :
            /(src\/change-analysis\/)/i.test(item.file) ? 64 :
                /(package\.json|README\.md)$/i.test(item.file) ? 28 :
                    0;
    const symbolScore = Math.min(item.symbols.length, 4) * 6;
    const dependencyScore = Math.min(item.dependencyChanges.length, 4) * 5;
    return (roleScoreMap[item.role] || 0) + pathScore + Math.min(item.total, 220) / 2 + symbolScore + dependencyScore;
}
/**
 * @description 获取模块簇键。
 * @param {string} filePath 文件路径。
 * @return {string} 模块簇键。
 */
function getClusterKey(filePath) {
    if (filePath === "package.json" || filePath === "README.md" || filePath === ".gitignore") {
        return filePath;
    }
    const parts = filePath.split("/");
    if (parts.length <= 2) {
        return filePath;
    }
    if (parts[0] === "src") {
        return parts.slice(0, 2).join("/");
    }
    return parts.slice(0, 2).join("/");
}
