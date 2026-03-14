/**
 * @typedef {Object} CommitSuggestion
 * @property {'feat'|'fix'|'chore'} type 提交类型。
 * @property {string} subject 提交标题主体。
 * @property {string[]} bullets 提交摘要要点。
 */
/**
 * @typedef {Object} FileSummaryItem
 * @property {string} status 文件状态。
 * @property {string} path 文件路径。
 * @property {string} kind 文件类别。
 */
/** @type {Set<string>} */
const ALLOWED_TYPES = new Set(['feat', 'fix', 'chore']);
/** @type {Set<string>} */
const PATCH_STOP_WORDS = new Set([
    'const',
    'return',
    'import',
    'from',
    'export',
    'default',
    'function',
    'class',
    'await',
    'async',
    'true',
    'false',
    'null',
    'undefined',
    'string',
    'number',
    'object',
    'array',
    'value',
    'props',
    'state',
    'title',
    'subject',
    'bullets',
    'json',
    'empty',
    'none',
    'prompt',
    'patch',
    'line',
    'lines',
    'color',
    'margin',
    'padding'
]);
/**
 * @description 解析模型返回 JSON。
 * @param {string} raw 模型原始文本。
 * @return {CommitSuggestion} 结构化提交建议。
 */
export function parseSuggestion(raw) {
    const normalized = normalizeRawResponse(raw);
    const candidate = extractJsonCandidate(normalized);
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid model response: not an object');
    }
    const data = normalizeSuggestionObject(/** @type {Record<string, unknown>} */ (parsed));
    if (!ALLOWED_TYPES.has(String(data.type))) {
        throw new Error('Invalid model response: unsupported type');
    }
    if (typeof data.subject !== 'string' || data.subject.trim().length === 0) {
        throw new Error('Invalid model response: missing subject');
    }
    if (!Array.isArray(data.bullets)) {
        throw new Error('Invalid model response: bullets must be array');
    }
    const bullets = data.bullets
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4);
    return {
        type: /** @type {'feat'|'fix'|'chore'} */ (data.type),
        subject: data.subject.trim().slice(0, 50),
        bullets
    };
}
/**
 * @description 规整模型返回对象，兼容不同字段命名与数组格式。
 * @param {Record<string, unknown>} parsed 原始对象。
 * @return {Record<string, unknown>} 规整后的对象。
 */
function normalizeSuggestionObject(parsed) {
    const nested = getNestedSuggestion(parsed);
    const rawType = readFirstStringField(nested, ['type', 'commit_type', 'kind', 'category']);
    const rawSubject = readFirstStringField(nested, ['subject', 'title', 'summary', 'message']);
    const rawBullets = nested.bullets ?? nested.points ?? nested.items ?? nested.changes ?? nested.highlights;
    return {
        type: normalizeType(rawType),
        subject: normalizeSubject(rawSubject),
        bullets: normalizeBullets(rawBullets)
    };
}
/**
 * @description 获取实际承载建议内容的对象。
 * @param {Record<string, unknown>} parsed 原始对象。
 * @return {Record<string, unknown>} 建议对象。
 */
function getNestedSuggestion(parsed) {
    const candidates = [parsed.result, parsed.output, parsed.data, parsed.commit, parsed.suggestion];
    for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            return /** @type {Record<string, unknown>} */ (candidate);
        }
    }
    return parsed;
}
/**
 * @description 读取第一个存在的字符串字段。
 * @param {Record<string, unknown>} value 对象。
 * @param {string[]} keys 字段名列表。
 * @return {string} 字段值。
 */
function readFirstStringField(value, keys) {
    for (const key of keys) {
        const current = value[key];
        if (typeof current === 'string' && current.trim()) {
            return current.trim();
        }
    }
    return '';
}
/**
 * @description 规范化提交类型。
 * @param {string} rawType 原始类型。
 * @return {'feat'|'fix'|'chore'|''} 规整后的类型。
 */
function normalizeType(rawType) {
    const type = rawType.trim().toLowerCase();
    if (['feat', 'feature', 'add', '新增'].includes(type)) {
        return 'feat';
    }
    if (['fix', 'bugfix', 'bug', '修复'].includes(type)) {
        return 'fix';
    }
    if (['chore', 'refactor', 'docs', 'doc', 'style', 'test', '维护'].includes(type)) {
        return 'chore';
    }
    return '';
}
/**
 * @description 规范化标题主体。
 * @param {string} rawSubject 原始标题。
 * @return {string} 规整后的标题。
 */
function normalizeSubject(rawSubject) {
    return rawSubject
        .replace(/^[A-Za-z]+:\s*/, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim();
}
/**
 * @description 规范化 bullets 字段，兼容字符串、数组和对象。
 * @param {unknown} rawBullets 原始 bullets。
 * @return {string[]} 规整后的 bullets。
 */
function normalizeBullets(rawBullets) {
    if (Array.isArray(rawBullets)) {
        return rawBullets
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (typeof rawBullets === 'string') {
        return rawBullets
            .split(/\n|;|；|•|·/)
            .map((item) => item.replace(/^[-*\d.\s]+/, '').trim())
            .filter(Boolean);
    }
    if (rawBullets && typeof rawBullets === 'object') {
        return Object.values(rawBullets)
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}
/**
 * @description 清理模型原始文本中的围栏与多余空白。
 * @param {string} raw 模型原始文本。
 * @return {string} 归一化后的文本。
 */
function normalizeRawResponse(raw) {
    return raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}
/**
 * @description 从自由文本中提取最后一个完整 JSON 对象。
 * @param {string} text 归一化后的模型文本。
 * @return {string} JSON 字符串。
 */
function extractJsonCandidate(text) {
    if (text.startsWith('{') && text.endsWith('}')) {
        return text;
    }
    /** @type {string[]} */
    const candidates = [];
    let depth = 0;
    let start = -1;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '{') {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
            continue;
        }
        if (char === '}') {
            if (depth === 0) {
                continue;
            }
            depth -= 1;
            if (depth === 0 && start !== -1) {
                candidates.push(text.slice(start, index + 1));
                start = -1;
            }
        }
    }
    if (candidates.length > 0) {
        return candidates.at(-1) || '';
    }
    throw new Error('Invalid model response: JSON object not found');
}
/**
 * @description 从 prompt 中提取指定段落。
 * @param {string} prompt 完整提示词。
 * @param {string} section 段落名称。
 * @return {string} 对应段落内容。
 */
function extractSection(prompt, section) {
    const pattern = new RegExp(`\\[${section}\\]\\n([\\s\\S]*?)(?=\\n\\[[A-Z_]+\\]\\n|$)`);
    const matched = prompt.match(pattern);
    return matched?.[1]?.trim() || '';
}
/**
 * @description 解析多行语义提示。
 * @param {string} hints 语义提示文本。
 * @return {string[]} 提示数组。
 */
function parseSemanticHints(hints) {
    return hints
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}
/**
 * @description 从语义提示中提取实体展示名。
 * @param {string[]} hints 语义提示数组。
 * @return {string} 实体展示名。
 */
function extractEntityFromHints(hints) {
    for (const hint of hints) {
        const matched = hint.match(/(新增|补充|增加|完善|优化|修正)\s+(.+?)(?:相关)?(?:爬虫脚本|请求文件|技术方案|实现文档|启动命令)/);
        if (matched?.[2]) {
            return matched[2].trim();
        }
    }
    return '';
}
/**
 * @description 判断提示属于哪类语义簇。
 * @param {string} hint 语义提示。
 * @return {'script'|'request'|'doc'|'command'|'other'} 语义簇。
 */
function classifyHint(hint) {
    if (/爬虫脚本/.test(hint)) {
        return 'script';
    }
    if (/请求文件|抓包样例/.test(hint)) {
        return 'request';
    }
    if (/技术方案|实现文档|文档/.test(hint)) {
        return 'doc';
    }
    if (/启动命令|脚本命令|运行命令/.test(hint)) {
        return 'command';
    }
    return 'other';
}
/**
 * @description 基于语义提示生成结构化提交建议。
 * @param {string[]} hints 语义提示数组。
 * @param {'feat'|'fix'|'chore'} type 提交类型。
 * @return {CommitSuggestion | null} 结构化提交建议。
 */
function buildStructuredSuggestionFromHints(hints, type) {
    if (hints.length === 0) {
        return null;
    }
    const entity = extractEntityFromHints(hints);
    const categories = new Set(hints.map((hint) => classifyHint(hint)));
    const prefix = type === 'fix' ? '修正' : type === 'feat' ? '新增' : '调整';
    /** @type {string} */
    let subject = '';
    if (categories.has('script') && categories.has('request') && categories.has('doc') && categories.has('command')) {
        subject = `${prefix}${entity || ''}爬虫脚本与配套资源`;
    }
    else if (categories.has('script') && categories.has('command')) {
        subject = `${prefix}${entity || ''}爬虫脚本与启动命令`;
    }
    else if (categories.has('request') && categories.has('doc')) {
        subject = `${prefix}${entity || ''}请求文件与技术方案文档`;
    }
    else if (categories.has('script')) {
        subject = `${prefix}${entity || ''}爬虫脚本`;
    }
    else {
        subject = `${prefix}${entity || ''}相关能力`;
    }
    /** @type {string[]} */
    const bullets = [];
    if (categories.has('script')) {
        bullets.push(`${type === 'fix' ? '修正' : '增加'}${entity || ''}相关爬虫脚本`);
    }
    if (categories.has('request')) {
        bullets.push(`${type === 'fix' ? '修正' : '补充'}${entity || ''}请求文件`);
    }
    if (categories.has('doc')) {
        bullets.push(`${type === 'fix' ? '修正' : '补充'}${entity || ''}技术方案文档`);
    }
    if (categories.has('command')) {
        bullets.push(`${type === 'fix' ? '修正' : '增加'}启动命令`);
    }
    return {
        type,
        subject: subject.slice(0, 30),
        bullets: bullets.slice(0, 4)
    };
}
/**
 * @description 解析文件级摘要。
 * @param {string} summary 文件级摘要文本。
 * @return {FileSummaryItem[]} 结构化文件摘要。
 */
function parseFileSummary(summary) {
    return summary
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [status, filePath, kind] = line.split('\t');
        return {
            status: status || 'M',
            path: filePath || '',
            kind: kind || 'normal'
        };
    })
        .filter((item) => item.path);
}
/**
 * @description 判断文本中是否更偏向修复语义。
 * @param {string} text 综合分析文本。
 * @return {'feat'|'fix'|'chore'} 推断后的提交类型。
 */
function inferType(text) {
    const fixMatches = text.match(/(fix|bug|error|fail|crash|兼容|修复|兜底|fallback|异常|回退|cache invalidation)/gi) || [];
    const featMatches = text.match(/(add|implement|support|introduce|新增|补充|实现|支持|引入|增强|优化|cache|timing|profile|provider|token|doctor|config|install|plugin|脚本|命令|文档|请求文件|爬虫)/gi) || [];
    if (featMatches.length > fixMatches.length) {
        return 'feat';
    }
    if (fixMatches.length > 0) {
        return 'fix';
    }
    return 'chore';
}
/**
 * @description 从补丁中提取有效变更行。
 * @param {string} patch 补丁文本。
 * @return {string[]} 变更行数组。
 */
function getMeaningfulPatchLines(patch) {
    return patch
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^[+-]/.test(line))
        .filter((line) => !/^\+\+\+|^---|^@@/.test(line))
        .map((line) => line.slice(1).trim())
        .filter(Boolean)
        .slice(0, 240);
}
/**
 * @description 从变更行中提取关键词频次。
 * @param {string[]} lines 变更行数组。
 * @return {Map<string, {count: number; label: string}>} 关键词频次表。
 */
function collectPatchKeywords(lines) {
    /** @type {Map<string, {count: number; label: string}>} */
    const frequency = new Map();
    lines.forEach((line) => {
        const words = line.match(/[A-Za-z][A-Za-z0-9._/-]{2,}/g) || [];
        words.forEach((word) => {
            const normalized = word.toLowerCase();
            if (PATCH_STOP_WORDS.has(normalized)) {
                return;
            }
            const current = frequency.get(normalized);
            if (current) {
                current.count += 1;
                return;
            }
            frequency.set(normalized, { count: 1, label: word });
        });
    });
    return frequency;
}
/**
 * @description 获取高频关键词列表。
 * @param {Map<string, {count: number; label: string}>} frequency 关键词频次表。
 * @param {number} limit 最大数量。
 * @return {string[]} 关键词数组。
 */
function getTopKeywords(frequency, limit = 4) {
    return Array.from(frequency.entries())
        .sort((left, right) => {
        if (right[1].count !== left[1].count) {
            return right[1].count - left[1].count;
        }
        return left[0].localeCompare(right[0]);
    })
        .map(([, value]) => value.label)
        .slice(0, limit);
}
/**
 * @description 提取最具代表性的文件名。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {number} limit 最大数量。
 * @return {string[]} 文件名数组。
 */
function getTopFileNames(files, limit = 2) {
    return files
        .map((item) => item.path.split('/').at(-1) || item.path)
        .filter(Boolean)
        .slice(0, limit);
}
/**
 * @description 基于路径与关键词判断主题焦点。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {string[]} keywords 关键词列表。
 * @return {string} 主题焦点。
 */
function inferFocus(files, keywords) {
    const joinedPaths = files.map((item) => item.path.toLowerCase()).join(' ');
    const joinedKeywords = keywords.join(' ');
    if (/(prompt|summary|semantic|subject|bullet|fallback|parser|json)/.test(joinedPaths + joinedKeywords)) {
        return '摘要生成逻辑';
    }
    if (/(timing|duration|performance|latency|slow|cache)/.test(joinedKeywords)) {
        return '生成性能';
    }
    if (/(provider|model|openai|zhipu|glm)/.test(joinedPaths + joinedKeywords)) {
        return '模型调用流程';
    }
    if (/(doctor|token)/.test(joinedPaths + joinedKeywords)) {
        return '诊断与统计输出';
    }
    if (/(config|profile|zshrc|\.env)/.test(joinedPaths + joinedKeywords)) {
        return '配置切换流程';
    }
    if (/(commit|push|stage|git)/.test(joinedPaths + joinedKeywords)) {
        return '提交流程';
    }
    if (/(cli|ink)/.test(joinedPaths)) {
        return '终端交互体验';
    }
    return '代码变更总结';
}
/**
 * @description 推断变更带来的主要价值。
 * @param {string} focus 主题焦点。
 * @param {string[]} keywords 关键词列表。
 * @return {string} 价值描述。
 */
function inferValue(focus, keywords) {
    const joinedKeywords = keywords.join(' ');
    if (/(timing|duration|performance|latency|slow|cache)/i.test(joinedKeywords)) {
        return '执行性能';
    }
    if (/(parser|json|fallback|reasoning|format)/i.test(joinedKeywords)) {
        return '结果解析稳定性';
    }
    if (/(prompt|summary|semantic|subject|bullet)/i.test(joinedKeywords)) {
        return '语义概括能力';
    }
    if (/(doctor|token|metric|duration)/i.test(joinedKeywords)) {
        return '诊断可观测性';
    }
    if (/(provider|model|openai|zhipu|glm)/i.test(joinedKeywords)) {
        return '模型调用稳定性';
    }
    if (focus === '终端交互体验') {
        return '交互反馈一致性';
    }
    return '稳定性与可维护性';
}
/**
 * @description 生成更细粒度的中文主题。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {string[]} keywords 关键词列表。
 * @param {'feat'|'fix'|'chore'} type 提交类型。
 * @return {string} 中文主题。
 */
function inferSubject(files, keywords, type) {
    const focus = inferFocus(files, keywords);
    const value = inferValue(focus, keywords);
    const fileNames = getTopFileNames(files);
    /** @type {string} */
    let subject = '';
    if (keywords.length > 0 || fileNames.length > 0) {
        subject = `${type === 'fix' ? '修正' : type === 'feat' ? '增强' : '调整'}${focus}的${value}`;
    }
    else if (fileNames.length > 0) {
        subject = `${type === 'fix' ? '修正' : type === 'feat' ? '增强' : '调整'}${focus}相关能力`;
    }
    else {
        subject = `更新 gai ${focus}`;
    }
    return subject.slice(0, 30);
}
/**
 * @description 将语义提示转为更稳定的主题。
 * @param {string[]} hints 语义提示数组。
 * @param {'feat'|'fix'|'chore'} type 提交类型。
 * @return {string} 主题文本。
 */
function inferSubjectFromHints(hints, type) {
    const structured = buildStructuredSuggestionFromHints(hints, type);
    if (structured) {
        return structured.subject;
    }
    const normalized = hints.join(' ');
    if (/爬虫脚本/.test(normalized) && /启动命令/.test(normalized)) {
        return `${type === 'fix' ? '修正' : '新增'}爬虫脚本与启动命令`;
    }
    if (/请求文件/.test(normalized) && /技术方案|实现文档/.test(normalized)) {
        return `${type === 'fix' ? '修正' : '补充'}请求文件与技术方案文档`;
    }
    if (hints.length > 0) {
        return hints[0].replace(/^补充|^新增|^新增对应|^修正/, type === 'fix' ? '修正' : '新增').slice(0, 30);
    }
    return '';
}
/**
 * @description 根据文件与补丁生成更动态的要点。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {string[]} lines 变更行数组。
 * @param {string[]} keywords 关键词列表。
 * @param {string} focus 主题焦点。
 * @return {string[]} 中文摘要要点。
 */
function inferBullets(files, lines, keywords, focus) {
    /** @type {string[]} */
    const bullets = [];
    const fileNames = getTopFileNames(files, 3);
    const value = inferValue(focus, keywords);
    const keywordText = keywords.slice(0, 3).join(' / ');
    bullets.push(`围绕 ${focus} 做集中调整，重点提升 ${value}`);
    if (keywordText) {
        bullets.push(`将 ${keywordText} 等改动收敛为更高层的语义描述`);
    }
    if (lines.length > 0) {
        const sample = lines
            .find((line) => !/^\s*(import|export)\b/.test(line) && !/\b(empty|none|todo|fixme)\b/i.test(line) && !/(blocks\.push|slice\(|join\(|filter\(|map\()/i.test(line))
            ?.replace(/\s+/g, ' ')
            .slice(0, 36);
        if (sample) {
            bullets.push(`主要变更围绕 ${sample} 等逻辑展开，并直接影响 ${focus}`);
        }
    }
    const statusSummary = files.map((item) => item.status).join('');
    if (/A/.test(statusSummary)) {
        bullets.push(`新增实现主要服务于 ${focus} 的能力补齐`);
    }
    else if (/D/.test(statusSummary)) {
        bullets.push(`移除冗余实现以简化 ${focus} 的处理链路`);
    }
    else {
        bullets.push(`同步细化 ${focus} 的边界与一致性处理`);
    }
    if (fileNames.length > 0) {
        bullets.push(`改动主要落在 ${fileNames.join('、')}，但语义焦点保持在 ${focus}`);
    }
    return Array.from(new Set(bullets)).slice(0, 4);
}
/**
 * @description 基于语义提示生成优先级更高的摘要要点。
 * @param {string[]} hints 语义提示数组。
 * @param {'feat'|'fix'|'chore'} type 提交类型。
 * @return {string[]} 摘要要点。
 */
function inferBulletsFromHints(hints, type) {
    const structured = buildStructuredSuggestionFromHints(hints, type);
    if (structured) {
        return structured.bullets;
    }
    return hints
        .map((item) => item.replace(/^新增对应/, '新增'))
        .slice(0, 4);
}
/**
 * @description 构建本地兜底提交建议。
 * @param {string} prompt 完整提示词。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {CommitSuggestion} 本地推断的提交建议。
 */
export function buildFallbackSuggestion(prompt, reasoning) {
    const files = parseFileSummary(extractSection(prompt, 'FILE_SUMMARY'));
    const patch = extractSection(prompt, 'PATCH');
    const semanticHints = parseSemanticHints(extractSection(prompt, 'SEMANTIC_HINTS'));
    const groupSummary = extractSection(prompt, 'GROUP_SUMMARY');
    const lines = getMeaningfulPatchLines(patch);
    const keywords = getTopKeywords(collectPatchKeywords(lines));
    const sourceText = [semanticHints.join('\n'), groupSummary, lines.join('\n'), reasoning].filter(Boolean).join('\n');
    const type = inferType(sourceText);
    const focus = inferFocus(files, keywords);
    const hintSubject = inferSubjectFromHints(semanticHints, type);
    const bullets = semanticHints.length > 0 ? inferBulletsFromHints(semanticHints, type) : inferBullets(files, lines, keywords, focus);
    return {
        type,
        subject: hintSubject || inferSubject(files, keywords, type),
        bullets: bullets.length > 0 ? bullets : [`调整 gai ${focus}`]
    };
}
/**
 * @description 从 reasoning 文本中提取更贴近用户语义的动作提示。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {string[]} 语义提示数组。
 */
function extractReasoningHints(reasoning) {
    const matches = reasoning.match(/(新增|补充|增加|完善|优化|修正|支持|引入|重构)[^。；\n]*?/g) || [];
    return Array.from(new Set(matches.map((item) => item.replace(/[`*"“”]/g, '').trim()).filter((item) => item.length >= 4))).slice(0, 4);
}
/**
 * @description 基于智谱 reasoning 文本构建提交建议。
 * @param {string} prompt 完整提示词。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {CommitSuggestion} 提交建议。
 */
export function buildSuggestionFromReasoning(prompt, reasoning) {
    const reasoningHints = extractReasoningHints(reasoning);
    if (reasoningHints.length === 0) {
        return buildFallbackSuggestion(prompt, reasoning);
    }
    const mergedPrompt = reasoningHints.length > 0
        ? `${prompt}\n\n[SEMANTIC_HINTS]\n${reasoningHints.join('\n')}`
        : prompt;
    return buildFallbackSuggestion(mergedPrompt, reasoning);
}
