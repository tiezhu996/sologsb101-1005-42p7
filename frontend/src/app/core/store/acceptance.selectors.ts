import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { AcceptanceState } from './acceptance.reducer';
import type { AcceptanceRow, BearingRow, BridgeRow, PierRow } from '../utils/db';
import {
  ACCEPTANCE_STAGES,
  ACCEPTANCE_STAGE_LABEL,
  acceptanceValidityLabel,
  archiveHint,
  effectiveStageConclusions,
  isAcceptanceCurrent,
  stageOrder,
  type AcceptanceStage,
  type AcceptanceView,
} from '../types/acceptance';
import { selectBearings } from './bearing.selectors';

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

/** 支座 → 对当前等级仍有效、最新结论为合格的分步集合 */
export function passedStagesOf(
  acceptances: AcceptanceRow[],
  bearingId: string,
  gradeChangedAt?: string,
): AcceptanceStage[] {
  const conclusions = effectiveStageConclusions(
    acceptances.filter((item) => item.bearingId === bearingId),
    gradeChangedAt,
  );
  return ACCEPTANCE_STAGES.filter((stage) => conclusions.get(stage) === 'pass');
}

/** 支座 → 对当前等级仍有效、最新结论为不合格的分步 */
export function failedStagesOf(
  acceptances: AcceptanceRow[],
  bearingId: string,
  gradeChangedAt?: string,
): AcceptanceStage[] {
  const conclusions = effectiveStageConclusions(
    acceptances.filter((item) => item.bearingId === bearingId),
    gradeChangedAt,
  );
  return ACCEPTANCE_STAGES.filter((stage) => conclusions.get(stage) === 'fail');
}

/** 验收视图：带支座与桥梁上下文，并标注每条记录对当前等级是否仍有效 */
export function buildAcceptanceViews(
  acceptances: AcceptanceRow[],
  bearings: BearingRow[],
  piers: PierRow[],
  bridges: BridgeRow[],
): AcceptanceView[] {
  return acceptances
    .map((record) => {
      const bearing = bearings.find((item) => item.id === record.bearingId);
      const pier = bearing ? piers.find((item) => item.id === bearing.pierId) : undefined;
      const bridge = pier ? bridges.find((item) => item.id === pier.bridgeId) : undefined;
      const gradeChangedAt = bearing?.gradeChangedAt;
      const current = isAcceptanceCurrent(record, gradeChangedAt);
      const passed = bearing ? passedStagesOf(acceptances, bearing.id, gradeChangedAt) : [];
      const failed = bearing ? failedStagesOf(acceptances, bearing.id, gradeChangedAt) : [];
      return {
        ...record,
        bearingSerial: bearing?.serial ?? '已删除支座',
        bearingSpec: bearing?.spec ?? '-',
        pierCode: pier?.code ?? '-',
        bridgeId: bridge?.id ?? '',
        bridgeName: bridge?.name ?? '未归属桥梁',
        gradeChangedAt,
        current,
        invalidReason: current ? '' : acceptanceValidityLabel(gradeChangedAt),
        passedStages: passed.length,
        fullyAccepted: ACCEPTANCE_STAGES.every((stage) => passed.includes(stage)) && failed.length === 0,
        failedStages: failed.map((stage) => ACCEPTANCE_STAGE_LABEL[stage]),
      };
    })
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
}

/** 验收阶段统计（合格 / 不合格仅计对当前等级有效的记录；失效记录单列） */
export const selectAcceptanceStats = createSelector(selectAcceptances, selectBearings, (acceptances, bearings) => {
  const gradeAtOf = new Map(bearings.map((item) => [item.id, item.gradeChangedAt]));
  const valid = acceptances.filter((item) => isAcceptanceCurrent(item, gradeAtOf.get(item.bearingId)));
  const invalid = acceptances.length - valid.length;
  return {
    total: acceptances.length,
    pass: valid.filter((item) => item.conclusion === 'pass').length,
    fail: valid.filter((item) => item.conclusion === 'fail').length,
    invalid,
    byStage: ACCEPTANCE_STAGES.map((stage) => ({
      stage,
      label: ACCEPTANCE_STAGE_LABEL[stage],
      count: valid.filter((item) => item.stage === stage).length,
      pass: valid.filter((item) => item.stage === stage && item.conclusion === 'pass').length,
    })),
  };
});

/** 归档条件提示（需要支座总数） */
export function selectArchiveHint(fullyAcceptedCount: number, totalBearings: number): string {
  return archiveHint(fullyAcceptedCount, totalBearings);
}
