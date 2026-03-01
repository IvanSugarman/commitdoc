import {createOpenAICompatibleConfig, generateWithOpenAICompatible} from './openai-compatible.mjs';
import {getOpenAIConfig, generateSuggestion as generateOpenAISuggestion} from './openai.mjs';
import {getZhipuConfig, generateSuggestion as generateZhipuSuggestion} from './zhipu.mjs';

/**
 * @typedef {'zhipu'|'openai'|'openai-compatible'} ProviderName
 */

/**
 * @description 读取当前 Provider 名称。
 * @return {ProviderName} Provider 名称。
 */
export function getProviderName() {
  const provider = (process.env.GAI_PROVIDER || 'zhipu').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openai-compatible') {
    return provider;
  }

  return 'zhipu';
}

/**
 * @description 获取当前 Provider 的解析配置。
 * @return {import('./openai-compatible.mjs').ProviderConfig} Provider 配置。
 */
export function getResolvedProviderConfig() {
  const provider = getProviderName();

  if (provider === 'openai') {
    return getOpenAIConfig();
  }

  if (provider === 'openai-compatible') {
    return createOpenAICompatibleConfig({
      provider: 'openai-compatible'
    });
  }

  return getZhipuConfig();
}

/**
 * @description 根据当前 Provider 生成提交建议。
 * @param {string} prompt 输入提示词。
 * @return {Promise<import('../fallback-suggestion.mjs').CommitSuggestion>} 提交建议。
 */
export async function generateSuggestion(prompt) {
  const provider = getProviderName();

  if (provider === 'openai') {
    return generateOpenAISuggestion(prompt);
  }

  if (provider === 'openai-compatible') {
    return generateWithOpenAICompatible(getResolvedProviderConfig(), prompt);
  }

  return generateZhipuSuggestion(prompt);
}
