import { getArkConfig, generateSuggestion as generateArkSuggestion } from './ark.js';
import { createOpenAICompatibleConfig, generateWithOpenAICompatible } from './openai-compatible.js';
import { getOpenAIConfig, generateSuggestion as generateOpenAISuggestion } from './openai.js';
import { getZhipuConfig, generateSuggestion as generateZhipuSuggestion } from './zhipu.js';
/**
 * @typedef {'ark'|'zhipu'|'openai'|'openai-compatible'} ProviderName
 */
/**
 * @typedef {Object} ProviderDefaults
 * @property {ProviderName} provider Provider 名称。
 * @property {string} baseURL 基础地址。
 * @property {string} model 默认模型。
 * @property {string} formatModel 默认格式化模型。
 * @property {boolean} enableThinking 是否默认启用 thinking。
 * @property {boolean} enableFormatFallback 是否默认启用二次格式化请求。
 */
/**
 * @description 读取当前 Provider 名称。
 * @return {ProviderName} Provider 名称。
 */
export function getProviderName() {
    const provider = (process.env.GAI_PROVIDER || 'ark').trim().toLowerCase();
    if (provider === 'ark' || provider === 'openai' || provider === 'openai-compatible') {
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
    if (provider === 'ark') {
        return {
            provider: 'ark',
            baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3',
            model: 'ark-code-latest',
            formatModel: 'ark-code-latest',
            enableThinking: false,
            enableFormatFallback: false
        };
    }
    if (provider === 'openai') {
        return {
            provider: 'openai',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini',
            formatModel: 'gpt-4.1-mini',
            enableThinking: false,
            enableFormatFallback: false
        };
    }
    if (provider === 'openai-compatible') {
        return {
            provider: 'openai-compatible',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini',
            formatModel: 'gpt-4.1-mini',
            enableThinking: false,
            enableFormatFallback: false
        };
    }
    return {
        provider: 'zhipu',
        baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        model: 'glm-4.7',
        formatModel: 'glm-4.7-flash',
        enableThinking: false,
        enableFormatFallback: false
    };
}
/**
 * @description 获取当前 Provider 的解析配置。
 * @return {import('./openai-compatible.js').ProviderConfig} Provider 配置。
 */
export function getResolvedProviderConfig() {
    const provider = getProviderName();
    if (provider === 'ark') {
        return getArkConfig();
    }
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
 * @param {BriefType} briefType brief 类型。
 * @param {import('./openai-compatible.js').GenerationOptions} [options] 生成选项。
 * @return {Promise<import('./openai-compatible.js').GenerationResult>} 提交建议与生成模式。
 */
export async function generateSuggestion(prompt, briefType, options = {}) {
    const provider = getProviderName();
    if (provider === 'ark') {
        return generateArkSuggestion(prompt, briefType, options);
    }
    if (provider === 'openai') {
        return generateOpenAISuggestion(prompt, briefType, options);
    }
    if (provider === 'openai-compatible') {
        return generateWithOpenAICompatible(getResolvedProviderConfig(), prompt, briefType, options);
    }
    return generateZhipuSuggestion(prompt, briefType, options);
}
