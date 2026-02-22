/**
 * @description 生成用于模型总结代码改动的提示词。
 * @param {{ nameStatus: string; patch: string }} input 提供文件状态与补丁内容。
 * @return {string} 返回完整提示词。
 */
export function buildPrompt(input) {
  /** @type {string} */
  const rules = [
    'You are a senior engineer writing a git commit message.',
    'Analyze ONLY the provided staged changes.',
    'Return strict JSON with keys: type, subject, bullets.',
    'type must be one of: feat, fix, chore.',
    'subject must be concise, imperative mood, max 50 characters.',
    'bullets must be 2-4 short items explaining concrete updates.',
    'Do not include markdown fences.',
    'Do not include unrelated speculation.'
  ].join('\n');

  return `${rules}\n\n[NAME_STATUS]\n${input.nameStatus}\n\n[PATCH]\n${input.patch}`;
}
