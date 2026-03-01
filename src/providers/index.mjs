import {createOpenAICompatibleConfig, generateWithOpenAICompatible} from './openai-compatible.mjs';
import {getOpenAIConfig, generateSuggestion as generateOpenAISuggestion} from './openai.mjs';
import {getZhipuConfig, generateSuggestion as generateZhipuSuggestion} from './zhipu.mjs';

/**
 * @typedef {'zhipu'|'openai'|'openai-compatible'} ProviderName
 */

/**
 * @typedef {Object} ProviderDefaults
 * @property {ProviderName} provider Provider 名称。
 * @property {string} baseURL 基础地址。
 * @property {string} model 默认模型。
 * @property {string} formatModel 默认格式化模型。
 * @property {boolean} disableThinking 是否默认关闭 thinking。
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
 * @description 获取指定 Provider 的默认配置。
 * @param {string} providerName Provider 名称。
 * @return {ProviderDefaults} Provider 默认配置。
 */
export function getProviderDefaults(providerName) {
  const provider = providerName.trim().toLowerCase();

  if (provider === 'openai') {
    return {
      provider: 'openai',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      formatModel: 'gpt-4.1-mini',
      disableThinking: true
    };
  }

  if (provider === 'openai-compatible') {
    return {
      provider: 'openai-compatible',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      formatModel: 'gpt-4.1-mini',
      disableThinking: true
    };
  }

  return {
    provider: 'zhipu',
    baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-4.7',
    formatModel: 'glm-4.7-flash',
    disableThinking: true
  };
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
