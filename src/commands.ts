/** 可生成的 brief 类型 */
export const BRIEF_TYPES = ['commit', 'commit-title', 'commit-summary', 'cr-description'] as const;

/** brief 类型 */
export type BriefType = (typeof BRIEF_TYPES)[number];

/** brief 选项 */
export interface BriefOption {
  /** brief 类型 */
  type: BriefType;
  /** brief 标题 */
  label: string;
  /** brief 描述 */
  description: string;
  /** 是否允许继续执行 Git 写操作 */
  allowsGitExecution: boolean;
}

/** 已解析的命令 */
export type ResolvedCommand =
  | {kind: 'interactive'; initialBriefType?: BriefType}
  | {kind: 'install'}
  | {kind: 'doctor'}
  | {kind: 'doctor-token'}
  | {kind: 'config'}
  | {kind: 'profiles'}
  | {kind: 'use'; profileName: string | undefined}
  | {kind: 'help'};

/** brief 选项列表 */
const BRIEF_OPTIONS: readonly BriefOption[] = [
  {
    type: 'commit',
    label: 'Commit',
    description: '生成 commit title 和 summary，并可确认执行 git add / commit / push',
    allowsGitExecution: true
  },
  {
    type: 'commit-title',
    label: 'Commit Title',
    description: '只生成一行 commit title',
    allowsGitExecution: false
  },
  {
    type: 'commit-summary',
    label: 'Commit Summary',
    description: '只生成结构化 commit summary',
    allowsGitExecution: false
  },
  {
    type: 'cr-description',
    label: 'CR Description',
    description: '生成结构化 Code Review Description',
    allowsGitExecution: false
  }
] as const;

/**
 * @description 获取全部 brief 选项。
 * @return {readonly BriefOption[]} brief 选项列表。
 */
export function getBriefOptions(): readonly BriefOption[] {
  return BRIEF_OPTIONS;
}

/**
 * @description 读取指定 brief 选项。
 * @param {BriefType} briefType brief 类型。
 * @return {BriefOption} brief 选项。
 */
export function getBriefOption(briefType: BriefType): BriefOption {
  const matched = BRIEF_OPTIONS.find((item) => item.type === briefType);
  if (!matched) {
    throw new Error(`Unsupported brief type: ${briefType}`);
  }

  return matched;
}

/**
 * @description 判断 brief 是否允许执行 Git 写操作。
 * @param {BriefType} briefType brief 类型。
 * @return {boolean} 是否允许执行。
 */
export function allowsGitExecution(briefType: BriefType): boolean {
  return getBriefOption(briefType).allowsGitExecution;
}

/**
 * @description 解析 brief 类型文本。
 * @param {string | undefined} rawType 原始类型文本。
 * @return {BriefType} brief 类型。
 */
export function parseBriefType(rawType: string | undefined): BriefType {
  if (rawType && BRIEF_TYPES.includes(rawType as BriefType)) {
    return rawType as BriefType;
  }

  throw new Error(`Brief type is required. Usage: gai brief <${BRIEF_TYPES.join('|')}>`);
}

/**
 * @description 解析命令行参数。
 * @param {string[]} args 命令参数。
 * @return {ResolvedCommand} 已解析命令。
 */
export function resolveCliCommand(args: string[]): ResolvedCommand {
  const [command, subcommand] = args;

  if (!command) {
    return {kind: 'interactive'};
  }

  if (command === 'install') {
    return {kind: 'install'};
  }

  if (command === 'doctor') {
    return subcommand === '--token' ? {kind: 'doctor-token'} : {kind: 'doctor'};
  }

  if (command === 'config') {
    return {kind: 'config'};
  }

  if (command === 'profiles') {
    return {kind: 'profiles'};
  }

  if (command === 'use') {
    return {kind: 'use', profileName: subcommand};
  }

  if (command === 'commit') {
    return {kind: 'interactive', initialBriefType: 'commit'};
  }

  if (command === 'brief') {
    return {kind: 'interactive', initialBriefType: parseBriefType(subcommand)};
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    return {kind: 'help'};
  }

  throw new Error(`Unknown command: ${command}. Run gai --help for usage.`);
}

/**
 * @description 构建帮助文本。
 * @return {string} 帮助文本。
 */
export function formatHelpText(): string {
  return [
    'gai',
    '',
    '用法:',
    '  gai                                进入主交互流程，先选择 brief 类型再生成预览',
    '  gai commit                         直接进入 commit 生成流程，可确认执行 git add / commit / push',
    '  gai brief <type>                  直接生成指定 brief，type 可选 commit-title / commit-summary / cr-description',
    '  gai install                        写入 ~/.zshrc 并校验 gai 命令可用',
    '  gai doctor                         检查 Node、Git、profiles、Provider、zsh 安装状态',
    '  gai doctor --token                 估算当前 mixed workspace 改动的 prompt 体积与 token 使用',
    '  gai config                         编辑当前激活 profile 配置并同步到 .env/active.env',
    '  gai profiles                       查看全部 profile',
    '  gai use <profile>                  一键切换当前生效模型 profile',
    '  gai --help                         查看帮助'
  ].join('\n');
}
