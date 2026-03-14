import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** @type {string} */
const CURRENT_FILE = fileURLToPath(import.meta.url);
/** @type {string} */
const PROJECT_ROOT = path.dirname(path.dirname(CURRENT_FILE));
/** @type {string} */
export const MODEL_LOG_PATH = path.join(PROJECT_ROOT, '.gai-debug', 'model-requests.jsonl');
/**
 * @description 序列化 chat completion 响应，保留调试所需关键字段。
 * @param {any} response 模型原始响应。
 * @return {Record<string, unknown>} 可写入日志的响应对象。
 */
export function serializeModelResponse(response) {
    const choice = response?.choices?.[0];
    const message = choice?.message || {};
    return {
        id: response?.id || '',
        object: response?.object || '',
        model: response?.model || '',
        created: response?.created || '',
        usage: response?.usage || null,
        finish_reason: choice?.finish_reason || '',
        message: {
            role: message?.role || '',
            content: message?.content ?? '',
            reasoning_content: message?.reasoning_content ?? '',
            tool_calls: message?.tool_calls ?? null
        }
    };
}
/**
 * @description 追加一条模型调试日志。
 * @param {Record<string, unknown>} entry 日志内容。
 * @return {Promise<void>} 写入完成。
 */
export async function writeModelLog(entry) {
    const dir = path.dirname(MODEL_LOG_PATH);
    await mkdir(dir, { recursive: true });
    const payload = {
        timestamp: new Date().toISOString(),
        ...entry
    };
    await appendFile(MODEL_LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
}
