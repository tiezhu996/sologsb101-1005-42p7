import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { BearingState } from './bearing.reducer';
import type { AcceptanceRow, BearingRow, PierRow, BridgeRow } from '../utils/db';
import {
  countByGrade,
  needReplacement,
  replacementAdvice,
  specSizeHint,
  type BearingView,
} from '../types/bearing';
import {
  ACCEPTANCE_STAGES,
  currentAcceptancesOf,
  isAcceptanceCurrent,
  isBearingFullyAccepted,
} from '../types/acceptance';

export const selectBearingState = createFeatureSelector<BearingState>('bearing');
export const selectBearings = createSelector(selectBearingState, (state) => state.bearings);
export const selectGradeFilter = createSelector(selectBearingState, (state) => state.gradeFilter);

/**
 * 支座视图：带墩台与桥梁上下文。
 * 可选传验收记录以回填调级后的有效验收进度；不传时进度按 0 处理。
 */
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
    const current = currentAcceptancesOf(ownAcceptances, bearing.gradeChangedAt ?? null);
    const passedStages = new Set(
      current.filter((item) => item.conclusion === 'pass').map((item) => item.stage),
    );
    return {
      ...bearing,
      pierCode: pier?.code ?? '已删除墩台',
      bridgeId: bridge?.id ?? '',
      bridgeName: bridge?.name ?? '未归属桥梁',
      needReplacement: needReplacement(bearing.diseaseGrade),
      acceptanceStages: ACCEPTANCE_STAGES.filter((stage) => passedStages.has(stage)).length,
      accepted: isBearingFullyAccepted(ownAcceptances, bearing.gradeChangedAt ?? null),
      hasStaleAcceptance: ownAcceptances.some(
        (item) => !isAcceptanceCurrent(item.acceptedAt, bearing.gradeChangedAt ?? null),
      ),
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
