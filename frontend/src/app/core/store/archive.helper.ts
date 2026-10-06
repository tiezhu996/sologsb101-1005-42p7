/**
 * 归档判定辅助：检查是否所有支座均已完成「最近一次调级后」的四步验收，
 * 返回可归档的桥梁摘要；并在支座调级后撤销不再满足条件的桥梁归档标记。
 * 被 acceptance store 的批量签署 effect、bearing store 的调级 effect 调用。
 */
import { listAcceptances, listBearings, listBridges, listPiers, listReadings, listSteps, putBridge } from '../utils/db';
import { isBearingFullyAccepted, archiveSummary } from '../types/acceptance';
import type { AcceptanceRow, BearingRow, BridgeRow } from '../utils/db';
export interface ArchiveCheckResult {
  /** 已满足归档条件的桥梁 id */
  archivableBridgeIds: string[];
  /** 摘要文案 */
  summaries: string[];
}

/**
 * 判定一批支座是否全部四步「有效」合格：
 * 验收有效性取决于签署时间是否晚于该支座最近一次等级变更，
 * 不能只看当前等级——严重件改回轻微后，旧合格记录因签署早于变更仍然失效。
 */
export function bridgeFullyAccepted(
  ownedBearings: BearingRow[],
  acceptances: AcceptanceRow[],
): boolean {
  return ownedBearings.every((bearing) => {
    const own = acceptances.filter((item) => item.bearingId === bearing.id);
    return isBearingFullyAccepted(own, bearing.gradeChangedAt ?? null);
  });
}

/** 检查全部桥梁的归档条件（仅统计有效验收） */
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
    if (!bridgeFullyAccepted(ownedBearings, acceptances)) continue;

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

/**
 * 归档对账：支座等级调整 / 验收变更后，对已归档桥梁重新判定。
 * 任一桥梁不再满足「全部支座四步有效合格」，即撤销其归档标记并返回被撤销的桥梁。
 */
export async function reconcileArchivedBridges(): Promise<BridgeRow[]> {
  const [bridges, piers, bearings, acceptances] = await Promise.all([
    listBridges(),
    listPiers(),
    listBearings(),
    listAcceptances(),
  ]);
  const unarchived: BridgeRow[] = [];
  for (const bridge of bridges) {
    if (!bridge.archived) continue;
    const pierIds = new Set(piers.filter((item) => item.bridgeId === bridge.id).map((item) => item.id));
    const ownedBearings = bearings.filter((item) => pierIds.has(item.pierId));
    if (ownedBearings.length > 0 && bridgeFullyAccepted(ownedBearings, acceptances)) continue;
    const next = { ...bridge, archived: false };
    await putBridge(next);
    unarchived.push(next);
  }
  return unarchived;
}
