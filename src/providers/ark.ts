import type {BriefType} from '../app/commands.js';
import {createOpenAICompatibleConfig, generateWithOpenAICompatible} from './openai-compatible.js';

/**
 * @description 构建火山方舟 Provider 配置。
 * @return {import('./openai-compatible.js').ProviderConfig} Provider 配置。
 */
export function getArkConfig() {
  return createOpenAICompatibleConfig({
    provider: 'ark',
    apiKey: process.env.GAI_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.GAI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3',
    model: process.env.GAI_MODEL || 'ark-code-latest',
    formatModel: process.env.GAI_FORMAT_MODEL || process.env.GAI_MODEL || 'ark-code-latest',
    enableThinking: process.env.GAI_ENABLE_THINKING === 'true',
    enableFormatFallback: process.env.GAI_ENABLE_FORMAT_FALLBACK === 'true'
  });
}

/**
 * @description 使用火山方舟模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @param {BriefType} briefType brief 类型。
 * @param {import('./openai-compatible.js').GenerationOptions} [options] 生成选项。
 * @return {Promise<import('./openai-compatible.js').GenerationResult>} 提交建议与生成模式。
 */
export async function generateSuggestion(prompt, briefType: BriefType, options: import('./openai-compatible.js').GenerationOptions = {}) {
  return generateWithOpenAICompatible(getArkConfig(), prompt, briefType, options);
}
