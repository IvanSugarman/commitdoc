#!/usr/bin/env node
import dotenv from 'dotenv';
import {execFile} from 'node:child_process';
import {access, appendFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import readline from 'node:readline/promises';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {applyCommitAndPush, getChangesForSummary, isGitRepo} from './git.mjs';
import {generateSuggestion, getProviderDefaults, getProviderName, getResolvedProviderConfig} from './openai.mjs';
import {buildPrompt} from './prompt.mjs';

/** @type {(file: string, args: string[]) => Promise<{stdout: string; stderr: string}>} */
const execFileAsync = promisify(execFile);

/** @type {readonly string[]} */
const MENU_OPTIONS = ['Confirm', 'Regenerate', 'Cancel'];

/** @type {typeof React.createElement} */
const h = React.createElement;

/** @type {string} */
const CLI_PATH = fileURLToPath(import.meta.url);

/** @type {string} */
const PROJECT_ROOT = path.dirname(path.dirname(CLI_PATH));

/** @type {string} */
const ENV_DIR = path.join(PROJECT_ROOT, '.env');

/** @type {string} */
const ACTIVE_ENV_PATH = path.join(ENV_DIR, 'active.env');

dotenv.config({
  path: ACTIVE_ENV_PATH,
  override: true
});

/** @type {string} */
const ZSHRC_PATH = path.join(os.homedir(), '.zshrc');

/** @type {string} */
const PROFILE_DIR = path.join(ENV_DIR, 'profiles');

/** @type {string} */
const ACTIVE_PROFILE_PATH = path.join(ENV_DIR, 'active-profile');

/** @type {string} */
const INSTALL_BLOCK_START = '# GAI_CLI:START';

/** @type {string} */
const INSTALL_BLOCK_END = '# GAI_CLI:END';

/** @type {{ GAI_PROVIDER: string; GAI_API_KEY: string; GAI_BASE_URL: string; GAI_MODEL: string; GAI_FORMAT_MODEL: string; GAI_DISABLE_THINKING: string }} */
const DEFAULT_ENV = {
  GAI_PROVIDER: 'zhipu',
  GAI_API_KEY: '',
  GAI_BASE_URL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  GAI_MODEL: 'glm-4.7',
  GAI_FORMAT_MODEL: 'glm-4.7-flash',
  GAI_DISABLE_THINKING: 'true'
};

/**
 * @typedef {Object} SuggestionViewModel
 * @property {string} title 完整提交标题。
 * @property {string[]} bullets 变更摘要。
 */

/**
 * @typedef {Object} StepState
 * @property {'add'|'commit'|'push'} name 步骤名称。
 * @property {'idle'|'running'|'success'} status 步骤状态。
 */

/**
 * @typedef {Object} DoctorItem
 * @property {string} name 检查项名称。
 * @property {'pass'|'warn'|'fail'} status 检查结果。
 * @property {string} detail 详细说明。
 */

/**
 * @typedef {Object} TokenDoctorResult
 * @property {'staged'|'working-tree'} source 变更来源。
 * @property {'incremental'|'contextual'|'compressed'} strategy 摘要策略。
 * @property {number} fileCount 文件数。
 * @property {number} ignoredFileCount 被忽略文件数。
 * @property {number} highContextFileCount 高上下文文件数。
 * @property {number} nameStatusChars 文件状态字符数。
 * @property {number} fileSummaryChars 文件摘要字符数。
 * @property {number} contextSummaryChars 上下文字符数。
 * @property {number} patchChars 补丁字符数。
 * @property {number} promptChars Prompt 字符数。
 * @property {number} estimatedInputTokens 估算输入 token 数。
 * @property {string} provider Provider 展示名称。
 * @property {string[]} notes 说明列表。
 */

/**
 * @description 执行命令并返回 stdout。
 * @param {string} file 可执行文件名。
 * @param {string[]} args 参数列表。
 * @return {Promise<string>} 标准输出文本。
 */
async function runCommand(file, args) {
  const {stdout} = await execFileAsync(file, args, {maxBuffer: 1024 * 1024});
  return stdout.trim();
}

/**
 * @description 解析 env 文本内容。
 * @param {string} content env 文件内容。
 * @return {Record<string, string>} 解析后的键值对。
 */
function parseEnvContent(content) {
  /** @type {Record<string, string>} */
  const result = {};

  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) {
      result[key] = value;
    }
  });

  return result;
}

/**
 * @description 构建 env 文件内容，同时保留非 gai 配置。
 * @param {Record<string, string>} current 当前 env 配置。
 * @param {{ GAI_PROVIDER: string; GAI_API_KEY: string; GAI_BASE_URL: string; GAI_MODEL: string; GAI_FORMAT_MODEL: string; GAI_DISABLE_THINKING: string }} next 下一版配置。
 * @return {string} 新的 env 文件内容。
 */
function buildEnvFileContent(current, next) {
  /** @type {string[]} */
  const preserved = [];

  Object.entries(current).forEach(([key, value]) => {
    if (!['GAI_PROVIDER', 'GAI_API_KEY', 'GAI_BASE_URL', 'GAI_MODEL', 'GAI_FORMAT_MODEL', 'GAI_DISABLE_THINKING'].includes(key)) {
      preserved.push(`${key}=${value}`);
    }
  });

  return [
    `GAI_PROVIDER=${next.GAI_PROVIDER}`,
    `GAI_API_KEY=${next.GAI_API_KEY}`,
    `GAI_BASE_URL=${next.GAI_BASE_URL}`,
    `GAI_MODEL=${next.GAI_MODEL}`,
    `GAI_FORMAT_MODEL=${next.GAI_FORMAT_MODEL}`,
    `GAI_DISABLE_THINKING=${next.GAI_DISABLE_THINKING}`,
    ...preserved
  ].join('\n') + '\n';
}

/**
 * @description 读取当前 env 配置。
 * @return {Promise<Record<string, string>>} 当前 env 键值对。
 */
async function readEnvConfig() {
  try {
    const content = await readFile(ACTIVE_ENV_PATH, 'utf8');
    return parseEnvContent(content);
  } catch {
    return {};
  }
}

/**
 * @description 确保 profile 目录结构存在，并初始化默认 profile。
 * @return {Promise<void>} 初始化完成。
 */
async function ensureProfileStorage() {
  await mkdir(PROFILE_DIR, {recursive: true});

  /** @type {string} */
  let activeProfile = '';
  try {
    activeProfile = (await readFile(ACTIVE_PROFILE_PATH, 'utf8')).trim();
  } catch {
    activeProfile = '';
  }

  const currentEnv = await readEnvConfig();
  const provider = currentEnv.GAI_PROVIDER || DEFAULT_ENV.GAI_PROVIDER;
  const derivedProfileName = activeProfile || `${provider}-${currentEnv.GAI_MODEL || DEFAULT_ENV.GAI_MODEL}`.replace(/[^a-zA-Z0-9.-]+/g, '-').toLowerCase();
  const profilePath = path.join(PROFILE_DIR, `${derivedProfileName}.env`);

  try {
    await access(profilePath);
  } catch {
    const content = buildEnvFileContent({}, {
      GAI_PROVIDER: currentEnv.GAI_PROVIDER || DEFAULT_ENV.GAI_PROVIDER,
      GAI_API_KEY: currentEnv.GAI_API_KEY || DEFAULT_ENV.GAI_API_KEY,
      GAI_BASE_URL: currentEnv.GAI_BASE_URL || DEFAULT_ENV.GAI_BASE_URL,
      GAI_MODEL: currentEnv.GAI_MODEL || DEFAULT_ENV.GAI_MODEL,
      GAI_FORMAT_MODEL: currentEnv.GAI_FORMAT_MODEL || DEFAULT_ENV.GAI_FORMAT_MODEL,
      GAI_DISABLE_THINKING: currentEnv.GAI_DISABLE_THINKING || DEFAULT_ENV.GAI_DISABLE_THINKING
    });
    await writeFile(profilePath, content, 'utf8');
  }

  await writeFile(ACTIVE_PROFILE_PATH, `${derivedProfileName}\n`, 'utf8');
}

/**
 * @description 获取当前激活 profile 名称。
 * @return {Promise<string>} 激活 profile 名称。
 */
async function getActiveProfileName() {
  await ensureProfileStorage();
  return (await readFile(ACTIVE_PROFILE_PATH, 'utf8')).trim();
}

/**
 * @description 获取 profile 文件路径。
 * @param {string} profileName profile 名称。
 * @return {string} profile 文件路径。
 */
function getProfilePath(profileName) {
  return path.join(PROFILE_DIR, `${profileName}.env`);
}

/**
 * @description 读取指定 profile 配置。
 * @param {string} profileName profile 名称。
 * @return {Promise<Record<string, string>>} profile 配置。
 */
async function readProfileConfig(profileName) {
  const content = await readFile(getProfilePath(profileName), 'utf8');
  return parseEnvContent(content);
}

/**
 * @description 列出全部 profile。
 * @return {Promise<string[]>} profile 名称列表。
 */
async function listProfiles() {
  await ensureProfileStorage();
  const files = await readdir(PROFILE_DIR);
  return files
    .filter((file) => file.endsWith('.env'))
    .map((file) => file.replace(/\.env$/, ''))
    .sort();
}

/**
 * @description 将指定 profile 同步为当前生效 .env。
 * @param {string} profileName profile 名称。
 * @return {Promise<void>} 同步完成。
 */
async function syncProfileToEnv(profileName) {
  const profileConfig = await readProfileConfig(profileName);
  const currentEnv = await readEnvConfig();
  const content = buildEnvFileContent(currentEnv, {
    GAI_PROVIDER: profileConfig.GAI_PROVIDER || DEFAULT_ENV.GAI_PROVIDER,
    GAI_API_KEY: profileConfig.GAI_API_KEY || DEFAULT_ENV.GAI_API_KEY,
    GAI_BASE_URL: profileConfig.GAI_BASE_URL || DEFAULT_ENV.GAI_BASE_URL,
    GAI_MODEL: profileConfig.GAI_MODEL || DEFAULT_ENV.GAI_MODEL,
    GAI_FORMAT_MODEL: profileConfig.GAI_FORMAT_MODEL || DEFAULT_ENV.GAI_FORMAT_MODEL,
    GAI_DISABLE_THINKING: profileConfig.GAI_DISABLE_THINKING || DEFAULT_ENV.GAI_DISABLE_THINKING
  });
  await writeFile(ACTIVE_ENV_PATH, content, 'utf8');
  await writeFile(ACTIVE_PROFILE_PATH, `${profileName}\n`, 'utf8');
}

/**
 * @description 一键切换当前激活模型 profile。
 * @param {string | undefined} profileName profile 名称。
 * @return {Promise<void>} 切换完成。
 */
async function useProfile(profileName) {
  if (!profileName) {
    throw new Error('Profile name is required. Usage: gai use <profile>');
  }

  await ensureProfileStorage();
  const profilePath = getProfilePath(profileName);
  try {
    await access(profilePath);
  } catch {
    throw new Error(`Profile not found: ${profileName}`);
  }

  await syncProfileToEnv(profileName);
  const config = await readProfileConfig(profileName);
  process.stdout.write(`已切换到 profile: ${profileName}\n`);
  process.stdout.write(`provider=${config.GAI_PROVIDER || DEFAULT_ENV.GAI_PROVIDER}\n`);
  process.stdout.write(`model=${config.GAI_MODEL || DEFAULT_ENV.GAI_MODEL}\n`);
  process.stdout.write(`baseURL=${config.GAI_BASE_URL || DEFAULT_ENV.GAI_BASE_URL}\n`);
}

/**
 * @description 输出全部 profile 列表。
 * @return {Promise<void>} 输出完成。
 */
async function printProfiles() {
  const profiles = await listProfiles();
  const active = await getActiveProfileName();

  process.stdout.write('gai profiles\n\n');
  profiles.forEach((profile) => {
    process.stdout.write(`${profile === active ? '*' : ' '} ${profile}\n`);
  });
}

/**
 * @description 交互式读取配置值。
 * @param {readline.Interface} rl readline 实例。
 * @param {string} label 提示文案。
 * @param {string} fallback 默认值。
 * @param {boolean} mask 是否隐藏默认值。
 * @return {Promise<string>} 用户输入或默认值。
 */
async function promptField(rl, label, fallback, mask = false) {
  const suffix = fallback ? (mask ? ' [已设置]' : ` [${fallback}]`) : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

/**
 * @description 生成 shell 安装片段。
 * @return {string} zshrc 片段内容。
 */
function buildInstallBlock() {
  return [
    INSTALL_BLOCK_START,
    '# Run local gai CLI from current workspace',
    'function gai() {',
    `  node ${CLI_PATH} "$@"`,
    '}',
    INSTALL_BLOCK_END
  ].join('\n');
}

/**
 * @description 将 gai 命令安装到 zshrc 并做可用性校验。
 * @return {Promise<void>} 安装流程完成。
 */
async function installToZshrc() {
  try {
    await access(ZSHRC_PATH);
  } catch {
    await writeFile(ZSHRC_PATH, '', 'utf8');
  }

  const current = await readFile(ZSHRC_PATH, 'utf8');
  const block = buildInstallBlock();

  if (!current.includes(INSTALL_BLOCK_START)) {
    const prefix = current.endsWith('\n') || current.length === 0 ? '' : '\n';
    await appendFile(ZSHRC_PATH, `${prefix}\n${block}\n`, 'utf8');
  }

  await execFileAsync('zsh', ['-ic', 'source ~/.zshrc && type gai'], {
    maxBuffer: 1024 * 1024
  });

  process.stdout.write(`已写入 ${ZSHRC_PATH}\n`);
  process.stdout.write('已在新的 zsh 子进程中完成 source 校验。\n');
  process.stdout.write('如果当前终端仍未刷新，请执行: source ~/.zshrc\n');
}

/**
 * @description 执行 doctor 检查。
 * @return {Promise<DoctorItem[]>} 检查结果数组。
 */
async function runDoctor() {
  const items = [];
  const majorVersion = Number(process.versions.node.split('.')[0] || '0');
  items.push({
    name: 'Node.js',
    status: majorVersion >= 18 ? 'pass' : 'fail',
    detail: `当前版本 ${process.version}${majorVersion >= 18 ? '' : '，要求 >= 18'}`
  });

  try {
    const gitVersion = await runCommand('git', ['--version']);
    items.push({name: 'Git', status: 'pass', detail: gitVersion});
  } catch {
    items.push({name: 'Git', status: 'fail', detail: '未检测到 git 命令'});
  }

  const repo = await isGitRepo();
  items.push({
    name: 'Git Repository',
    status: repo ? 'pass' : 'warn',
    detail: repo ? '当前目录位于 Git 仓库内' : '当前目录不在 Git 仓库内，gai 主流程不可用'
  });

  try {
    await access(ACTIVE_ENV_PATH);
    items.push({name: '.env/active.env', status: 'pass', detail: `${ACTIVE_ENV_PATH} 已存在`});
  } catch {
    items.push({name: '.env/active.env', status: 'warn', detail: `${ACTIVE_ENV_PATH} 不存在，可执行 gai config 自动生成`});
  }

  try {
    await ensureProfileStorage();
    const activeProfile = await getActiveProfileName();
    const profiles = await listProfiles();
    items.push({name: 'Profiles', status: 'pass', detail: `active=${activeProfile}, total=${profiles.length}`});
  } catch {
    items.push({name: 'Profiles', status: 'warn', detail: 'profile 存储尚未初始化'});
  }

  const envConfig = await readEnvConfig();
  const apiKey = envConfig.GAI_API_KEY || process.env.GAI_API_KEY || '';
  const providerName = envConfig.GAI_PROVIDER || process.env.GAI_PROVIDER || getProviderName();
  let providerConfig = {
    model: envConfig.GAI_MODEL || process.env.GAI_MODEL || DEFAULT_ENV.GAI_MODEL,
    formatModel: envConfig.GAI_FORMAT_MODEL || process.env.GAI_FORMAT_MODEL || DEFAULT_ENV.GAI_FORMAT_MODEL,
    baseURL: envConfig.GAI_BASE_URL || process.env.GAI_BASE_URL || DEFAULT_ENV.GAI_BASE_URL,
    disableThinking: (envConfig.GAI_DISABLE_THINKING || process.env.GAI_DISABLE_THINKING || DEFAULT_ENV.GAI_DISABLE_THINKING) !== 'false'
  };
  try {
    providerConfig = getResolvedProviderConfig();
  } catch {
    // 保持使用基于 env 的兜底配置，避免 doctor 因缺少 key 中断
  }

  items.push({name: 'GAI_API_KEY', status: apiKey ? 'pass' : 'fail', detail: apiKey ? '已配置' : '缺少 GAI_API_KEY，可执行 gai config 设置'});
  items.push({name: 'Provider Config', status: providerName ? 'pass' : 'warn', detail: `provider=${providerName}, model=${providerConfig.model}, formatModel=${providerConfig.formatModel}`});
  items.push({name: 'Provider Endpoint', status: providerConfig.baseURL ? 'pass' : 'warn', detail: `baseURL=${providerConfig.baseURL}, disableThinking=${providerConfig.disableThinking ? 'true' : 'false'}`});

  try {
    const current = await readFile(ZSHRC_PATH, 'utf8');
    items.push({name: 'Shell Install', status: current.includes(INSTALL_BLOCK_START) ? 'pass' : 'warn', detail: current.includes(INSTALL_BLOCK_START) ? '已写入 ~/.zshrc' : '尚未安装到 ~/.zshrc，可执行 gai install'});
  } catch {
    items.push({name: 'Shell Install', status: 'warn', detail: '未找到 ~/.zshrc，可执行 gai install 自动创建'});
  }

  try {
    const typeOutput = await runCommand('zsh', ['-ic', 'type gai']);
    items.push({name: 'Shell Resolve', status: typeOutput.includes('gai is') ? 'pass' : 'warn', detail: typeOutput || '当前 zsh 会话未识别 gai'});
  } catch {
    items.push({name: 'Shell Resolve', status: 'warn', detail: '新的 zsh 子进程未识别 gai，可能需要执行 gai install 或 source ~/.zshrc'});
  }

  return items;
}

async function printDoctor() {
  const items = await runDoctor();
  process.stdout.write('gai doctor\n\n');
  items.forEach((item) => {
    const icon = item.status === 'pass' ? '[ok]' : item.status === 'warn' ? '[!]' : '[x]';
    process.stdout.write(`${icon} ${item.name}\n`);
    process.stdout.write(`    ${item.detail}\n`);
  });
  const hasFail = items.some((item) => item.status === 'fail');
  const hasWarn = items.some((item) => item.status === 'warn');
  process.stdout.write('\n');
  process.stdout.write(hasFail ? '结果: 存在阻塞问题，需要先修复失败项。\n' : hasWarn ? '结果: 基本可用，但仍有建议处理的警告项。\n' : '结果: 环境检查通过。\n');
}

function estimateTokens(chars) {
  return Math.ceil(chars / 3.2);
}

async function analyzeTokenUsage() {
  if (!(await isGitRepo())) {
    throw new Error('Current directory is not a git repository.');
  }

  const summary = await getChangesForSummary();
  if (!summary.nameStatus || !summary.patch) {
    throw new Error('No changes found in staged or working tree.');
  }

  const prompt = buildPrompt(summary);
  const notes = [];

  if (summary.ignoredFileCount > 0) {
    notes.push(`已忽略 ${summary.ignoredFileCount} 个低价值文件，减少无效 token 消耗`);
  }
  if (summary.strategy === 'incremental') {
    notes.push('当前改动较小，直接使用增量 patch');
  }
  if (summary.strategy === 'contextual') {
    notes.push('当前改动中等，补充文件摘要与关键上下文以稳定总结质量');
  }
  if (summary.strategy === 'compressed') {
    notes.push('当前改动较大，已压缩 patch 并限制上下文范围');
  }
  if (summary.highContextFileCount > 0) {
    notes.push(`检测到 ${summary.highContextFileCount} 个高上下文文件，已优先补充关键上下文`);
  }

  return {
    source: summary.source,
    strategy: summary.strategy,
    provider: getProviderLabel(),
    fileCount: summary.stats.fileCount,
    ignoredFileCount: summary.stats.ignoredFileCount,
    highContextFileCount: summary.stats.highContextFileCount,
    nameStatusChars: summary.nameStatus.length,
    fileSummaryChars: summary.fileSummary.length,
    contextSummaryChars: summary.contextSummary.length,
    patchChars: summary.patch.length,
    promptChars: prompt.length,
    estimatedInputTokens: estimateTokens(prompt.length),
    notes
  };
}

function getSourceLabel(source) {
  return source === 'staged' ? '暂存区改动' : '工作区改动';
}

function getStrategyLabel(strategy) {
  return strategy === 'incremental' ? '增量' : strategy === 'contextual' ? '增量 + 上下文' : '压缩摘要';
}

function getProviderLabel() {
  const provider = process.env.GAI_PROVIDER || 'zhipu';
  const model = process.env.GAI_MODEL || DEFAULT_ENV.GAI_MODEL;
  return `${provider} / ${model}`;
}

function TokenDoctorApp() {
  const {exit} = useApp();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    analyzeTokenUsage()
      .then((value) => {
        if (!active) return;
        setResult(value);
        setTimeout(() => exit(), 0);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setTimeout(() => exit(), 0);
      });
    return () => {
      active = false;
    };
  }, [exit]);

  if (error) {
    return h(Box, {flexDirection: 'column', padding: 1}, [h(Text, {key: 'title', color: 'cyan'}, 'gai doctor --token'), h(Text, {key: 'error', color: 'red'}, `Error: ${error}`)]);
  }
  if (!result) {
    return h(Box, {flexDirection: 'column', padding: 1}, [h(Text, {key: 'title', color: 'cyan'}, 'gai doctor --token'), h(Text, {key: 'loading', color: 'yellow'}, '正在分析当前改动的 token 使用...')]);
  }

  return h(Box, {flexDirection: 'column', padding: 1}, [
    h(Text, {key: 'title', color: 'cyan'}, 'gai doctor --token'),
    h(Box, {key: 'summary-box', flexDirection: 'column', marginTop: 1}, [
      h(Text, {key: 'source', color: 'green'}, `来源: ${getSourceLabel(result.source)}`),
      h(Text, {key: 'strategy', color: 'green'}, `策略: ${getStrategyLabel(result.strategy)}`),
      h(Text, {key: 'provider'}, `Provider: ${result.provider}`),
      h(Text, {key: 'files'}, `文件数: ${result.fileCount}`),
      h(Text, {key: 'ignored'}, `忽略文件数: ${result.ignoredFileCount}`),
      h(Text, {key: 'high-context'}, `高上下文文件数: ${result.highContextFileCount}`)
    ]),
    h(Box, {key: 'size-box', flexDirection: 'column', marginTop: 1}, [
      h(Text, {key: 'size-title', color: 'green'}, '体积统计'),
      h(Text, {key: 'name-status'}, `nameStatus chars: ${result.nameStatusChars}`),
      h(Text, {key: 'file-summary'}, `fileSummary chars: ${result.fileSummaryChars}`),
      h(Text, {key: 'context-summary'}, `contextSummary chars: ${result.contextSummaryChars}`),
      h(Text, {key: 'patch'}, `patch chars: ${result.patchChars}`),
      h(Text, {key: 'prompt'}, `prompt chars: ${result.promptChars}`),
      h(Text, {key: 'tokens', color: 'yellow'}, `estimated input tokens: ${result.estimatedInputTokens}`)
    ]),
    h(Box, {key: 'notes-box', flexDirection: 'column', marginTop: 1}, [
      h(Text, {key: 'notes-title', color: 'green'}, '说明'),
      ...result.notes.map((note, index) => h(Text, {key: `note-${index}`}, `- ${note}`))
    ])
  ]);
}

async function runConfig() {
  await ensureProfileStorage();
  const activeProfile = await getActiveProfileName();
  const current = await readProfileConfig(activeProfile);

  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  try {
    const provider = await promptField(rl, '请输入 GAI_PROVIDER', current.GAI_PROVIDER || DEFAULT_ENV.GAI_PROVIDER);
    const providerDefaults = getProviderDefaults(provider);
    const providerChanged = (current.GAI_PROVIDER || DEFAULT_ENV.GAI_PROVIDER) !== provider;
    const apiKey = await promptField(rl, '请输入 GAI_API_KEY', current.GAI_API_KEY || DEFAULT_ENV.GAI_API_KEY, true);
    const baseURL = await promptField(rl, '请输入 GAI_BASE_URL', providerChanged ? providerDefaults.baseURL : current.GAI_BASE_URL || providerDefaults.baseURL);
    const model = await promptField(rl, '请输入 GAI_MODEL', providerChanged ? providerDefaults.model : current.GAI_MODEL || providerDefaults.model);
    const formatModel = await promptField(rl, '请输入 GAI_FORMAT_MODEL', providerChanged ? providerDefaults.formatModel : current.GAI_FORMAT_MODEL || providerDefaults.formatModel);
    const disableThinking = await promptField(rl, '请输入 GAI_DISABLE_THINKING', providerChanged ? String(providerDefaults.disableThinking) : current.GAI_DISABLE_THINKING || String(providerDefaults.disableThinking));

    const nextConfig = {
      GAI_PROVIDER: provider,
      GAI_API_KEY: apiKey,
      GAI_BASE_URL: baseURL,
      GAI_MODEL: model,
      GAI_FORMAT_MODEL: formatModel,
      GAI_DISABLE_THINKING: disableThinking
    };

    await writeFile(getProfilePath(activeProfile), buildEnvFileContent({}, nextConfig), 'utf8');
    await syncProfileToEnv(activeProfile);

    process.stdout.write(`已写入 profile: ${activeProfile}\n`);
    process.stdout.write(`GAI_PROVIDER=${provider}\n`);
    process.stdout.write(`GAI_MODEL=${model}\n`);
    process.stdout.write(`GAI_FORMAT_MODEL=${formatModel}\n`);
    process.stdout.write(`GAI_BASE_URL=${baseURL}\n`);
    process.stdout.write('配置完成，可直接执行 gai / gai use / gai doctor。\n');
  } finally {
    rl.close();
  }
}

function printHelp() {
  process.stdout.write([
    'gai',
    '',
    '用法:',
    '  gai                生成 Commit 建议并交互执行 git add / commit / push',
    '  gai install        写入 ~/.zshrc 并校验 gai 命令可用',
    '  gai doctor         检查 Node、Git、profiles、Provider、zsh 安装状态',
    '  gai doctor --token 估算当前改动的 prompt 体积与 token 使用',
    '  gai config         编辑当前激活 profile 配置并同步到 .env/active.env',
    '  gai profiles       查看全部 profile',
    '  gai use <profile>  一键切换当前生效模型 profile',
    '  gai --help         查看帮助'
  ].join('\n'));
  process.stdout.write('\n');
}

function formatTitle(value) {
  return `${value.type}: ${value.subject}`;
}

function MenuItem(props) {
  return h(Text, {color: props.selected ? 'cyan' : 'white'}, `${props.selected ? '>' : ' '} ${props.option}`);
}

function getStepLabel(name) {
  if (name === 'add') return 'git add -A';
  if (name === 'commit') return 'git commit';
  return 'git push';
}

function getStepIcon(status) {
  if (status === 'running') return '...';
  if (status === 'success') return '[ok]';
  return '[ ]';
}

function createInitialSteps() {
  return [
    {name: 'add', status: 'idle'},
    {name: 'commit', status: 'idle'},
    {name: 'push', status: 'idle'}
  ];
}

function App() {
  const {exit} = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [summarySource, setSummarySource] = useState(null);
  const [summaryStrategy, setSummaryStrategy] = useState(null);
  const [steps, setSteps] = useState(createInitialSteps);

  const runGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSteps(createInitialSteps());

    try {
      const repo = await isGitRepo();
      if (!repo) throw new Error('Current directory is not a git repository.');

      const summaryInput = await getChangesForSummary();
      const {nameStatus, patch, source, strategy} = summaryInput;
      if (!nameStatus || !patch) throw new Error('No changes found in staged or working tree.');

      const prompt = buildPrompt(summaryInput);
      const generated = await generateSuggestion(prompt);
      setSuggestion({title: formatTitle(generated), bullets: generated.bullets});
      setSummarySource(source);
      setSummaryStrategy(strategy);
      setMenuIndex(0);
    } catch (cause) {
      setSuggestion(null);
      setSummarySource(null);
      setSummaryStrategy(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runGenerate();
  }, [runGenerate]);

  const confirmAndPush = useCallback(async () => {
    if (!suggestion) return;
    setSubmitting(true);
    setError(null);
    setSteps(createInitialSteps());

    try {
      await applyCommitAndPush({title: suggestion.title, bullets: suggestion.bullets}, (step) => {
        setSteps((current) => current.map((item) => (item.name === step.name ? {...item, status: step.status} : item)));
      });
      exit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [exit, suggestion]);

  const tips = useMemo(() => ['up/down: move', 'enter: select', 'r: regenerate', 'q: cancel'], []);

  useInput((input, key) => {
    if (loading || submitting) return;
    if (input === 'q') {
      exit();
      return;
    }
    if (input === 'r') {
      runGenerate();
      return;
    }
    if (key.upArrow) {
      setMenuIndex((current) => (current - 1 + MENU_OPTIONS.length) % MENU_OPTIONS.length);
      return;
    }
    if (key.downArrow) {
      setMenuIndex((current) => (current + 1) % MENU_OPTIONS.length);
      return;
    }
    if (key.return) {
      const option = MENU_OPTIONS[menuIndex];
      if (option === 'Confirm') {
        confirmAndPush();
        return;
      }
      if (option === 'Regenerate') {
        runGenerate();
        return;
      }
      exit();
    }
  });

  const content = [h(Text, {key: 'title', color: 'cyan'}, 'gai · AI Commit Assistant')];
  if (loading) content.push(h(Text, {key: 'loading', color: 'yellow'}, '正在根据 Git 改动生成提交建议...'));
  if (submitting) content.push(h(Text, {key: 'submitting', color: 'yellow'}, '正在执行 git add / git commit / git push...'));

  if (!loading && suggestion) {
    const suggestionNodes = [
      h(Text, {key: 'proposal-label', color: 'green'}, '建议标题'),
      h(Text, {key: 'proposal-title'}, suggestion.title),
      h(Text, {key: 'source', color: 'gray'}, `来源: ${summarySource === 'staged' ? '暂存区改动' : '工作区改动'}`),
      h(Text, {key: 'strategy', color: 'gray'}, `策略: ${summaryStrategy === 'incremental' ? '增量' : summaryStrategy === 'contextual' ? '增量 + 上下文' : '压缩摘要'}`),
      h(Text, {key: 'provider', color: 'gray'}, `Provider: ${getProviderLabel()}`),
      h(Text, {key: 'summary-label', color: 'green'}, '变更摘要')
    ];

    suggestion.bullets.forEach((line, index) => {
      suggestionNodes.push(h(Text, {key: `bullet-${index}`}, `- ${line}`));
    });

    suggestionNodes.push(h(Box, {key: 'menu', flexDirection: 'column', marginTop: 1}, MENU_OPTIONS.map((option, index) => h(MenuItem, {key: option, option, selected: index === menuIndex}))));
    suggestionNodes.push(h(Text, {key: 'tips', color: 'gray'}, tips.join(' | ')));
    content.push(h(Box, {key: 'suggestion-box', flexDirection: 'column', marginTop: 1}, suggestionNodes));
  }

  if (submitting) {
    content.push(h(Box, {key: 'progress-box', flexDirection: 'column', marginTop: 1}, [
      h(Text, {key: 'progress-title', color: 'yellow'}, '执行进度'),
      ...steps.map((step) => h(Text, {key: `step-${step.name}`, color: step.status === 'success' ? 'green' : step.status === 'running' ? 'yellow' : 'white'}, `${getStepIcon(step.status)} ${getStepLabel(step.name)}`))
    ]));
  }

  if (!loading && error) {
    content.push(h(Box, {key: 'error-box', marginTop: 1}, h(Text, {color: 'red'}, `Error: ${error}`)));
  }

  return h(Box, {flexDirection: 'column', padding: 1}, content);
}

async function main() {
  const command = process.argv[2];

  if (command === 'install') {
    await installToZshrc();
    return;
  }

  if (command === 'doctor') {
    if (process.argv[3] === '--token') {
      render(h(TokenDoctorApp));
      return;
    }
    await printDoctor();
    return;
  }

  if (command === 'config') {
    await runConfig();
    return;
  }

  if (command === 'profiles') {
    await printProfiles();
    return;
  }

  if (command === 'use') {
    await useProfile(process.argv[3]);
    return;
  }

  if (command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  render(h(App));
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
