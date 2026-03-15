import {allowsGitExecution, getBriefOption, type BriefType} from './commands.js';

/** 变更来源 */
type ChangeSource = 'staged' | 'working-tree' | 'mixed-workspace';

/** 摘要策略 */
type SummaryStrategy = 'incremental' | 'contextual' | 'compressed';

/** 提交流程输出 */
export interface CommitFlowBrief {
  /** brief 类型 */
  briefType: 'commit';
  /** 完整提交标题 */
  title: string;
  /** 提交摘要 */
  bullets: string[];
}

/** 提交标题输出 */
export interface CommitTitleBrief {
  /** brief 类型 */
  briefType: 'commit-title';
  /** 完整提交标题 */
  title: string;
}

/** 提交摘要输出 */
export interface CommitSummaryBrief {
  /** brief 类型 */
  briefType: 'commit-summary';
  /** 提交摘要 */
  bullets: string[];
}

/** CR 描述输出 */
export interface CrDescriptionBrief {
  /** brief 类型 */
  briefType: 'cr-description';
  /** 变更目的 */
  changePurpose: string;
  /** 关键改动 */
  keyChanges: string[];
  /** 影响范围 */
  impactScope: string[];
  /** 评审关注点 */
  reviewerFocus: string;
  /** 测试验证 */
  testingValidation: string;
}

/** 统一 brief 输出 */
export type GeneratedBrief = CommitFlowBrief | CommitTitleBrief | CommitSummaryBrief | CrDescriptionBrief;

/** brief 渲染输入 */
export interface BriefRenderInput {
  /** brief 类型 */
  briefType: BriefType;
  /** brief 输出 */
  brief: GeneratedBrief;
  /** 变更来源 */
  source: ChangeSource;
  /** 摘要策略 */
  strategy: SummaryStrategy;
  /** 文件概览 */
  filesOverview: string;
  /** 文件状态文本 */
  nameStatus: string;
}

/** Git 提交载荷 */
export interface CommitPayload {
  /** 提交标题 */
  title: string;
  /** 提交摘要 */
  bullets: string[];
}

/** brief 渲染结果 */
export interface RenderedBrief {
  /** brief 类型 */
  briefType: BriefType;
  /** 标题 */
  title: string;
  /** 展示内容 */
  lines: string[];
  /** 是否允许继续执行 Git 写操作 */
  allowsGitExecution: boolean;
  /** Git 提交载荷 */
  commitPayload?: CommitPayload;
}

/**
 * @description 构建 brief 渲染结果。
 * @param {BriefRenderInput} input 渲染输入。
 * @return {RenderedBrief} 渲染结果。
 */
export function renderBrief(input: BriefRenderInput): RenderedBrief {
  const option = getBriefOption(input.briefType);

  if (input.brief.briefType === 'commit') {
    return {
      briefType: input.briefType,
      title: option.label,
      lines: [input.brief.title, ...input.brief.bullets.map((item) => `- ${item}`)],
      allowsGitExecution: allowsGitExecution(input.briefType),
      commitPayload: {
        title: input.brief.title,
        bullets: input.brief.bullets
      }
    };
  }

  if (input.brief.briefType === 'commit-title') {
    return {
      briefType: input.briefType,
      title: option.label,
      lines: [input.brief.title],
      allowsGitExecution: allowsGitExecution(input.briefType)
    };
  }

  if (input.brief.briefType === 'commit-summary') {
    return {
      briefType: input.briefType,
      title: option.label,
      lines: input.brief.bullets.map((item) => `- ${item}`),
      allowsGitExecution: allowsGitExecution(input.briefType)
    };
  }

  return {
    briefType: input.briefType,
    title: option.label,
    lines: buildCrDescriptionLines(input.brief),
    allowsGitExecution: allowsGitExecution(input.briefType)
  };
}

/**
 * @description 构建 CR Description 行列表。
 * @param {CrDescriptionBrief} brief CR 描述输出。
 * @return {string[]} 行列表。
 */
function buildCrDescriptionLines(brief: CrDescriptionBrief): string[] {
  return [
    '## Change Purpose',
    brief.changePurpose,
    '',
    '## Key Changes',
    ...brief.keyChanges.map((item) => `- ${item}`),
    '',
    '## Impact Scope',
    ...brief.impactScope.map((item) => `- ${item}`),
    '',
    '## Reviewer Focus',
    brief.reviewerFocus,
    '',
    '## Testing & Validation',
    brief.testingValidation
  ];
}

/**
 * @description 读取渲染结果中的 Git 提交载荷。
 * @param {RenderedBrief | null} renderedBrief 渲染结果。
 * @return {CommitPayload | null} Git 提交载荷。
 */
export function getCommitPayload(renderedBrief: RenderedBrief | null): CommitPayload | null {
  if (!renderedBrief?.commitPayload) {
    return null;
  }

  return renderedBrief.commitPayload;
}

/**
 * @description 判断 brief 是否为提交类型。
 * @param {GeneratedBrief} brief brief 输出。
 * @return {brief is CommitFlowBrief} 是否为提交流程输出。
 */
export function isCommitFlowBrief(brief: GeneratedBrief): brief is CommitFlowBrief {
  return brief.briefType === 'commit';
}

/**
 * @description 为 CR 描述兜底补全空数组。
 * @param {CrDescriptionBrief} brief CR 描述。
 * @param {string} filesOverview 文件概览。
 * @param {string} nameStatus 文件状态文本。
 * @param {SummaryStrategy} strategy 摘要策略。
 * @return {CrDescriptionBrief} 规整后的 CR 描述。
 */
export function normalizeCrDescriptionBrief(
  brief: CrDescriptionBrief,
  filesOverview: string,
  nameStatus: string,
  strategy: SummaryStrategy
): CrDescriptionBrief {
  return {
    ...brief,
    keyChanges: brief.keyChanges.length > 0 ? brief.keyChanges : ['请基于生成的 IR 和补丁证据总结本次工作区改动的主线。'],
    impactScope: brief.impactScope.length > 0 ? brief.impactScope : pickImpactScope(filesOverview || nameStatus),
    reviewerFocus: brief.reviewerFocus || buildReviewerFocus(strategy),
    testingValidation: brief.testingValidation || buildTestingValidation(nameStatus)
  };
}

/**
 * @description 提取影响范围。
 * @param {string} filesOverview 文件概览文本。
 * @return {string[]} 影响范围列表。
 */
function pickImpactScope(filesOverview: string): string[] {
  return filesOverview
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => {
      const parts = line.split('\t');
      return parts[1] || parts[0] || line;
    });
}

/**
 * @description 构建评审关注点。
 * @param {SummaryStrategy} strategy 摘要策略。
 * @return {string} 评审关注点文本。
 */
function buildReviewerFocus(strategy: SummaryStrategy): string {
  if (strategy === 'compressed') {
    return '请重点关注大范围压缩摘要对应的改动区域，尤其是跨文件行为一致性。';
  }

  if (strategy === 'contextual') {
    return '请重点关注关键模块的行为一致性、接口契约变化以及潜在副作用。';
  }

  return '请重点确认这次局部改动的核心意图是否与预期行为一致。';
}

/**
 * @description 构建测试说明。
 * @param {string} nameStatus 文件状态文本。
 * @return {string} 测试说明。
 */
function buildTestingValidation(nameStatus: string): string {
  const hasTests = /(test|spec)\./i.test(nameStatus);
  return hasTests
    ? '当前工作区包含测试文件改动，请确认更新后的测试仍覆盖目标行为。'
    : '当前工作区未检测到明确的测试文件改动，建议补充人工验证。';
}
