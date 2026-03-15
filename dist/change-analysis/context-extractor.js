import { readFile } from 'node:fs/promises';
import { isHighContextFile } from './file-classifier.js';
/**
 * @description 读取单个文件的最小上下文片段。
 * @param {string} filePath 文件路径。
 * @return {Promise<string>} 上下文片段。
 */
async function readFileContext(filePath) {
    try {
        const content = await readFile(filePath, 'utf8');
        const lines = content.split('\n').slice(0, 80);
        return [`[FILE] ${filePath}`, lines.join('\n')].join('\n');
    }
    catch {
        return '';
    }
}
/**
 * @description 构建高上下文文件摘要。
 * @param {ChangedFile[]} files 文件列表。
 * @param {number} limit 最大处理文件数。
 * @return {Promise<string>} 上下文摘要文本。
 */
export async function buildContextSummary(files, limit = 3) {
    const targets = files.filter((item) => isHighContextFile(item.path)).slice(0, limit);
    const chunks = await Promise.all(targets.map((item) => readFileContext(item.path)));
    return chunks.filter(Boolean).join('\n\n');
}
