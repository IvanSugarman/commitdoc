import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** @type {string} */
const CURRENT_FILE = fileURLToPath(import.meta.url);
/** @type {string} */
const PROJECT_ROOT = path.dirname(path.dirname(CURRENT_FILE));
/** @type {string} */
const DEBUG_DIR = path.join(PROJECT_ROOT, '.gai-debug');
/** @type {string} */
const CACHE_DIR = path.join(PROJECT_ROOT, '.gai-cache');
/** @type {string} */
export const MODEL_LOG_PATH = path.join(DEBUG_DIR, 'model-requests.jsonl');
/** @type {string} */
export const PIPELINE_LOG_PATH = path.join(DEBUG_DIR, 'pipeline-states.jsonl');
/**
 * @description 计算稳定哈希值，用于缓存键。
 * @param {...string} parts 哈希片段。
 * @return {string} 哈希结果。
 */
export function hashParts(...parts) {
    const hash = createHash('sha256');
    parts.forEach((item) => {
        hash.update(item);
        hash.update('\n<<<gai>>>\n');
    });
    return hash.digest('hex');
}
/**
 * @description 对对象做稳定序列化，避免键顺序影响哈希。
 * @param {unknown} value 待序列化对象。
 * @return {string} 稳定序列化结果。
 */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
}
/**
 * @description 计算对象哈希值。
 * @param {unknown} value 待计算对象。
 * @return {string} 哈希结果。
 */
export function hashObject(value) {
    return hashParts(stableStringify(value));
}
/**
 * @description 读取 JSON 缓存。
 * @template T
 * @param {string} namespace 缓存命名空间。
 * @param {string} key 缓存键。
 * @return {Promise<T | null>} 缓存内容。
 */
export async function readJsonCache(namespace, key) {
    try {
        const cachePath = getCachePath(namespace, key);
        const raw = await readFile(cachePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * @description 写入 JSON 缓存。
 * @param {string} namespace 缓存命名空间。
 * @param {string} key 缓存键。
 * @param {unknown} value 缓存内容。
 * @return {Promise<void>} 写入完成。
 */
export async function writeJsonCache(namespace, key, value) {
    try {
        const cachePath = getCachePath(namespace, key);
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }
    catch {
        // 忽略缓存写入失败，避免影响主流程
    }
}
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
    try {
        const dir = path.dirname(MODEL_LOG_PATH);
        await mkdir(dir, { recursive: true });
        const payload = {
            timestamp: new Date().toISOString(),
            ...entry
        };
        await appendFile(MODEL_LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
    }
    catch {
        // 忽略调试日志写入失败，避免影响主流程
    }
}
/**
 * @description 追加一条中间状态日志。
 * @param {string} stage 阶段名称。
 * @param {Record<string, unknown>} payload 日志负载。
 * @return {Promise<void>} 写入完成。
 */
export async function writePipelineLog(stage, payload) {
    try {
        await mkdir(path.dirname(PIPELINE_LOG_PATH), { recursive: true });
        const entry = {
            timestamp: new Date().toISOString(),
            stage,
            ...payload
        };
        await appendFile(PIPELINE_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    }
    catch {
        // 忽略中间态日志写入失败，避免影响主流程
    }
}
/**
 * @description 获取缓存文件路径。
 * @param {string} namespace 缓存命名空间。
 * @param {string} key 缓存键。
 * @return {string} 缓存文件路径。
 */
function getCachePath(namespace, key) {
    return path.join(CACHE_DIR, namespace, `${key}.json`);
}
