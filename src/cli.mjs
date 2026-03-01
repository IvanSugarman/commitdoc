#!/usr/bin/env node
import 'dotenv/config';
import {execFile} from 'node:child_process';
import {access, appendFile, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import readline from 'node:readline/promises';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {applyCommitAndPush, clipPatch, getChangesForSummary, isGitRepo} from './git.mjs';
import {generateSuggestion} from './openai.mjs';
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
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

/** @type {string} */
const ENV_EXAMPLE_PATH = path.join(PROJECT_ROOT, '.env.example');

/** @type {string} */
const ZSHRC_PATH = path.join(os.homedir(), '.zshrc');

/** @type {string} */
const INSTALL_BLOCK_START = '# GAI_CLI:START';

/** @type {string} */
const INSTALL_BLOCK_END = '# GAI_CLI:END';

/** @type {{ GAI_API_KEY: string; GAI_BASE_URL: string; GAI_MODEL: string }} */
const DEFAULT_ENV = {
  GAI_API_KEY: '',
  GAI_BASE_URL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  GAI_MODEL: 'glm-4.7'
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
 * @description 读取当前 env 配置。
 * @return {Promise<Record<string, string>>} 当前 env 键值对。
 */
async function readEnvConfig() {
  try {
    const content = await readFile(ENV_PATH, 'utf8');
    return parseEnvContent(content);
  } catch {
    return {};
  }
}

/**
 * @description 构建 env 文件内容，同时保留非 gai 配置。
 * @param {Record<string, string>} current 当前 env 配置。
 * @param {{ GAI_API_KEY: string; GAI_BASE_URL: string; GAI_MODEL: string }} next 下一版配置。
 * @return {string} 新的 env 文件内容。
 */
function buildEnvFileContent(current, next) {
  /** @type {string[]} */
  const preserved = [];

  Object.entries(current).forEach(([key, value]) => {
    if (!['GAI_API_KEY', 'GAI_BASE_URL', 'GAI_MODEL'].includes(key)) {
      preserved.push(`${key}=${value}`);
    }
  });

  return [
    `GAI_API_KEY=${next.GAI_API_KEY}`,
    `GAI_BASE_URL=${next.GAI_BASE_URL}`,
    `GAI_MODEL=${next.GAI_MODEL}`,
    ...preserved
  ].join('\n') + '\n';
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
  /** @type {DoctorItem[]} */
  const items = [];

  /** @type {number} */
  const majorVersion = Number(process.versions.node.split('.')[0] || '0');
  items.push({
    name: 'Node.js',
    status: majorVersion >= 18 ? 'pass' : 'fail',
    detail: `当前版本 ${process.version}${majorVersion >= 18 ? '' : '，要求 >= 18'}`
  });

  try {
    const gitVersion = await runCommand('git', ['--version']);
    items.push({
      name: 'Git',
      status: 'pass',
      detail: gitVersion
    });
  } catch {
    items.push({
      name: 'Git',
      status: 'fail',
      detail: '未检测到 git 命令'
    });
  }

  const repo = await isGitRepo();
  items.push({
    name: 'Git Repository',
    status: repo ? 'pass' : 'warn',
    detail: repo ? '当前目录位于 Git 仓库内' : '当前目录不在 Git 仓库内，gai 主流程不可用'
  });

  try {
    await access(ENV_PATH);
    items.push({
      name: '.env',
      status: 'pass',
      detail: `${ENV_PATH} 已存在`
    });
  } catch {
    items.push({
      name: '.env',
      status: 'warn',
      detail: `${ENV_PATH} 不存在，可执行 gai config 自动生成`
    });
  }

  const envConfig = await readEnvConfig();
  const apiKey = envConfig.GAI_API_KEY || process.env.GAI_API_KEY || '';
  items.push({
    name: 'GAI_API_KEY',
    status: apiKey ? 'pass' : 'fail',
    detail: apiKey ? '已配置' : '缺少 GAI_API_KEY，可执行 gai config 设置'
  });

  items.push({
    name: 'Model Config',
    status: envConfig.GAI_MODEL || process.env.GAI_MODEL ? 'pass' : 'warn',
    detail: `model=${envConfig.GAI_MODEL || process.env.GAI_MODEL || DEFAULT_ENV.GAI_MODEL}, baseURL=${envConfig.GAI_BASE_URL || process.env.GAI_BASE_URL || DEFAULT_ENV.GAI_BASE_URL}`
  });

  try {
    const current = await readFile(ZSHRC_PATH, 'utf8');
    items.push({
      name: 'Shell Install',
      status: current.includes(INSTALL_BLOCK_START) ? 'pass' : 'warn',
      detail: current.includes(INSTALL_BLOCK_START) ? '已写入 ~/.zshrc' : '尚未安装到 ~/.zshrc，可执行 gai install'
    });
  } catch {
    items.push({
      name: 'Shell Install',
      status: 'warn',
      detail: '未找到 ~/.zshrc，可执行 gai install 自动创建'
    });
  }

  try {
    const typeOutput = await runCommand('zsh', ['-ic', 'type gai']);
    items.push({
      name: 'Shell Resolve',
      status: typeOutput.includes('gai is') ? 'pass' : 'warn',
      detail: typeOutput || '当前 zsh 会话未识别 gai'
    });
  } catch {
    items.push({
      name: 'Shell Resolve',
      status: 'warn',
      detail: '新的 zsh 子进程未识别 gai，可能需要执行 gai install 或 source ~/.zshrc'
    });
  }

  return items;
}

/**
 * @description 输出 doctor 检查结果。
 * @return {Promise<void>} 输出完成。
 */
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

/**
 * @description 交互式写入 env 配置。
 * @return {Promise<void>} 配置流程完成。
 */
async function runConfig() {
  const current = await readEnvConfig();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const apiKey = await promptField(rl, '请输入 GAI_API_KEY', current.GAI_API_KEY || DEFAULT_ENV.GAI_API_KEY, true);
    const baseURL = await promptField(rl, '请输入 GAI_BASE_URL', current.GAI_BASE_URL || DEFAULT_ENV.GAI_BASE_URL);
    const model = await promptField(rl, '请输入 GAI_MODEL', current.GAI_MODEL || DEFAULT_ENV.GAI_MODEL);

    await writeFile(
      ENV_PATH,
      buildEnvFileContent(current, {
        GAI_API_KEY: apiKey,
        GAI_BASE_URL: baseURL,
        GAI_MODEL: model
      }),
      'utf8'
    );

    process.stdout.write(`已写入 ${ENV_PATH}\n`);
    process.stdout.write(`GAI_MODEL=${model}\n`);
    process.stdout.write(`GAI_BASE_URL=${baseURL}\n`);
    process.stdout.write('配置完成，可直接执行 gai 或 gai doctor。\n');
  } finally {
    rl.close();
  }
}

/**
 * @description 输出帮助信息。
 * @return {void} 无返回值。
 */
function printHelp() {
  process.stdout.write([
    'gai',
    '',
    '用法:',
    '  gai            生成 Commit 建议并交互执行 git add / commit / push',
    '  gai install    写入 ~/.zshrc 并校验 gai 命令可用',
    '  gai doctor     检查 Node、Git、.env、API Key、zsh 安装状态',
    '  gai config     交互式写入 .env 配置',
    '  gai --help     查看帮助'
  ].join('\n'));
  process.stdout.write('\n');
}

/**
 * @description 将模型结构化输出转换为最终提交标题。
 * @param {{type: 'feat'|'fix'|'chore'; subject: string}} value 模型输出。
 * @return {string} 标准化标题。
 */
function formatTitle(value) {
  return `${value.type}: ${value.subject}`;
}

/**
 * @description 渲染菜单项。
 * @param {{option: string; selected: boolean}} props 菜单项参数。
 * @return {React.ReactElement} 菜单项元素。
 */
function MenuItem(props) {
  return h(
    Text,
    {color: props.selected ? 'cyan' : 'white'},
    `${props.selected ? '>' : ' '} ${props.option}`
  );
}

/**
 * @description 获取步骤显示文案。
 * @param {'add'|'commit'|'push'} name 步骤名称。
 * @return {string} 展示文案。
 */
function getStepLabel(name) {
  if (name === 'add') {
    return 'git add -A';
  }
  if (name === 'commit') {
    return 'git commit';
  }
  return 'git push';
}

/**
 * @description 获取步骤状态符号。
 * @param {'idle'|'running'|'success'} status 步骤状态。
 * @return {string} 状态符号。
 */
function getStepIcon(status) {
  if (status === 'running') {
    return '...';
  }
  if (status === 'success') {
    return '[ok]';
  }
  return '[ ]';
}

/**
 * @description 构建默认步骤状态。
 * @return {StepState[]} 步骤状态数组。
 */
function createInitialSteps() {
  return [
    {name: 'add', status: 'idle'},
    {name: 'commit', status: 'idle'},
    {name: 'push', status: 'idle'}
  ];
}

/**
 * @description 交互主界面组件。
 * @return {React.ReactElement} Ink 组件。
 */
function App() {
  const {exit} = useApp();
  /** @type {[boolean, (value: boolean) => void]} */
  const [loading, setLoading] = useState(true);
  /** @type {[string | null, (value: string | null) => void]} */
  const [error, setError] = useState(null);
  /** @type {[SuggestionViewModel | null, (value: SuggestionViewModel | null) => void]} */
  const [suggestion, setSuggestion] = useState(null);
  /** @type {[number, (value: number) => void]} */
  const [menuIndex, setMenuIndex] = useState(0);
  /** @type {[boolean, (value: boolean) => void]} */
  const [submitting, setSubmitting] = useState(false);
  /** @type {[boolean, (value: boolean) => void]} */
  const [completed, setCompleted] = useState(false);
  /** @type {['staged'|'working-tree'|null, (value: 'staged'|'working-tree'|null) => void]} */
  const [summarySource, setSummarySource] = useState(null);
  /** @type {[StepState[], (value: StepState[] | ((value: StepState[]) => StepState[])) => void]} */
  const [steps, setSteps] = useState(createInitialSteps);

  const runGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCompleted(false);
    setSteps(createInitialSteps());

    try {
      const repo = await isGitRepo();
      if (!repo) {
        throw new Error('Current directory is not a git repository.');
      }

      const {nameStatus, patch, source} = await getChangesForSummary();
      if (!nameStatus || !patch) {
        throw new Error('No changes found in staged or working tree.');
      }

      const prompt = buildPrompt({
        nameStatus,
        patch: clipPatch(patch)
      });

      const generated = await generateSuggestion(prompt);
      setSuggestion({
        title: formatTitle(generated),
        bullets: generated.bullets
      });
      setSummarySource(source);
      setMenuIndex(0);
    } catch (cause) {
      setSuggestion(null);
      setSummarySource(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runGenerate();
  }, [runGenerate]);

  const confirmAndPush = useCallback(async () => {
    if (!suggestion) {
      return;
    }

    setSubmitting(true);
    setCompleted(false);
    setError(null);
    setSteps(createInitialSteps());

    try {
      await applyCommitAndPush(
        {
          title: suggestion.title,
          bullets: suggestion.bullets
        },
        (step) => {
          setSteps((current) =>
            current.map((item) => (item.name === step.name ? {...item, status: step.status} : item))
          );
        }
      );
      setCompleted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [suggestion]);

  const tips = useMemo(() => {
    if (completed) {
      return ['enter: exit', 'q: exit'];
    }

    return ['up/down: move', 'enter: select', 'r: regenerate', 'q: cancel'];
  }, [completed]);

  useInput((input, key) => {
    if (loading || submitting) {
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (completed && key.return) {
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

  if (loading) {
    content.push(h(Text, {key: 'loading', color: 'yellow'}, '正在根据 Git 改动生成提交建议...'));
  }

  if (submitting) {
    content.push(h(Text, {key: 'submitting', color: 'yellow'}, '正在执行 git add / git commit / git push...'));
  }

  if (!loading && suggestion) {
    const suggestionNodes = [
      h(Text, {key: 'proposal-label', color: 'green'}, '建议标题'),
      h(Text, {key: 'proposal-title'}, suggestion.title),
      h(
        Text,
        {key: 'source', color: 'gray'},
        `来源: ${summarySource === 'staged' ? '暂存区改动' : '工作区改动'}`
      ),
      h(Text, {key: 'summary-label', color: 'green'}, '变更摘要')
    ];

    suggestion.bullets.forEach((line, index) => {
      suggestionNodes.push(h(Text, {key: `bullet-${index}`}, `- ${line}`));
    });

    if (!completed) {
      suggestionNodes.push(
        h(
          Box,
          {key: 'menu', flexDirection: 'column', marginTop: 1},
          MENU_OPTIONS.map((option, index) =>
            h(MenuItem, {
              key: option,
              option,
              selected: index === menuIndex
            })
          )
        )
      );
    }

    suggestionNodes.push(h(Text, {key: 'tips', color: 'gray'}, tips.join(' | ')));
    content.push(h(Box, {key: 'suggestion-box', flexDirection: 'column', marginTop: 1}, suggestionNodes));
  }

  if (submitting || completed) {
    content.push(
      h(
        Box,
        {key: 'progress-box', flexDirection: 'column', marginTop: 1},
        [
          h(Text, {key: 'progress-title', color: completed ? 'green' : 'yellow'}, completed ? '执行结果' : '执行进度'),
          ...steps.map((step) =>
            h(
              Text,
              {
                key: `step-${step.name}`,
                color: step.status === 'success' ? 'green' : step.status === 'running' ? 'yellow' : 'white'
              },
              `${getStepIcon(step.status)} ${getStepLabel(step.name)}`
            )
          ),
          completed
            ? h(Text, {key: 'completed-tip', color: 'green'}, '提交与推送已完成，按 enter 或 q 退出。')
            : null
        ].filter(Boolean)
      )
    );
  }

  if (!loading && error) {
    content.push(h(Box, {key: 'error-box', marginTop: 1}, h(Text, {color: 'red'}, `Error: ${error}`)));
  }

  return h(Box, {flexDirection: 'column', padding: 1}, content);
}

/**
 * @description 程序主入口。
 * @return {Promise<void>} 执行完成。
 */
async function main() {
  const command = process.argv[2];

  if (command === 'install') {
    await installToZshrc();
    return;
  }

  if (command === 'doctor') {
    await printDoctor();
    return;
  }

  if (command === 'config') {
    await runConfig();
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
