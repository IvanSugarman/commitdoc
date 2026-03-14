/**
 * @typedef {Object} PromptInput
 * @property {'staged'|'working-tree'} source 变更来源。
 * @property {'incremental'|'contextual'|'compressed'} strategy 摘要策略。
 * @property {string} nameStatus 文件状态摘要。
 * @property {string} patch 补丁内容。
 * @property {string} fileSummary 文件级摘要。
 * @property {string} filesOverview 文件结构概览。
 * @property {string} groupSummary 分组摘要。
 * @property {string} semanticHints 语义提示。
 * @property {string} contextSummary 上下文摘要。
 * @property {{ fileCount: number; ignoredFileCount: number; highContextFileCount: number; patchChars: number }} stats 统计信息。
 */
/**
 * @description 生成用于模型总结代码改动的提示词。
 * @param {PromptInput} input 提供文件状态、补丁和上下文摘要。
 * @return {string} 返回完整提示词。
 */
export function buildPrompt(input) {
    /** @type {string} */
    const rules = [
        "You are a senior engineer writing a git commit message.",
        "Analyze ONLY the provided git changes.",
        "Return strict JSON with keys: type, subject, bullets.",
        "type must be one of: feat, fix, chore.",
        "subject must be concise Chinese, max 30 Chinese characters.",
        'The final title will be formatted as "<type>: <subject>", where only the type keyword stays in English.',
        "subject must summarize the main intent or outcome of this change at feature/module/business level, not low-level edit operations.",
        "Prefer abstract but concrete language: describe what capability, behavior, stability, maintainability, diagnosis, or performance is improved.",
        "Avoid vague titles like 优化逻辑, 调整代码, 更新内容 unless the patch truly has no stronger semantic center.",
        "Avoid listing trivial implementation actions such as adding variables, moving lines, renaming methods, or updating imports.",
        "If the change is internal tooling or infrastructure, summarize the engineering value instead of literal file edits.",
        "bullets must be 2-4 short Chinese items with semantic value, not a changelog dump.",
        "Each bullet should prefer one of these angles: core change, behavior/result, impact/scope, stability/performance/maintainability gain.",
        "If the patch contains repeated implementation details, compress them into one higher-level description.",
        "When changes naturally form 2-4 clusters such as scripts, request samples, docs, and startup commands, summarize these clusters instead of random file details.",
        "Use [FILES_OVERVIEW] as the primary structural clue for what changed across the repo.",
        "Treat [SEMANTIC_HINTS] as high-priority inferred context when it is consistent with file paths and patch content.",
        "Treat [GROUP_SUMMARY] as the structural map of this change set so you do not overfit to a single file.",
        "Use [PATCH] only as supporting evidence, not as a line-by-line changelog.",
        "Ignore placeholder literals or sentinel words appearing in code diffs, such as EMPTY, NONE, TODO, FIXME, unless they are clearly part of user-facing business semantics.",
        "Use file names, APIs, libraries, or keywords only when they help explain the semantic center of the change.",
        "Keep technical keywords, library names, API names, file names, and commit type keywords in English when necessary.",
        "Prefer the most important behavior or architecture change, not formatting noise.",
        "The last line of your output must be the final JSON object.",
        "Do not output any text after the final JSON object.",
        "Do not include markdown fences.",
        "Do not include unrelated speculation.",
    ].join("\n");
    /** @type {string[]} */
    const blocks = [
        rules,
        `[SOURCE]\n${input.source}`,
        `[STRATEGY]\n${input.strategy}`,
        `[STATS]\nfileCount=${input.stats.fileCount}\nignoredFileCount=${input.stats.ignoredFileCount}\nhighContextFileCount=${input.stats.highContextFileCount}\npatchChars=${input.stats.patchChars}`,
        '[SUMMARY_STYLE]\n1. First infer the real intent behind the patch.\n2. Then summarize the main behavior or architecture change.\n3. Finally capture the resulting value or impact.\n4. Prefer one concise semantic center instead of several parallel low-level edits.',
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
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(0, limit)
        .join('\n');
}
/**
 * @description 提取轻量级补丁摘要，优先保留新增语义行。
 * @param {string} patch 原始补丁。
 * @return {string} 轻量补丁摘要。
 */
function buildPatchSummary(patch) {
    const lines = patch
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^[+-]/.test(line))
        .filter((line) => !/^\+\+\+|^---|^@@/.test(line))
        .slice(0, 40);
    return lines.join('\n').slice(0, 1600);
}
/**
 * @description 为智谱构建更短的专用提示词，避免 token 被 reasoning 吃光。
 * @param {PromptInput} input 提供文件状态、补丁和语义摘要。
 * @return {string} 轻量提示词。
 */
export function buildZhipuPrompt(input) {
    const rules = [
        'Summarize the git change into one concise commit suggestion.',
        'Return strict JSON only with keys: type, subject, bullets.',
        'type must be one of feat, fix, chore.',
        'subject must be concise Chinese, max 24 Chinese characters.',
        'bullets must be 2-4 short Chinese strings.',
        'Prefer one module-level or business-level semantic center.',
        'Prefer semantic clusters such as scripts, docs, request files, commands, or architecture changes.',
        'If FILES_OVERVIEW and SEMANTIC_HINTS clearly point to one rollout, summarize that rollout instead of patch details.',
        'Use PATCH_SUMMARY only as evidence for wording, not as a changelog.',
        'Do not explain your reasoning.',
        'Do not output markdown.'
    ].join('\n');
    const blocks = [
        rules,
        `[SOURCE]\n${input.source}`,
        `[CHANGE_OVERVIEW]\nfiles=${input.stats.fileCount}\nstrategy=${input.strategy}`,
        `[FILES_OVERVIEW]\n${pickLines(input.filesOverview || input.fileSummary, 10)}`,
        `[SEMANTIC_HINTS]\n${input.semanticHints || pickLines(input.groupSummary || input.fileSummary, 6)}`,
        `[GROUP_SUMMARY]\n${pickLines(input.groupSummary || input.fileSummary, 6)}`,
        `[KEY_FILES]\n${pickLines(input.nameStatus, 8)}`,
        `[PATCH_SUMMARY]\n${buildPatchSummary(input.patch)}`
    ].filter(Boolean);
    return blocks.join('\n\n');
}
