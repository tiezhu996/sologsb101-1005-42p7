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
  /** 该支座最近一次等级变更时间（无则未变更过） */
  gradeChangedAt?: string;
  /** 该记录是否晚于最近一次等级变更（即是否仍对当前等级有效） */
  current: boolean;
  /** 失效原因（已失效时给出） */
  invalidReason: string;
  /** 该支座已通过阶段数 */
  passedStages: number;
  /** 该支座是否已全部合格（仅计对当前等级有效的记录） */
  fullyAccepted: boolean;
  /** 未通过阶段提示 */
  failedStages: string[];
}

/** 阶段序号，用于判断验收顺序 */
export function stageOrder(stage: AcceptanceStage): number {
  return ACCEPTANCE_STAGES.indexOf(stage);
}

/** 校验验收顺序：必须先完成上一分步 */
export function stageOrderHint(
  stage: AcceptanceStage,
  passedStages: AcceptanceStage[],
): string {
  const index = stageOrder(stage);
  if (index === 0) return '首步验收：顶升到位后测量支座垫石标高与位移';
  const missing = ACCEPTANCE_STAGES.slice(0, index).filter((item) => !passedStages.includes(item));
  if (missing.length > 0) {
    return `建议先完成 ${missing.map((item) => ACCEPTANCE_STAGE_LABEL[item]).join('、')} 的验收`;
  }
  return '前序分步已完成，可按序签署本步验收';
}

/** 归档条件文案 */
export function archiveHint(fullyAcceptedCount: number, totalBearings: number): string {
  if (totalBearings === 0) return '尚未登记支座，无法归档';
  if (fullyAcceptedCount >= totalBearings) {
    return `全部 ${totalBearings} 个支座四步验收合格，可执行竣工归档`;
  }
  return `还差 ${totalBearings - fullyAcceptedCount} 个支座完成四步验收，暂不能归档`;
}

/**
 * 验收记录是否仍对当前等级有效。
 * 唯一判据：签署时间必须严格晚于该支座最近一次等级变更时间
 * （`yyyy-MM-dd HH:mm` 等宽格式可直接按字符串比较）。
 * 调级前签署的记录一律失效；从未调级（gradeChangedAt 为空）的记录始终有效。
 * 不能只看当前等级，否则严重改回轻微后旧合格记录会被错误地重新启用。
 */
export function isAcceptanceCurrent(record: Pick<Acceptance, 'acceptedAt'>, gradeChangedAt?: string): boolean {
  if (!gradeChangedAt) return true;
  return record.acceptedAt > gradeChangedAt;
}

/**
 * 该支座调级后是否仍有未完成的复验：
 * 只有「曾经调过级」且「调级前签过验收记录」时才需要按四步顺序复验。
 * 等级没改过、或调级时从未签过验收的支座不受影响。
 */
export function needsReinspection(
  gradeChangedAt: string | undefined,
  acceptances: Array<Pick<Acceptance, 'acceptedAt'>>,
): boolean {
  if (!gradeChangedAt) return false;
  return acceptances.some((item) => item.acceptedAt <= gradeChangedAt);
}

/** 取一组验收记录中对当前等级仍有效的部分 */
export function effectiveAcceptances<T extends Pick<Acceptance, 'acceptedAt'>>(
  acceptances: T[],
  gradeChangedAt?: string,
): T[] {
  return acceptances.filter((item) => isAcceptanceCurrent(item, gradeChangedAt));
}

/**
 * 各分步的最新一条有效验收结论。
 * 同一分步允许重签（如不合格整改后重签合格），以签署时间最晚的一条为准。
 */
export function effectiveStageConclusions(
  acceptances: Array<Pick<Acceptance, 'stage' | 'conclusion' | 'acceptedAt'>>,
  gradeChangedAt?: string,
): Map<AcceptanceStage, AcceptanceConclusion> {
  const latest = new Map<AcceptanceStage, { conclusion: AcceptanceConclusion; acceptedAt: string }>();
  for (const item of effectiveAcceptances(acceptances, gradeChangedAt)) {
    const prev = latest.get(item.stage);
    if (!prev || item.acceptedAt > prev.acceptedAt) {
      latest.set(item.stage, { conclusion: item.conclusion, acceptedAt: item.acceptedAt });
    }
  }
  return new Map([...latest].map(([stage, value]) => [stage, value.conclusion]));
}

/** 某分步的最新有效结论是否为合格 */
export function stagePassed(
  acceptances: Array<Pick<Acceptance, 'stage' | 'conclusion' | 'acceptedAt'>>,
  stage: AcceptanceStage,
  gradeChangedAt?: string,
): boolean {
  return effectiveStageConclusions(acceptances, gradeChangedAt).get(stage) === 'pass';
}

/**
 * 调级后复验是否允许签署指定分步：必须按「顶升到位 → 支座就位 → 落梁 → 竣工」顺序，
 * 前序分步均已有对当前等级有效的合格记录。
 * 未调级复验的支座不做顺序闸门，保留原批量签署口径。
 */
export function canSignInOrder(
  stage: AcceptanceStage,
  acceptances: Array<Pick<Acceptance, 'stage' | 'conclusion' | 'acceptedAt'>>,
  gradeChangedAt?: string,
): boolean {
  if (!gradeChangedAt) return true;
  const conclusions = effectiveStageConclusions(acceptances, gradeChangedAt);
  const index = stageOrder(stage);
  return ACCEPTANCE_STAGES.slice(0, index).every((prev) => conclusions.get(prev) === 'pass');
}

/** 复验时被顺序闸门拦住的前序缺失分步名称 */
export function missingPriorStages(
  stage: AcceptanceStage,
  acceptances: Array<Pick<Acceptance, 'stage' | 'conclusion' | 'acceptedAt'>>,
  gradeChangedAt?: string,
): string[] {
  const conclusions = effectiveStageConclusions(acceptances, gradeChangedAt);
  const index = stageOrder(stage);
  return ACCEPTANCE_STAGES.slice(0, index)
    .filter((prev) => conclusions.get(prev) !== 'pass')
    .map((prev) => ACCEPTANCE_STAGE_LABEL[prev]);
}

/** 验收记录的失效标记文案：供列表标注「失效」且记录本身保留可查 */
export function acceptanceValidityLabel(gradeChangedAt?: string): string {
  return gradeChangedAt
    ? `已于 ${gradeChangedAt} 调级，该签署早于最近一次等级变更，已失效，需按四步顺序重新复验`
    : '';
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
