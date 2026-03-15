/** 加载阶段名称 */
export type PhaseName = 'git' | 'prompt' | 'model';

/** 执行步骤状态 */
export type ExecutionStepStatus = 'idle' | 'running' | 'success';

/** 执行步骤快照 */
export interface ExecutionStepSnapshot {
  /** 步骤名称 */
  name: string;
  /** 步骤状态 */
  status: ExecutionStepStatus;
}

/** 面板视图模型 */
export interface LoadingViewModel {
  /** 标题文案 */
  headline: string;
  /** 标题颜色 */
  headlineColor: 'blue' | 'green';
  /** 阶段说明 */
  stageLine: string;
  /** 进度条文案 */
  meterLine: string;
  /** 元信息文案 */
  metaLine: string;
}

/** 阶段配置 */
interface PhaseConfig {
  /** 阶段标签 */
  badge: string;
  /** 阶段标题 */
  title: string;
  /** 阶段颜色 */
  color: 'blue' | 'green';
  /** 进度起点 */
  minProgress: number;
  /** 进度终点 */
  maxProgress: number;
  /** 单次推进步长对应的耗时 */
  stepMs: number;
}

/** 阶段映射配置 */
const PHASE_CONFIG: Record<PhaseName, PhaseConfig> = {
  git: {
    badge: 'SCAN',
    title: '扫描工作区地形',
    color: 'green',
    minProgress: 8,
    maxProgress: 14,
    stepMs: 240
  },
  prompt: {
    badge: 'PACK',
    title: '压缩语义上下文',
    color: 'blue',
    minProgress: 18,
    maxProgress: 28,
    stepMs: 360
  },
  model: {
    badge: 'SYNC',
    title: '与模型协商最终输出',
    color: 'green',
    minProgress: 32,
    maxProgress: 94,
    stepMs: 1100
  }
};

/**
 * @description 获取阶段中文名称。
 * @param {PhaseName | null} phase 当前阶段。
 * @return {string} 阶段文案。
 */
export function getPhaseLabel(phase: PhaseName | null): string {
  if (phase === 'git') {
    return 'Git 提取';
  }

  if (phase === 'prompt') {
    return 'Prompt 构建';
  }

  if (phase === 'model') {
    return '模型生成';
  }

  return '准备中';
}

/**
 * @description 构建生成阶段加载面板。
 * @param {PhaseName | null} phase 当前阶段。
 * @param {number} frameIndex 动画帧索引。
 * @param {number} elapsedMs 已耗时毫秒数。
 * @param {string} providerLabel Provider 展示名称。
 * @return {LoadingViewModel} 加载态展示模型。
 */
export function buildLoadingViewModel(
  phase: PhaseName | null,
  frameIndex: number,
  elapsedMs: number,
  providerLabel: string,
): LoadingViewModel {
  if (!phase) {
    const progress = Math.min(12, 4 + Math.floor(elapsedMs / 180) + (frameIndex % 2));
    return {
      headline: '[BOOT] 收拢工作流上下文',
      headlineColor: 'blue',
      stageLine: `当前阶段: ${getPhaseLabel(null)} · 已耗时 ${formatElapsed(elapsedMs)}`,
      meterLine: `${buildMeterBar(progress)} ${progress}%`,
      metaLine: '准备初始化命令入口、Provider 配置与摘要生成管线'
    };
  }

  const config = PHASE_CONFIG[phase];
  const progress = getProgressValue(config, elapsedMs);
  const metaLine = phase === 'model'
    ? `当前引擎: ${providerLabel}`
    : phase === 'prompt'
      ? '下一步将进入模型生成与结构化结果解析'
      : '下一步将构建 IR、模块簇与主题清单';

  return {
    headline: `[${config.badge}] ${config.title}`,
    headlineColor: config.color,
    stageLine: `当前阶段: ${getPhaseLabel(phase)} · 已耗时 ${formatElapsed(elapsedMs)}`,
    meterLine: `${buildMeterBar(progress)} ${progress}%`,
    metaLine
  };
}

/**
 * @description 构建提交流程面板。
 * @param {ExecutionStepSnapshot[]} steps 执行步骤。
 * @param {number} elapsedMs 已耗时毫秒数。
 * @return {LoadingViewModel} 提交阶段展示模型。
 */
export function buildExecutionViewModel(
  steps: ExecutionStepSnapshot[],
  elapsedMs: number,
): LoadingViewModel {
  const successCount = steps.filter((step) => step.status === 'success').length;
  const runningStep = steps.find((step) => step.status === 'running');
  const progress = getExecutionProgress(steps, elapsedMs);

  return {
    headline: '[SHIP] 写入 Git 提交流水线',
    headlineColor: 'blue',
    stageLine: `当前阶段: 提交执行 · 已耗时 ${formatElapsed(elapsedMs)}`,
    meterLine: `${buildMeterBar(progress)} ${progress}%`,
    metaLine: runningStep
      ? `当前操作: ${getExecutionStepLabel(runningStep.name)}`
      : successCount === steps.length
        ? '提交链路执行完成，正在收尾退出'
        : '准备执行 git add -A / git commit / git push'
  };
}

/**
 * @description 计算阶段伪进度，保持单调递增。
 * @param {PhaseConfig} config 阶段配置。
 * @param {number} elapsedMs 已耗时毫秒数。
 * @return {number} 当前进度。
 */
function getProgressValue(config: PhaseConfig, elapsedMs: number): number {
  const span = config.maxProgress - config.minProgress;
  const elapsedBoost = Math.min(span, Math.floor(elapsedMs / config.stepMs) * 2);
  return Math.min(config.maxProgress, config.minProgress + elapsedBoost);
}

/**
 * @description 计算执行阶段进度。
 * @param {ExecutionStepSnapshot[]} steps 执行步骤。
 * @param {number} elapsedMs 已耗时毫秒数。
 * @return {number} 当前进度。
 */
function getExecutionProgress(
  steps: ExecutionStepSnapshot[],
  elapsedMs: number,
): number {
  const successCount = steps.filter((step) => step.status === 'success').length;
  const runningIndex = steps.findIndex((step) => step.status === 'running');

  if (successCount === steps.length) {
    return 100;
  }

  if (runningIndex === -1) {
    return 8;
  }

  const baseProgress = runningIndex * 30 + 12;
  const span = 16;
  const elapsedBoost = Math.min(span, Math.floor(elapsedMs / 600) * 2);
  return Math.min(96, baseProgress + elapsedBoost);
}

/**
 * @description 构建 ASCII 进度条。
 * @param {number} progress 当前进度。
 * @return {string} 进度条文案。
 */
function buildMeterBar(progress: number): string {
  const width = 24;
  const filled = Math.max(0, Math.min(width, Math.floor((progress / 100) * width)));
  /** 进度条字符数组 */
  const bar: string[] = Array.from({length: width}, (_, index) => (index < filled ? '=' : '.'));
  const cursorIndex = Math.min(width - 1, Math.max(0, filled === 0 ? 0 : filled - 1));
  bar[cursorIndex] = '>';
  return `[${bar.join('')}]`;
}

/**
 * @description 获取执行步骤标签。
 * @param {string} name 步骤名称。
 * @return {string} 步骤文案。
 */
function getExecutionStepLabel(name: string): string {
  if (name === 'add') {
    return 'git add -A';
  }

  if (name === 'commit') {
    return 'git commit';
  }

  if (name === 'push') {
    return 'git push';
  }

  return name;
}

/**
 * @description 将毫秒格式化为秒级展示。
 * @param {number} elapsedMs 已耗时毫秒数。
 * @return {string} 格式化后的时长。
 */
function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  return `${(elapsedMs / 1000).toFixed(1)}s`;
}
