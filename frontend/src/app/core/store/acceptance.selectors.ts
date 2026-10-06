import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { AcceptanceState } from './acceptance.reducer';
import type { AcceptanceRow, BearingRow, BridgeRow, PierRow } from '../utils/db';
import { selectBearings } from './bearing.selectors';
import {
  ACCEPTANCE_STAGES,
  ACCEPTANCE_STAGE_LABEL,
  archiveHint,
  currentAcceptancesOf,
  isAcceptanceCurrent,
  isBearingFullyAccepted,
  staleAcceptanceReason,
  stageOrder,
  type AcceptanceStage,
  type AcceptanceView,
} from '../types/acceptance';

export const selectAcceptanceState = createFeatureSelector<AcceptanceState>('acceptance');
export const selectAcceptances = createSelector(selectAcceptanceState, (state) => state.acceptances);
export const selectSelectedBearingIds = createSelector(
  selectAcceptanceState,
  (state) => state.selectedBearingIds,
);
export const selectLastArchiveSummary = createSelector(
  selectAcceptanceState,
  (state) => state.lastArchiveSummary,
);

/** 支座 → 最近一次等级变更时间索引 */
export function gradeChangedAtMapOf(bearings: BearingRow[]): Map<string, string | null> {
  return new Map(bearings.map((item) => [item.id, item.gradeChangedAt ?? null]));
}

/** 支座 → 当前有效的验收记录（签署晚于最近一次等级变更） */
export function currentAcceptancesFor(
  acceptances: AcceptanceRow[],
  bearingId: string,
  gradeChangedAt: string | null | undefined,
): AcceptanceRow[] {
  return currentAcceptancesOf(
    acceptances.filter((item) => item.bearingId === bearingId),
    gradeChangedAt,
  );
}

/** 支座 → 已通过阶段集合（仅有效验收） */
export function passedStagesOf(
  acceptances: AcceptanceRow[],
  bearingId: string,
  gradeChangedAt: string | null | undefined = null,
): AcceptanceStage[] {
  return currentAcceptancesFor(acceptances, bearingId, gradeChangedAt)
    .filter((item) => item.conclusion === 'pass')
    .map((item) => item.stage)
    .filter((stage, index, list) => list.indexOf(stage) === index);
}

/** 支座 → 未通过阶段（仅有效验收） */
export function failedStagesOf(
  acceptances: AcceptanceRow[],
  bearingId: string,
  gradeChangedAt: string | null | undefined = null,
): AcceptanceStage[] {
  return currentAcceptancesFor(acceptances, bearingId, gradeChangedAt)
    .filter((item) => item.conclusion === 'fail')
    .map((item) => item.stage)
    .filter((stage, index, list) => list.indexOf(stage) === index);
}

/** 验收视图：带支座与桥梁上下文，并标记调级后已失效的旧签署 */
export function buildAcceptanceViews(
  acceptances: AcceptanceRow[],
  bearings: BearingRow[],
  piers: PierRow[],
  bridges: BridgeRow[],
): AcceptanceView[] {
  const changedAtMap = gradeChangedAtMapOf(bearings);
  return acceptances
    .map((record) => {
      const bearing = bearings.find((item) => item.id === record.bearingId);
      const pier = bearing ? piers.find((item) => item.id === bearing.pierId) : undefined;
      const bridge = pier ? bridges.find((item) => item.id === pier.bridgeId) : undefined;
      const gradeChangedAt = bearing ? (bearing.gradeChangedAt ?? null) : null;
      const valid = isAcceptanceCurrent(record.acceptedAt, gradeChangedAt);
      const passed = bearing
        ? passedStagesOf(acceptances, bearing.id, gradeChangedAt)
        : [];
      const failed = bearing
        ? failedStagesOf(acceptances, bearing.id, gradeChangedAt)
        : [];
      return {
        ...record,
        bearingSerial: bearing?.serial ?? '已删除支座',
        bearingSpec: bearing?.spec ?? '-',
        pierCode: pier?.code ?? '-',
        bridgeId: bridge?.id ?? '',
        bridgeName: bridge?.name ?? '未归属桥梁',
        passedStages: passed.length,
        fullyAccepted:
          bearing !== undefined &&
          isBearingFullyAccepted(
            acceptances.filter((item) => item.bearingId === bearing.id),
            gradeChangedAt,
          ),
        failedStages: failed.map((stage) => ACCEPTANCE_STAGE_LABEL[stage]),
        valid,
        invalidReason: valid ? null : staleAcceptanceReason(gradeChangedAt),
      };
    })
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
}

/**
 * 验收阶段统计：失效（签署早于最近一次调级）旧记录单列，不计入合格 / 不合格。
 * 需要 bearings 提供每个支座的最近等级变更时间。
 */
export function buildAcceptanceStats(
  acceptances: AcceptanceRow[],
  bearings: BearingRow[],
): {
  total: number;
  pass: number;
  fail: number;
  stale: number;
  byStage: Array<{ stage: AcceptanceStage; label: string; count: number; pass: number; stale: number }>;
} {
  const changedAtMap = gradeChangedAtMapOf(bearings);
  const validRows = acceptances.filter((item) =>
    isAcceptanceCurrent(item.acceptedAt, changedAtMap.get(item.bearingId) ?? null),
  );
  return {
    total: acceptances.length,
    pass: validRows.filter((item) => item.conclusion === 'pass').length,
    fail: validRows.filter((item) => item.conclusion === 'fail').length,
    stale: acceptances.length - validRows.length,
    byStage: ACCEPTANCE_STAGES.map((stage) => ({
      stage,
      label: ACCEPTANCE_STAGE_LABEL[stage],
      count: validRows.filter((item) => item.stage === stage).length,
      pass: validRows.filter((item) => item.stage === stage && item.conclusion === 'pass').length,
      stale: acceptances.filter(
        (item) => item.stage === stage && !isAcceptanceCurrent(item.acceptedAt, changedAtMap.get(item.bearingId) ?? null),
      ).length,
    })),
  };
}

/**
 * 验收阶段统计（store 派生）：失效旧记录单列，不计入合格 / 不合格。
 */
export const selectAcceptanceStats = createSelector(
  selectAcceptances,
  selectBearings,
  (acceptances, bearings) => buildAcceptanceStats(acceptances, bearings),
);

/** 归档条件提示（需要支座总数） */
export function selectArchiveHint(fullyAcceptedCount: number, totalBearings: number): string {
  return archiveHint(fullyAcceptedCount, totalBearings);
}
