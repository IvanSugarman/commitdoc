/**
 * @typedef {Object} PromptInput
 * @property {'staged'|'working-tree'} source 变更来源。
 * @property {'incremental'|'contextual'|'compressed'} strategy 摘要策略。
 * @property {string} nameStatus 文件状态摘要。
 * @property {string} patch 补丁内容。
 * @property {string} fileSummary 文件级摘要。
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
    `[NAME_STATUS]\n${input.nameStatus || "EMPTY"}`,
    `[FILE_SUMMARY]\n${input.fileSummary || "EMPTY"}`,
  ];

  if (input.contextSummary) {
    blocks.push(`[CONTEXT_SUMMARY]\n${input.contextSummary}`);
  }

  blocks.push(`[PATCH]\n${input.patch || "EMPTY"}`);
  return blocks.join("\n\n");
}
