/** 变更来源 */
export type SummarySource = 'staged' | 'working-tree' | 'mixed-workspace';

/** 摘要策略 */
export type SummaryStrategy = 'incremental' | 'contextual' | 'compressed';

/** 文件语义角色 */
export type FileRole = 'script' | 'request' | 'doc' | 'config' | 'type' | 'test' | 'other';

/** 变更语义类别 */
export type ChangeKind = 'behavior' | 'contract' | 'structure' | 'relocation' | 'config' | 'test' | 'doc';

/** 变更文件 */
export interface ChangedFile {
  /** 文件状态 */
  status: string;
  /** 文件路径 */
  path: string;
  /** 重命名前路径 */
  oldPath?: string;
  /** 新增行数 */
  added?: number;
  /** 删除行数 */
  removed?: number;
  /** 变更总行数 */
  total?: number;
}

/** 分文件补丁 */
export interface FilePatch {
  /** 文件路径 */
  path: string;
  /** 补丁内容 */
  content: string;
}

/** 补丁行统计 */
export interface PatchLineStats {
  /** 新增行数 */
  added: number;
  /** 删除行数 */
  removed: number;
  /** 总行数 */
  total: number;
}

/** 摘要统计 */
export interface SummaryStats {
  /** 文件总数 */
  fileCount: number;
  /** 忽略文件数 */
  ignoredFileCount: number;
  /** 高上下文文件数 */
  highContextFileCount: number;
  /** 补丁字符数 */
  patchChars: number;
}

/** 文件级变更 IR */
export interface ChangeIRFile {
  /** 文件路径 */
  file: string;
  /** 迁移前文件路径 */
  oldFile?: string;
  /** 文件角色 */
  role: FileRole;
  /** 变更状态 */
  status: string;
  /** 新增行数 */
  added: number;
  /** 删除行数 */
  removed: number;
  /** 变更总行数 */
  total: number;
  /** 变更符号 */
  symbols: string[];
  /** 导出符号 */
  exportedSymbols: string[];
  /** 依赖变更 */
  dependencyChanges: string[];
  /** 变更语义类别 */
  changeKinds: ChangeKind[];
  /** 证据快照 */
  evidence: {
    /** 是否包含代码逻辑变化 */
    hasCodeLogicChange: boolean;
    /** 是否包含导出形状变化 */
    hasExportShapeChange: boolean;
    /** 是否包含依赖变化 */
    hasDependencyChange: boolean;
    /** 是否是纯路径迁移 */
    hasPathOnlyMove: boolean;
  };
  /** 文件摘要 */
  summary: string;
}

/** 结构化变更 IR */
export interface ChangeIR {
  /** 变更概览 */
  overview: {
    /** 变更来源 */
    source: SummarySource;
    /** 文件总数 */
    filesChanged: number;
    /** 新增总行数 */
    addedLines: number;
    /** 删除总行数 */
    deletedLines: number;
    /** 摘要策略 */
    strategy: SummaryStrategy;
    /** 主导意图 */
    primaryIntent: 'architecture-restructure' | 'behavior-change' | 'contract-alignment' | 'tooling' | 'mixed';
    /** 是否包含纯迁移 */
    hasPureRelocations: boolean;
  };
  /** 文件级变更 */
  changes: ChangeIRFile[];
  /** 测试文件 */
  tests: string[];
  /** 风险提示 */
  risks: string[];
}

/** 摘要输入 */
export interface SummaryChanges {
  /** 变更来源 */
  source: SummarySource;
  /** 摘要策略 */
  strategy: SummaryStrategy;
  /** 文件状态摘要 */
  nameStatus: string;
  /** 补丁内容 */
  patch: string;
  /** 文件级摘要 */
  fileSummary: string;
  /** 文件结构概览 */
  filesOverview: string;
  /** 分组摘要 */
  groupSummary: string;
  /** 语义提示 */
  semanticHints: string;
  /** 上下文摘要 */
  contextSummary: string;
  /** 结构化 IR */
  ir: ChangeIR;
  /** 统计信息 */
  stats: SummaryStats;
}

/** 工作区快照 */
export interface WorkspaceSnapshot {
  /** 来源 */
  source: SummarySource;
  /** 文件状态 */
  nameStatus: string;
  /** 补丁内容 */
  patch: string;
}
