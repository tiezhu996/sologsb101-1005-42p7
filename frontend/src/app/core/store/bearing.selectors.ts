import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { BearingState } from './bearing.reducer';
import type { AcceptanceRow, BearingRow, PierRow, BridgeRow } from '../utils/db';
import {
  ACCEPTANCE_STAGES,
  effectiveStageConclusions,
  isAcceptanceCurrent,
  needsReinspection,
} from '../types/acceptance';
import {
  countByGrade,
  needReplacement,
  replacementAdvice,
  specSizeHint,
  type BearingView,
} from '../types/bearing';

export const selectBearingState = createFeatureSelector<BearingState>('bearing');
export const selectBearings = createSelector(selectBearingState, (state) => state.bearings);
export const selectGradeFilter = createSelector(selectBearingState, (state) => state.gradeFilter);

/** 支座视图：带墩台、桥梁上下文与对当前等级的验收 / 复验派生状态 */
export function buildBearingViews(
  bearings: BearingRow[],
  piers: PierRow[],
  bridges: BridgeRow[],
  acceptances: AcceptanceRow[] = [],
): BearingView[] {
  return bearings.map((bearing) => {
    const pier = piers.find((item) => item.id === bearing.pierId);
    const bridge = pier ? bridges.find((item) => item.id === pier.bridgeId) : undefined;
    const ownAcceptances = acceptances.filter((item) => item.bearingId === bearing.id);
    const conclusions = effectiveStageConclusions(ownAcceptances, bearing.gradeChangedAt);
    const passedStageCount = ACCEPTANCE_STAGES.filter(
      (stage) => conclusions.get(stage) === 'pass',
    ).length;
    const staleCount = bearing.gradeChangedAt
      ? ownAcceptances.filter((item) => !isAcceptanceCurrent(item, bearing.gradeChangedAt)).length
      : 0;
    return {
      ...bearing,
      pierCode: pier?.code ?? '已删除墩台',
      bridgeId: bridge?.id ?? '',
      bridgeName: bridge?.name ?? '未归属桥梁',
      needReplacement: needReplacement(bearing.diseaseGrade),
      acceptanceStages: passedStageCount,
      accepted: passedStageCount === ACCEPTANCE_STAGES.length,
      // 调过级、调级前签过、且四步尚未全部重签合格 → 待复验
      reinspection:
        needsReinspection(bearing.gradeChangedAt, ownAcceptances) &&
        passedStageCount < ACCEPTANCE_STAGES.length,
      staleAcceptanceCount: staleCount,
    };
  });
}

/** 命中等级筛选的支座 */
export const selectFilteredBearings = createSelector(selectBearings, selectGradeFilter, (bearings, grades) =>
  grades.length === 0 ? bearings : bearings.filter((item) => grades.includes(item.diseaseGrade)),
);

/** 等级分组计数 */
export const selectBearingGradeCounts = createSelector(selectBearings, (bearings) => countByGrade(bearings));

/** 更换建议清单（较重及以上） */
export const selectReplacementList = createSelector(selectBearings, (bearings) =>
  bearings
    .filter((item) => needReplacement(item.diseaseGrade))
    .map((item) => ({
      id: item.id,
      serial: item.serial,
      spec: item.spec,
      grade: item.diseaseGrade,
      advice: replacementAdvice(item.diseaseGrade),
      sizeHint: specSizeHint(item.spec),
    })),
);

/** 支座统计概览 */
export const selectBearingStats = createSelector(selectBearings, (bearings) => {
  const counts = countByGrade(bearings);
  return {
    total: bearings.length,
    intact: counts.intact,
    slight: counts.slight,
    moderate: counts.moderate,
    severe: counts.severe,
    pending: counts.moderate + counts.severe,
  };
});
