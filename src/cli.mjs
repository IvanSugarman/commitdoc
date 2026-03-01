#!/usr/bin/env node
import 'dotenv/config';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {applyCommitAndPush, clipPatch, getChangesForSummary, isGitRepo} from './git.mjs';
import {generateSuggestion} from './openai.mjs';
import {buildPrompt} from './prompt.mjs';

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

/** @type {readonly string[]} */
const MENU_OPTIONS = ['Confirm', 'Regenerate', 'Cancel'];

/** @type {typeof React.createElement} */
const h = React.createElement;

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

  /**
   * @description 生成提交建议。
   * @return {Promise<void>} 生成流程。
   */
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

  /**
   * @description 执行确认动作并提交到远端。
   * @return {Promise<void>} 执行结果。
   */
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

  /** @type {string[]} */
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

  /** @type {React.ReactElement[]} */
  const content = [h(Text, {key: 'title', color: 'cyan'}, 'gai · AI Commit Assistant')];

  if (loading) {
    content.push(h(Text, {key: 'loading', color: 'yellow'}, '正在根据 Git 改动生成提交建议...'));
  }

  if (submitting) {
    content.push(h(Text, {key: 'submitting', color: 'yellow'}, '正在执行 git add / git commit / git push...'));
  }

  if (!loading && suggestion) {
    /** @type {React.ReactElement[]} */
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

render(h(App));
