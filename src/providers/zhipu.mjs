import {createOpenAICompatibleConfig, generateWithOpenAICompatible} from './openai-compatible.mjs';

/**
 * @description 构建智谱 Provider 配置。
 * @return {import('./openai-compatible.mjs').ProviderConfig} Provider 配置。
 */
export function getZhipuConfig() {
  return createOpenAICompatibleConfig({
    provider: 'zhipu',
    apiKey: process.env.GAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.GAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: process.env.GAI_MODEL || 'glm-4.7',
    formatModel: process.env.GAI_FORMAT_MODEL || 'glm-4.7-flash',
    disableThinking: process.env.GAI_DISABLE_THINKING !== 'false'
  });
}

/**
 * @description 使用智谱模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @return {Promise<import('../fallback-suggestion.mjs').CommitSuggestion>} 提交建议。
 */
export async function generateSuggestion(prompt) {
  return generateWithOpenAICompatible(getZhipuConfig(), prompt);
}
