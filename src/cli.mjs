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
  /** @type {['staged'|'working-tree'|null, (value: 'staged'|'working-tree'|null) => void]} */
  const [summarySource, setSummarySource] = useState(null);

  /**
   * @description 生成提交建议。
   * @return {Promise<void>} 生成流程。
   */
  const runGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);

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
    setError(null);
    try {
      await applyCommitAndPush({
        title: suggestion.title,
        bullets: suggestion.bullets
      });
      exit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  }, [exit, suggestion]);

  /** @type {string[]} */
  const tips = useMemo(() => ['up/down: move', 'enter: select', 'r: regenerate', 'q: cancel'], []);

  useInput((input, key) => {
    if (loading || submitting) {
      return;
    }

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

  /** @type {React.ReactElement[]} */
  const content = [h(Text, {key: 'title', color: 'cyan'}, 'gai · AI Commit Assistant')];

  if (loading) {
    content.push(
      h(
        Text,
        {key: 'loading', color: 'yellow'},
        'Generating commit suggestion from git changes...'
      )
    );
  }

  if (submitting) {
    content.push(
      h(Text, {key: 'submitting', color: 'yellow'}, 'Running git add + git commit + git push...')
    );
  }

  if (!loading && suggestion) {
    /** @type {React.ReactElement[]} */
    const suggestionNodes = [
      h(Text, {key: 'proposal-label', color: 'green'}, 'Proposed title'),
      h(Text, {key: 'proposal-title'}, suggestion.title),
      h(
        Text,
        {key: 'source', color: 'gray'},
        `Source: ${summarySource === 'staged' ? 'staged changes' : 'working tree changes'}`
      ),
      h(Text, {key: 'summary-label', color: 'green'}, 'Summary')
    ];

    suggestion.bullets.forEach((line, index) => {
      suggestionNodes.push(h(Text, {key: `bullet-${index}`}, `- ${line}`));
    });

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

    suggestionNodes.push(h(Text, {key: 'tips', color: 'gray'}, tips.join(' | ')));
    content.push(h(Box, {key: 'suggestion-box', flexDirection: 'column', marginTop: 1}, suggestionNodes));
  }

  if (!loading && error) {
    content.push(h(Box, {key: 'error-box', marginTop: 1}, h(Text, {color: 'red'}, `Error: ${error}`)));
  }

  return h(Box, {flexDirection: 'column', padding: 1}, content);
}

render(h(App));
