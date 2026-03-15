import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {buildFallbackBrief, parseGeneratedBrief} from '../dist/fallback-suggestion.js';
import {buildChangeIR} from '../dist/change-analysis/ir-builder.js';
import {BASE_SYSTEM_PROMPT, buildPrompt, buildZhipuPrompt} from '../dist/prompt.js';

test('buildChangeIR produces symbols and risks from TS file changes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gai-ir-'));
  const filePath = path.join(tempDir, 'service.ts');

  await writeFile(
    filePath,
    [
      'export function loadUsers() {',
      "  return ['a'];",
      '}',
      '',
      'export const userCount = 1;'
    ].join('\n'),
    'utf8'
  );

  const ir = await buildChangeIR({
    source: 'mixed-workspace',
    strategy: 'contextual',
    files: [
      {
        status: 'M',
        path: filePath,
        added: 4,
        removed: 1,
        total: 5
      }
    ],
    patches: [
      {
        path: filePath,
        content: [
          `diff --git a/${filePath} b/${filePath}`,
          `--- a/${filePath}`,
          `+++ b/${filePath}`,
          '@@ -1,1 +1,2 @@',
          '-export function loadUsers() {}',
          '+export function loadUsers() { return [\'a\']; }',
          '+export const userCount = 1;'
        ].join('\n')
      }
    ]
  });

  assert.equal(ir.overview.filesChanged, 1);
  assert.equal(ir.changes[0].role, 'script');
  assert.match(ir.changes[0].summary, /updated script file/);
  assert.ok(ir.changes[0].symbols.includes('loadUsers') || ir.changes[0].symbols.includes('userCount'));
  assert.ok(ir.risks.some((item) => /Implementation changed/.test(item)));
});

test('buildFallbackBrief returns independent shapes for each brief type', () => {
  const prompt = [
    '[FILE_SUMMARY]',
    'M\tsrc/git.ts\thigh-context',
    '',
    '[NAME_STATUS]',
    'M\tsrc/git.ts',
    '',
    '[SEMANTIC_HINTS]',
    '核心实现逻辑发生调整',
    '涉及类型定义或接口契约变化',
    '',
    '[IR_CHANGES]',
    'src/git.ts\trole=script\tstatus=M\t+10/-2\tsummary=updated script file around getChangesForSummary',
    '',
    '[IR_RISKS]',
    'Implementation changed without matching test file updates in the current workspace.',
    '',
    '[PATCH]',
    '+export function getChangesForSummary() {}'
  ].join('\n');

  const commitBrief = buildFallbackBrief(prompt, '', 'commit');
  const titleBrief = buildFallbackBrief(prompt, '', 'commit-title');
  const summaryBrief = buildFallbackBrief(prompt, '', 'commit-summary');
  const crBrief = buildFallbackBrief(prompt, '', 'cr-description');

  assert.equal(commitBrief.briefType, 'commit');
  assert.equal(titleBrief.briefType, 'commit-title');
  assert.equal(summaryBrief.briefType, 'commit-summary');
  assert.equal(crBrief.briefType, 'cr-description');
});

test('parseGeneratedBrief supports distinct brief schemas', () => {
  assert.deepEqual(
    parseGeneratedBrief(
      '{"title":"feat: 重构变更分析链路与摘要生成","bullets":["重构变更分析与摘要压缩链路","统一模型调用与输出解析协议"]}',
      'commit'
    ),
    {
      briefType: 'commit',
      title: 'feat: 重构变更分析链路与摘要生成',
      bullets: ['重构变更分析与摘要压缩链路', '统一模型调用与输出解析协议']
    }
  );

  assert.deepEqual(
    parseGeneratedBrief('{"title":"feat: 调整摘要链路"}', 'commit-title'),
    {briefType: 'commit-title', title: 'feat: 调整摘要链路'}
  );

  assert.deepEqual(
    parseGeneratedBrief(
      '{"bullets":["调整 IR 构建","补充回退逻辑","扩展模型输出协议","补充缓存日志","增加测试覆盖"]}',
      'commit-summary'
    ),
    {
      briefType: 'commit-summary',
      bullets: ['调整 IR 构建', '补充回退逻辑', '扩展模型输出协议', '补充缓存日志', '增加测试覆盖']
    }
  );

  assert.deepEqual(
    parseGeneratedBrief(
      '{"changePurpose":"说明摘要链路为什么需要调整。","keyChanges":["新增 IR 优先的提示词输入","扩展输出规格"],"impactScope":["src/git.ts","src/prompt.ts","src/fallback-suggestion.ts","src/providers/openai-compatible.ts","src/briefs.ts"],"reviewerFocus":"重点检查行为一致性。","testingValidation":"建议补充人工验证。"}',
      'cr-description'
    ),
    {
      briefType: 'cr-description',
      changePurpose: '说明摘要链路为什么需要调整。',
      keyChanges: ['新增 IR 优先的提示词输入', '扩展输出规格'],
      impactScope: ['src/git.ts', 'src/prompt.ts', 'src/fallback-suggestion.ts', 'src/providers/openai-compatible.ts', 'src/briefs.ts'],
      reviewerFocus: '重点检查行为一致性。',
      testingValidation: '建议补充人工验证。'
    }
  );
});

test('parseGeneratedBrief supports array-shaped summary payloads', () => {
  assert.deepEqual(
    parseGeneratedBrief(
      '[{"bullets":["统一 token usage 输出协议"]},{"bullets":["在 CLI 中展示本次 token 消耗"]}]',
      'commit-summary'
    ),
    {
      briefType: 'commit-summary',
      bullets: ['统一 token usage 输出协议', '在 CLI 中展示本次 token 消耗']
    }
  );
});

test('parseGeneratedBrief recovers malformed summary payloads before fallback', () => {
  assert.deepEqual(
    parseGeneratedBrief(
      '[{"bullets":["统一 token 使用数据模型"]}, {"bullets":["在 CLI 输出中集成 usage 与 cacheHit 字段"]}, {"bullets":["补齐 TokenUsage 相关单元测试"]]',
      'commit-summary'
    ),
    {
      briefType: 'commit-summary',
      bullets: ['统一 token 使用数据模型', '在 CLI 输出中集成 usage 与 cacheHit 字段', '补齐 TokenUsage 相关单元测试']
    }
  );
});

test('buildZhipuPrompt remains compatible with fallback parsing', () => {
  const summary = {
    source: 'mixed-workspace',
    strategy: 'compressed',
    nameStatus: ['M\tsrc/cli.ts', 'M\tsrc/git.ts', 'M\ttests/commands.test.js'].join('\n'),
    patch: ['+import {writePipelineLog} from "./model-log.js";', '+export function getChangesForSummary() {}'].join('\n'),
    fileSummary: ['M\tsrc/cli.ts\thigh-context', 'M\tsrc/git.ts\thigh-context', 'M\ttests/commands.test.js\tnormal'].join('\n'),
    filesOverview: ['M\tsrc/cli.ts\tscript +20/-5', 'M\tsrc/git.ts\tscript +35/-10', 'M\ttests/commands.test.js\ttest +12/-0'].join('\n'),
    groupSummary: ['src/cli\tcount=1\troles=script\ttotal=25', 'src/git\tcount=1\troles=script\ttotal=45'].join('\n'),
    semanticHints: ['命令入口与 brief 渲染链路发生调整', '变更分析与摘要压缩链路发生重构', '包含测试覆盖或验证逻辑调整'].join('\n'),
    contextSummary: '',
    stats: {
      fileCount: 3,
      ignoredFileCount: 0,
      highContextFileCount: 2,
      patchChars: 128
    },
    ir: {
      overview: {
        source: 'mixed-workspace',
        filesChanged: 3,
        addedLines: 67,
        deletedLines: 15,
        strategy: 'compressed'
      },
      changes: [
        {
          file: 'src/cli.ts',
          role: 'script',
          status: 'M',
          added: 20,
          removed: 5,
          total: 25,
          symbols: ['App', 'runGenerate'],
          dependencyChanges: ['./model-log.js'],
          summary: 'updated script file around App, runGenerate with dependency changes: ./model-log.js'
        },
        {
          file: 'src/git.ts',
          role: 'script',
          status: 'M',
          added: 35,
          removed: 10,
          total: 45,
          symbols: ['getChangesForSummary'],
          dependencyChanges: ['./change-analysis/ir-builder.js'],
          summary: 'updated script file around getChangesForSummary with dependency changes: ./change-analysis/ir-builder.js'
        },
        {
          file: 'tests/commands.test.js',
          role: 'test',
          status: 'M',
          added: 12,
          removed: 0,
          total: 12,
          symbols: [],
          dependencyChanges: [],
          summary: 'updated test file'
        }
      ],
      tests: ['tests/commands.test.js'],
      risks: ['Implementation changed without matching test file updates in the current workspace.']
    }
  };

  const prompt = buildZhipuPrompt(summary, 'cr-description');
  const brief = buildFallbackBrief(prompt, '', 'cr-description');

  assert.equal(brief.briefType, 'cr-description');
  assert.ok(brief.keyChanges.length > 0);
  assert.ok(brief.impactScope.length > 0);
  assert.match(brief.testingValidation, /测试/);
});

test('buildPrompt does not inline BASE_SYSTEM_PROMPT into user prompt', () => {
  const summary = {
    source: 'working-tree',
    strategy: 'incremental',
    nameStatus: 'M\tsrc/git.ts',
    patch: '+export function getChangesForSummary() {}',
    fileSummary: 'M\tsrc/git.ts\thigh-context',
    filesOverview: 'M\tsrc/git.ts\tscript +3/-0',
    groupSummary: 'src/git\tcount=1\troles=script\ttotal=3',
    semanticHints: '变更分析与摘要压缩链路发生重构',
    contextSummary: '',
    stats: {
      fileCount: 1,
      ignoredFileCount: 0,
      highContextFileCount: 1,
      patchChars: 39
    },
    ir: {
      overview: {
        source: 'working-tree',
        filesChanged: 1,
        addedLines: 3,
        deletedLines: 0,
        strategy: 'incremental'
      },
      changes: [
        {
          file: 'src/git.ts',
          role: 'script',
          status: 'M',
          added: 3,
          removed: 0,
          total: 3,
          symbols: ['getChangesForSummary'],
          dependencyChanges: [],
          summary: 'updated script file around getChangesForSummary'
        }
      ],
      tests: [],
      risks: []
    }
  };

  const prompt = buildPrompt(summary, 'commit-summary');
  assert.equal(prompt.includes(BASE_SYSTEM_PROMPT), false);
});

test('buildPrompt expands output profile for large refactors', () => {
  const summary = {
    source: 'working-tree',
    strategy: 'compressed',
    nameStatus: ['M\tsrc/cli.ts', 'M\tsrc/git.ts', 'M\tsrc/prompt.ts', 'M\tsrc/model-log.ts', 'M\ttests/briefs-ir.test.js'].join('\n'),
    patch: ['+export function runGenerate() {}', '+export function buildPrompt() {}', '+export function writePipelineLog() {}'].join('\n'),
    fileSummary: ['M\tsrc/cli.ts\thigh-context', 'M\tsrc/git.ts\thigh-context', 'M\tsrc/prompt.ts\thigh-context', 'M\tsrc/model-log.ts\tnormal', 'M\ttests/briefs-ir.test.js\tnormal'].join('\n'),
    filesOverview: ['M\tsrc/cli.ts\tscript +120/-40', 'M\tsrc/git.ts\tscript +160/-90', 'M\tsrc/prompt.ts\tscript +200/-60', 'M\tsrc/model-log.ts\tscript +90/-20', 'M\ttests/briefs-ir.test.js\ttest +30/-5'].join('\n'),
    groupSummary: ['src/cli\tcount=1\troles=script\ttotal=160', 'src/git\tcount=1\troles=script\ttotal=250', 'src/prompt\tcount=1\troles=script\ttotal=260'].join('\n'),
    semanticHints: ['命令入口与 brief 契约', '变更分析与摘要压缩链路', '模型调用、提示词与输出解析链路', '缓存结构与中间态日志能力', '测试与工程校验'].join('\n'),
    contextSummary: '',
    stats: {
      fileCount: 20,
      ignoredFileCount: 8,
      highContextFileCount: 4,
      patchChars: 4096
    },
    ir: {
      overview: {
        source: 'working-tree',
        filesChanged: 20,
        addedLines: 920,
        deletedLines: 410,
        strategy: 'compressed'
      },
      changes: [
        {
          file: 'src/cli.ts',
          role: 'script',
          status: 'M',
          added: 120,
          removed: 40,
          total: 160,
          symbols: ['runGenerate'],
          dependencyChanges: ['./commands.js'],
          summary: 'updated script file around runGenerate'
        },
        {
          file: 'src/git.ts',
          role: 'script',
          status: 'M',
          added: 160,
          removed: 90,
          total: 250,
          symbols: ['getChangesForSummary'],
          dependencyChanges: ['./change-analysis/ir-builder.js'],
          summary: 'updated script file around getChangesForSummary'
        },
        {
          file: 'src/prompt.ts',
          role: 'script',
          status: 'M',
          added: 200,
          removed: 60,
          total: 260,
          symbols: ['buildPrompt'],
          dependencyChanges: ['./commands.js'],
          summary: 'updated script file around buildPrompt'
        },
        {
          file: 'src/model-log.ts',
          role: 'script',
          status: 'M',
          added: 90,
          removed: 20,
          total: 110,
          symbols: ['writePipelineLog'],
          dependencyChanges: [],
          summary: 'updated script file around writePipelineLog'
        },
        {
          file: 'tests/briefs-ir.test.js',
          role: 'test',
          status: 'M',
          added: 30,
          removed: 5,
          total: 35,
          symbols: [],
          dependencyChanges: [],
          summary: 'updated test file'
        }
      ],
      tests: ['tests/briefs-ir.test.js'],
      risks: ['Large file-level changes may hide behavior regressions across multiple code paths.']
    }
  };

  const prompt = buildPrompt(summary, 'cr-description');
  assert.match(prompt, /\[OUTPUT_PROFILE\]/);
  assert.match(prompt, /\[NARRATIVE_HINT\]/);
  assert.match(prompt, /\[ACTION_CHECKLIST\]/);
  assert.match(prompt, /\[REVIEWER_FOCUS_TEMPLATE\]/);
  assert.match(prompt, /scale=expansive/);
  assert.match(prompt, /summaryMax=6/);
  assert.match(prompt, /keyChangesMax=6/);
  assert.match(prompt, /impactScopeMax=5/);
  assert.match(prompt, /跨层重构|共同服务的工程目标/);
  assert.match(prompt, /统一命令入口与 Brief 契约|重构变更分析与摘要压缩链路/);
});

test('buildFallbackBrief follows expansive output profile for larger changes', () => {
  const prompt = [
    '[OUTPUT_PROFILE]',
    'scale=expansive',
    'summaryMin=4',
    'summaryMax=6',
    'keyChangesMin=4',
    'keyChangesMax=6',
    'impactScopeMin=3',
    'impactScopeMax=5',
    '',
    '[THEME_CHECKLIST]',
    '命令入口与 brief 契约',
    '变更分析与摘要压缩链路',
    '模型调用、提示词与输出解析链路',
    '',
    '[ACTION_CHECKLIST]',
    '统一命令入口与 Brief 契约，收敛 CLI 参数和内部输出协议',
    '重构变更分析与摘要压缩链路，引入自适应策略和结构化分析结果',
    '统一模型调用、提示词构建与输出解析协议，减少 provider 侧分支差异',
    '增强缓存与中间态日志能力，提升可观测性和调试效率',
    '',
    '[REVIEWER_FOCUS_TEMPLATE]',
    '重点检查 BriefType 与命令解析结果在 CLI、渲染和 provider 间是否完整透传；自适应摘要策略与回退逻辑在大改动和小改动场景下是否保持一致；provider 参数结构与输出解析协议是否保持兼容。',
    '',
    '[FILE_SUMMARY]',
    'M\tsrc/cli.ts\thigh-context',
    'M\tsrc/git.ts\thigh-context',
    'M\tsrc/prompt.ts\thigh-context',
    'M\tsrc/model-log.ts\tnormal',
    'M\tsrc/providers/index.ts\tnormal',
    '',
    '[IR_CHANGES]',
    'src/cli.ts\trole=script\tstatus=M\t+120/-40\tsummary=updated script file around runGenerate',
    'src/git.ts\trole=script\tstatus=M\t+160/-90\tsummary=updated script file around getChangesForSummary',
    'src/prompt.ts\trole=script\tstatus=M\t+200/-60\tsummary=updated script file around buildPrompt',
    'src/model-log.ts\trole=script\tstatus=M\t+90/-20\tsummary=updated script file around writePipelineLog',
    '',
    '[IR_RISKS]',
    'Large file-level changes may hide behavior regressions across multiple code paths.',
    '',
    '[PATCH]',
    '+export function runGenerate() {}',
    '+export function buildPrompt() {}',
    '+export function writePipelineLog() {}',
    '+export function getChangesForSummary() {}',
    '+export function buildAdaptiveSummary() {}'
  ].join('\n');

  const summaryBrief = buildFallbackBrief(prompt, '', 'commit-summary');
  const crBrief = buildFallbackBrief(prompt, '', 'cr-description');

  assert.equal(summaryBrief.briefType, 'commit-summary');
  assert.equal(crBrief.briefType, 'cr-description');
  assert.ok(summaryBrief.bullets.length >= 4);
  assert.match(summaryBrief.bullets[0], /统一命令入口与 Brief 契约|重构变更分析与摘要压缩链路/);
  assert.ok(crBrief.keyChanges.length >= 4);
  assert.ok(crBrief.impactScope.length >= 3);
  assert.match(crBrief.changePurpose, /职责分散问题|统一/);
  assert.match(crBrief.reviewerFocus, /BriefType|provider|回退逻辑/);
});

test('buildPrompt prioritizes user-visible interaction changes', () => {
  const summary = {
    source: 'working-tree',
    strategy: 'compressed',
    nameStatus: ['M\tsrc/cli.ts', 'A\tsrc/loading-state.ts', 'A\ttests/loading-state.test.js'].join('\n'),
    patch: ['+export function buildLoadingViewModel() {}', '+export function buildExecutionViewModel() {}'].join('\n'),
    fileSummary: ['M\tsrc/cli.ts\thigh-context', 'A\tsrc/loading-state.ts\thigh-context', 'A\ttests/loading-state.test.js\tnormal'].join('\n'),
    filesOverview: ['M\tsrc/cli.ts\tscript +40/-8', 'A\tsrc/loading-state.ts\tscript +120/-0', 'A\ttests/loading-state.test.js\ttest +28/-0'].join('\n'),
    groupSummary: ['src/cli\tcount=1\troles=script\ttotal=48', 'src/loading-state\tcount=1\troles=script\ttotal=120'].join('\n'),
    semanticHints: ['用户可感知交互与反馈发生调整', '包含测试覆盖或验证逻辑调整'].join('\n'),
    contextSummary: '',
    stats: {
      fileCount: 3,
      ignoredFileCount: 0,
      highContextFileCount: 2,
      patchChars: 96
    },
    ir: {
      overview: {
        source: 'working-tree',
        filesChanged: 3,
        addedLines: 168,
        deletedLines: 8,
        strategy: 'compressed'
      },
      changes: [
        {
          file: 'src/loading-state.ts',
          role: 'script',
          status: 'A',
          added: 120,
          removed: 0,
          total: 120,
          symbols: ['buildLoadingViewModel', 'buildExecutionViewModel'],
          dependencyChanges: [],
          summary: 'added script file around buildLoadingViewModel, buildExecutionViewModel'
        },
        {
          file: 'src/cli.ts',
          role: 'script',
          status: 'M',
          added: 40,
          removed: 8,
          total: 48,
          symbols: ['App'],
          dependencyChanges: ['./loading-state.js'],
          summary: 'updated script file around App with dependency changes: ./loading-state.js'
        },
        {
          file: 'tests/loading-state.test.js',
          role: 'test',
          status: 'A',
          added: 28,
          removed: 0,
          total: 28,
          symbols: [],
          dependencyChanges: [],
          summary: 'added test file'
        }
      ],
      tests: ['tests/loading-state.test.js'],
      risks: []
    }
  };

  const prompt = buildPrompt(summary, 'cr-description');
  assert.match(prompt, /\[THEME_CHECKLIST\]\n用户可感知交互与反馈/);
  assert.doesNotMatch(prompt, /\[THEME_CHECKLIST\][\s\S]*命令入口与 brief 契约/);
  assert.match(prompt, /\[USER_VISIBLE_SURFACES\]/);
  assert.match(prompt, /等待阶段的反馈节奏与进度表达/);
  assert.match(prompt, /等待态、状态变化和执行回执是否准确反映真实行为/);
});

test('buildFallbackBrief uses generic reviewer focus for user-visible interaction changes', () => {
  const prompt = [
    '[THEME_CHECKLIST]',
    '用户可感知交互与反馈',
    '测试与工程校验',
    '',
    '[ACTION_CHECKLIST]',
    '统一用户可感知的交互反馈，收敛等待态、状态展示或执行回执的表达方式',
    '调整状态推进与反馈节奏，让实际行为变化在交互层更容易被理解和验证',
    '',
    '[USER_VISIBLE_SURFACES]',
    '等待阶段的反馈节奏与进度表达',
    '状态变化与执行回执的可见性',
    '关键操作过程中的交互反馈',
    '',
    '[FILE_SUMMARY]',
    'M\tsrc/cli.ts\thigh-context',
    'A\tsrc/loading-state.ts\thigh-context',
    '',
    '[IR_CHANGES]',
    'src/loading-state.ts\trole=script\tstatus=A\t+120/-0\tsummary=added script file around buildLoadingViewModel',
    'src/cli.ts\trole=script\tstatus=M\t+40/-8\tsummary=updated script file around App with dependency changes: ./loading-state.js',
    '',
    '[PATCH]',
    '+export function buildLoadingViewModel() {}',
    '+export function buildExecutionViewModel() {}'
  ].join('\n');

  const crBrief = buildFallbackBrief(prompt, '', 'cr-description');
  assert.equal(crBrief.briefType, 'cr-description');
  assert.match(crBrief.changePurpose, /用户可见层面更清晰、更一致/);
  assert.match(crBrief.reviewerFocus, /等待阶段的反馈节奏与进度表达|状态变化与执行回执的可见性/);
});
