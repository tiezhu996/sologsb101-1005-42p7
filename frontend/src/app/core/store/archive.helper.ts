/**
 * 归档判定辅助：检查是否所有支座均已完成四步验收，返回可归档的桥梁摘要。
 * 被 acceptance store 的批量签署 effect 调用。
 *
 * 复验口径：支座病害等级一旦变更，早于「最近一次等级变更时间」的验收签署一律失效，
 * 必须按四步顺序对当前等级重新签署。因此这里只统计有效记录，
 * 不能只看当前等级（否则严重改回轻微后旧合格记录会被错误启用）。
 */
import { listAcceptances, listBearings, listBridges, listPiers, listReadings, listSteps } from '../utils/db';
import {
  ACCEPTANCE_STAGES,
  archiveSummary,
  effectiveStageConclusions,
  type Acceptance,
} from '../types/acceptance';

export interface ArchiveCheckResult {
  /** 已满足归档条件的桥梁 id */
  archivableBridgeIds: string[];
  /** 摘要文案 */
  summaries: string[];
}

/** 检查全部桥梁的归档条件 */
export async function checkBridgeArchived(): Promise<ArchiveCheckResult> {
  const [bridges, piers, bearings, acceptances, steps, readings] = await Promise.all([
    listBridges(),
    listPiers(),
    listBearings(),
    listAcceptances(),
    listSteps(),
    listReadings(),
  ]);

  const archivableBridgeIds: string[] = [];
  const summaries: string[] = [];

  for (const bridge of bridges) {
    const pierIds = new Set(piers.filter((item) => item.bridgeId === bridge.id).map((item) => item.id));
    const ownedBearings = bearings.filter((item) => pierIds.has(item.pierId));
    if (ownedBearings.length === 0) continue;
    /** 仅当某支座对当前等级有效的验收四个分步全部为「合格」时才算完成 */
    const isFullyAccepted = (bearing: (typeof ownedBearings)[number]): boolean => {
      const ownAcceptances: Acceptance[] = acceptances.filter((item) => item.bearingId === bearing.id);
      const conclusions = effectiveStageConclusions(ownAcceptances, bearing.gradeChangedAt);
      return ACCEPTANCE_STAGES.every((stage) => conclusions.get(stage) === 'pass');
    };
    if (!ownedBearings.every(isFullyAccepted)) continue;

    const bridgeSteps = steps.filter((item) => item.bridgeId === bridge.id);
    const stepIds = new Set(bridgeSteps.map((item) => item.id));
    archivableBridgeIds.push(bridge.id);
    summaries.push(
      archiveSummary({
        bridgeName: bridge.name,
        bearingCount: ownedBearings.length,
        totalLiftMm: Number(bridgeSteps.reduce((sum, item) => sum + item.targetLiftMm, 0).toFixed(2)),
        stepCount: bridgeSteps.length,
        readingCount: readings.filter((item) => stepIds.has(item.stepId)).length,
      }),
    );
  }

  return { archivableBridgeIds, summaries };
}
