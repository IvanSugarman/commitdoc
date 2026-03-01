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
    "bullets must be 2-4 short Chinese items explaining concrete updates.",
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
    `[NAME_STATUS]\n${input.nameStatus || "EMPTY"}`,
    `[FILE_SUMMARY]\n${input.fileSummary || "EMPTY"}`,
  ];

  if (input.contextSummary) {
    blocks.push(`[CONTEXT_SUMMARY]\n${input.contextSummary}`);
  }

  blocks.push(`[PATCH]\n${input.patch || "EMPTY"}`);
  return blocks.join("\n\n");
}
