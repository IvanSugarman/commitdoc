import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExecutionViewModel, buildLoadingViewModel, getPhaseLabel} from '../dist/app/loading-state.js';

test('getPhaseLabel returns localized labels', () => {
  assert.equal(getPhaseLabel('git'), 'Git 提取');
  assert.equal(getPhaseLabel('prompt'), 'Prompt 构建');
  assert.equal(getPhaseLabel('model'), '模型生成');
});

test('buildLoadingViewModel returns staged loading panel content', () => {
  const gitView = buildLoadingViewModel('git', 2, 540, 'ark / ark-code-latest');
  const promptView = buildLoadingViewModel('prompt', 2, 540, 'ark / ark-code-latest');
  const modelView = buildLoadingViewModel('model', 5, 12400, 'ark / ark-code-latest');

  assert.match(gitView.headline, /\[SCAN\] 扫描工作区地形/);
  assert.match(gitView.stageLine, /当前阶段: Git 提取/);
  assert.match(gitView.meterLine, /\[[=>.]+\] \d+%/);
  assert.match(gitView.metaLine, /下一步将构建 IR/);
  assert.match(gitView.meterLine, /12%/);

  assert.match(promptView.stageLine, /当前阶段: Prompt 构建/);
  assert.match(promptView.meterLine, /20%/);

  assert.match(modelView.headline, /\[SYNC\] 与模型协商最终输出/);
  assert.match(modelView.stageLine, /当前阶段: 模型生成 · 已耗时 12\.4s/);
  assert.match(modelView.meterLine, /54%/);
  assert.match(modelView.metaLine, /ark \/ ark-code-latest/);
});

test('buildExecutionViewModel returns commit execution panel content', () => {
  const executionView = buildExecutionViewModel([
    {name: 'add', status: 'success'},
    {name: 'commit', status: 'running'},
    {name: 'push', status: 'idle'}
  ], 1800);

  assert.match(executionView.headline, /\[SHIP\] 写入 Git 提交流水线/);
  assert.match(executionView.stageLine, /当前阶段: 提交执行 · 已耗时 1\.8s/);
  assert.match(executionView.meterLine, /\[[=>.]+\] \d+%/);
  assert.match(executionView.metaLine, /git commit/);
});
