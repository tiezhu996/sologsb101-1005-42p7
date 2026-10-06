import type { RowMeta } from './persistence';

/** 验收分步 */
export type AcceptanceStage = 'lifted' | 'bearingPlaced' | 'beamLowered' | 'completed';

/** 验收结论 */
export type AcceptanceConclusion = 'pass' | 'fail';

export const ACCEPTANCE_STAGE_LABEL: Record<AcceptanceStage, string> = {
  lifted: '顶升到位',
  bearingPlaced: '支座就位',
  beamLowered: '落梁',
  completed: '竣工',
};

export const ACCEPTANCE_CONCLUSION_LABEL: Record<AcceptanceConclusion, string> = {
  pass: '合格',
  fail: '不合格',
};

export const ACCEPTANCE_STAGES: AcceptanceStage[] = ['lifted', 'bearingPlaced', 'beamLowered', 'completed'];
export const ACCEPTANCE_CONCLUSIONS: AcceptanceConclusion[] = ['pass', 'fail'];

/** 验收记录 */
export interface Acceptance extends RowMeta {
  id: string;
  /** 关联支座 */
  bearingId: string;
  /** 分步 */
  stage: AcceptanceStage;
  /** 结论 */
  conclusion: AcceptanceConclusion;
  /** 验收人 */
  acceptor: string;
  /** 验收时间 yyyy-MM-dd HH:mm */
  acceptedAt: string;
}

/** 验收表单草稿 */
export interface AcceptanceDraft {
  bearingId: string;
  stage: AcceptanceStage;
  conclusion: AcceptanceConclusion;
  acceptor: string;
  acceptedAt: string;
}

/** 验收视图：带支座与桥梁上下文 */
export interface AcceptanceView extends Acceptance {
  bearingSerial: string;
  bearingSpec: string;
  pierCode: string;
  bridgeId: string;
  bridgeName: string;
  /** 该支座已通过阶段数（仅统计有效验收） */
  passedStages: number;
  /** 该支座是否已全部合格（四步均为有效合格） */
  fullyAccepted: boolean;
  /** 未通过阶段提示（有效记录中的不合格阶段） */
  failedStages: string[];
  /** 该条验收是否有效（签署时间晚于最近一次等级变更） */
  valid: boolean;
  /** 失效原因：关联支座最近一次病害等级变更时间；有效或无变更时为 null */
  invalidReason: string | null;
}

/**
 * 解析业务时间文本（yyyy-MM-dd HH:mm，兼容 ss / ISO 与 datetime-local 的 'T'）。
 * 按本地时间构造；无法解析时返回 null。
 */
export function parseAcceptedTime(text: string | null | undefined): Date | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const matched = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!matched) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, year, month, day, hour, minute, second] = matched;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0,
  );
}

/**
 * 验收是否有效：签署时间必须不早于（按分钟比较）该支座最近一次等级变更时间。
 * - 支座从未调级（gradeChangedAt 为空）→ 所有既有验收持续有效；
 * - 签署时间无法解析时不误判失效（历史脏数据不阻断归档）；
 * - 等级变更时间无法解析时，无法证明"签署晚于变更"，按失效处理。
 */
export function isAcceptanceCurrent(
  acceptedAt: string,
  gradeChangedAt: string | null | undefined,
): boolean {
  if (gradeChangedAt === null || gradeChangedAt === undefined || gradeChangedAt === '') return true;
  const signedAt = parseAcceptedTime(acceptedAt);
  const changedAt = parseAcceptedTime(gradeChangedAt);
  if (!changedAt) return false;
  if (!signedAt) return true;
  return Math.floor(signedAt.getTime() / 60000) >= Math.floor(changedAt.getTime() / 60000);
}

/** 失效提示文案（等级变更时间） */
export function staleAcceptanceReason(gradeChangedAt: string | null | undefined): string | null {
  if (gradeChangedAt === null || gradeChangedAt === undefined || gradeChangedAt === '') return null;
  return `支座病害等级已于 ${gradeChangedAt.slice(0, 16)} 调整，本条签署早于变更，已失效，须按四步顺序复验重签`;
}

/**
 * 取某支座当前有效的验收记录（签署晚于最近一次等级变更）。
 */
export function currentAcceptancesOf<T extends Pick<Acceptance, 'acceptedAt'>>(
  acceptances: T[],
  gradeChangedAt: string | null | undefined,
): T[] {
  return acceptances.filter((item) => isAcceptanceCurrent(item.acceptedAt, gradeChangedAt));
}

/** 阶段序号，用于判断验收顺序 */
export function stageOrder(stage: AcceptanceStage): number {
  return ACCEPTANCE_STAGES.indexOf(stage);
}

/**
 * 四步顺序签署前置校验：签署 stage 前，此前各分步都必须已有「当前有效」的合格记录。
 * 首步（顶升到位）恒可签署。等级变更后旧记录失效，复验必须从第一步重新签起。
 */
export function canSignStage(
  stage: AcceptanceStage,
  currentPassedStages: AcceptanceStage[],
): boolean {
  const index = stageOrder(stage);
  return ACCEPTANCE_STAGES.slice(0, index).every((item) => currentPassedStages.includes(item));
}

/** 首个尚不能签署（前置有效合格缺失）的分步提示 */
export function blockedStageHint(currentPassedStages: AcceptanceStage[]): string | null {
  for (const stage of ACCEPTANCE_STAGES) {
    if (currentPassedStages.includes(stage)) continue;
    const missing = ACCEPTANCE_STAGES.slice(0, stageOrder(stage)).filter(
      (item) => !currentPassedStages.includes(item),
    );
    if (missing.length > 0) {
      return `须先完成 ${missing.map((item) => ACCEPTANCE_STAGE_LABEL[item]).join('、')} 的有效验收，才能签署「${ACCEPTANCE_STAGE_LABEL[stage]}」`;
    }
    return null;
  }
  return null;
}

/**
 * 校验验收顺序：必须先完成上一分步（依据当前有效合格阶段）。
 */
export function stageOrderHint(
  stage: AcceptanceStage,
  passedStages: AcceptanceStage[],
): string {
  const index = stageOrder(stage);
  if (index === 0) return '首步复验：等级变更后须重新测量支座垫石标高与位移';
  const missing = ACCEPTANCE_STAGES.slice(0, index).filter((item) => !passedStages.includes(item));
  if (missing.length > 0) {
    return `建议先完成 ${missing.map((item) => ACCEPTANCE_STAGE_LABEL[item]).join('、')} 的有效验收`;
  }
  return '前序分步已完成，可按序签署本步验收';
}

/**
 * 某支座是否已四步全部有效合格：四个分步都存在当前有效的合格记录，
 * 且不存在当前有效的不合格记录。
 */
export function isBearingFullyAccepted(
  acceptances: Acceptance[],
  gradeChangedAt: string | null | undefined,
): boolean {
  const current = currentAcceptancesOf(acceptances, gradeChangedAt);
  if (current.some((item) => item.conclusion === 'fail')) return false;
  const passed = new Set(current.filter((item) => item.conclusion === 'pass').map((item) => item.stage));
  return ACCEPTANCE_STAGES.every((stage) => passed.has(stage));
}

/** 归档条件文案 */
export function archiveHint(fullyAcceptedCount: number, totalBearings: number): string {
  if (totalBearings === 0) return '尚未登记支座，无法归档';
  if (fullyAcceptedCount >= totalBearings) {
    return `全部 ${totalBearings} 个支座最近一次调级后的四步验收均合格，可执行竣工归档`;
  }
  return `还差 ${totalBearings - fullyAcceptedCount} 个支座完成（调级后的）四步复验，暂不能归档`;
}

/** 竣工归档后的移交清单摘要 */
export function archiveSummary(input: {
  bridgeName: string;
  bearingCount: number;
  totalLiftMm: number;
  stepCount: number;
  readingCount: number;
}): string {
  return `${input.bridgeName}：${input.stepCount} 级顶升、累计 ${input.totalLiftMm} mm、${input.bearingCount} 个支座更换、${input.readingCount} 条测点读数已归档`;
}
