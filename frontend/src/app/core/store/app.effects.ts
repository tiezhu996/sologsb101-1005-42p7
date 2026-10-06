/**
 * NgRx Effects：把页面 dispatch 的动作落到 Dexie 写入，并驱动数据重载。
 * 所有写操作完成后通过 IdbTableService 广播变更，各 store 重新拉取数据。
 */
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, from, map, switchMap } from 'rxjs';
import { bridgeActions } from './bridge.actions';
import { bearingActions } from './bearing.actions';
import { stepActions } from './step.actions';
import { acceptanceActions } from './acceptance.actions';
import { appDataFailed, appDataLoaded, appInit, writeFailed, writeSucceeded } from './app.actions';
import { IdbTableService } from '../services/idb-table.service';
import {
  listAcceptances,
  listBearings,
  listBridges,
  listPiers,
  listReadings,
  listSteps,
  newId,
  putAcceptance,
  putBearing,
  putBearings,
  putBridge,
  putPier,
  putStep,
  putSteps,
  removeAcceptance,
  removeBearing,
  removeBridge,
  removePier,
  removeStep,
  rowMeta,
} from '../utils/db';
import type { AcceptanceRow } from '../utils/db';
import { escalateGrade } from '../types/bearing';
import { resequenceSteps } from '../types/step';
import { canSignStage, currentAcceptancesOf } from '../types/acceptance';
import { checkBridgeArchived, reconcileArchivedBridges } from './archive.helper';
import { nowDateTime } from '../utils/export';

@Injectable()
export class AppEffects {
  private readonly actions$ = inject(Actions);
  private readonly idb = inject(IdbTableService);

  /** 应用初始化 / 数据变更后：一次性加载全部表并分发给各 feature store */
  readonly loadAll$ = createEffect(() =>
    this.actions$.pipe(
      ofType(appInit),
      switchMap(() =>
        from(
          Promise.all([
            listBridges(),
            listPiers(),
            listBearings(),
            listSteps(),
            listReadings(),
            listAcceptances(),
          ]),
        ).pipe(
          map(([bridges, piers, bearings, steps, readings, acceptances]) =>
            appDataLoaded({ bridges, piers, bearings, steps, readings, acceptances }),
          ),
          catchError((error: unknown) =>
            from([
              appDataFailed({
                error: error instanceof Error ? error.message : '本地数据读取失败',
              }),
            ]),
          ),
        ),
      ),
    ),
  );

  /** 桥梁：新建 */
  readonly createBridge$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.createBridge),
        switchMap(({ draft }) =>
          from(
            putBridge({
              id: newId('bridge'),
              name: draft.name.trim(),
              spanCombo: draft.spanCombo.trim(),
              bridgeType: draft.bridgeType,
              builtYear: draft.builtYear,
              roadClass: draft.roadClass,
              archived: false,
              ...rowMeta(),
            }),
          ).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '新建桥梁失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 桥梁：更新 */
  readonly updateBridge$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.updateBridge),
        switchMap(({ id, draft }) =>
          from(
            (async () => {
              const existing = (await listBridges()).find((item) => item.id === id);
              if (!existing) return;
              await putBridge({
                ...existing,
                name: draft.name.trim(),
                spanCombo: draft.spanCombo.trim(),
                bridgeType: draft.bridgeType,
                builtYear: draft.builtYear,
                roadClass: draft.roadClass,
              });
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '更新桥梁失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 桥梁：删除（级联清理） */
  readonly deleteBridge$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.deleteBridge),
        switchMap(({ id }) =>
          from(removeBridge(id)).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '删除桥梁失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 桥梁：归档 / 撤销归档（归档须通过有效验收复核，撤销不受限） */
  readonly archiveBridge$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.archiveBridge),
        switchMap(({ id, archived }) =>
          from(
            (async () => {
              const existing = (await listBridges()).find((item) => item.id === id);
              if (!existing) return;
              if (archived) {
                const check = await checkBridgeArchived();
                if (!check.archivableBridgeIds.includes(id)) {
                  throw new Error('存在调级后未按四步复验合格的支座，不能归档');
                }
              }
              await putBridge({ ...existing, archived });
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '归档操作失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 墩台：新建 */
  readonly createPier$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.createPier),
        switchMap(({ draft }) =>
          from(
            putPier({
              id: newId('pier'),
              bridgeId: draft.bridgeId,
              code: draft.code.trim(),
              capElevation: draft.capElevation,
              type: draft.type,
              bearingCount: draft.bearingCount,
              ...rowMeta(),
            }),
          ).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '新建墩台失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 墩台：更新 */
  readonly updatePier$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.updatePier),
        switchMap(({ id, draft }) =>
          from(
            (async () => {
              const existing = (await listPiers()).find((item) => item.id === id);
              if (!existing) return;
              await putPier({
                ...existing,
                bridgeId: draft.bridgeId,
                code: draft.code.trim(),
                capElevation: draft.capElevation,
                type: draft.type,
                bearingCount: draft.bearingCount,
              });
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '更新墩台失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 墩台：删除 */
  readonly deletePier$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bridgeActions.deletePier),
        switchMap(({ id }) =>
          from(removePier(id)).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '删除墩台失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 支座：新建 */
  readonly createBearing$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bearingActions.createBearing),
        switchMap(({ draft }) =>
          from(
            putBearing({
              id: newId('bearing'),
              pierId: draft.pierId,
              serial: draft.serial.trim(),
              type: draft.type,
              spec: draft.spec.trim(),
              diseaseGrade: draft.diseaseGrade,
              diseaseNote: draft.diseaseNote.trim(),
              gradeChangedAt: null,
              ...rowMeta(),
            }),
          ).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '新建支座失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 支座：更新（等级发生变化时登记变更时间，旧验收随之失效并撤销已归档标记） */
  readonly updateBearing$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bearingActions.updateBearing),
        switchMap(({ id, draft }) =>
          from(
            (async () => {
              const existing = (await listBearings()).find((item) => item.id === id);
              if (!existing) return;
              const gradeChanged = existing.diseaseGrade !== draft.diseaseGrade;
              await putBearing({
                ...existing,
                pierId: draft.pierId,
                serial: draft.serial.trim(),
                type: draft.type,
                spec: draft.spec.trim(),
                diseaseGrade: draft.diseaseGrade,
                diseaseNote: draft.diseaseNote.trim(),
                gradeChangedAt: gradeChanged ? nowDateTime() : (existing.gradeChangedAt ?? null),
              });
              if (gradeChanged) await reconcileArchivedBridges();
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '更新支座失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 支座：删除 */
  readonly deleteBearing$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bearingActions.deleteBearing),
        switchMap(({ id }) =>
          from(removeBearing(id)).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '删除支座失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 支座：单条改等级（仅在等级真正变化时登记变更时间，等级未变不影响既有验收） */
  readonly setGrade$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bearingActions.setGrade),
        switchMap(({ id, grade }) =>
          from(
            (async () => {
              const existing = (await listBearings()).find((item) => item.id === id);
              if (!existing || existing.diseaseGrade === grade) return;
              await putBearing({ ...existing, diseaseGrade: grade, gradeChangedAt: nowDateTime() });
              await reconcileArchivedBridges();
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '更新支座等级失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 支座：批量改等级（逐个跳过等级未变者；变更者登记时间并撤销不再合格的归档） */
  readonly bulkSetGrade$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bearingActions.bulkSetGrade),
        switchMap(({ ids, grade }) =>
          from(
            (async () => {
              const rows = (await listBearings())
                .filter((item) => ids.includes(item.id))
                .filter((item) => item.diseaseGrade !== grade);
              if (rows.length === 0) return;
              const changedAt = nowDateTime();
              await putBearings(rows.map((item) => ({ ...item, diseaseGrade: grade, gradeChangedAt: changedAt })));
              await reconcileArchivedBridges();
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '批量改等级失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 支座：批量升级一级（跳过已严重者；升级者登记变更时间并撤销不再合格的归档） */
  readonly bulkEscalate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(bearingActions.bulkEscalate),
        switchMap(({ ids }) =>
          from(
            (async () => {
              const rows = (await listBearings())
                .filter((item) => ids.includes(item.id))
                .filter((item) => escalateGrade(item.diseaseGrade) !== item.diseaseGrade);
              if (rows.length === 0) return;
              const changedAt = nowDateTime();
              await putBearings(
                rows.map((item) => ({
                  ...item,
                  diseaseGrade: escalateGrade(item.diseaseGrade),
                  gradeChangedAt: changedAt,
                })),
              );
              await reconcileArchivedBridges();
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '批量升级失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 顶升步骤：新建（自动排到末尾） */
  readonly createStep$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(stepActions.createStep),
        switchMap(({ draft }) =>
          from(
            (async () => {
              const existing = (await listSteps()).filter((item) => item.bridgeId === draft.bridgeId);
              const seq = existing.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
              await putStep({
                id: newId('step'),
                bridgeId: draft.bridgeId,
                seq,
                targetLiftMm: draft.targetLiftMm,
                syncRequirement: draft.syncRequirement,
                limitMm: draft.limitMm,
                leader: draft.leader.trim(),
                state: 'idle',
                ...rowMeta(),
              });
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '新建顶升步骤失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 顶升步骤：更新 */
  readonly updateStep$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(stepActions.updateStep),
        switchMap(({ id, draft }) =>
          from(
            (async () => {
              const existing = (await listSteps()).find((item) => item.id === id);
              if (!existing) return;
              await putStep({
                ...existing,
                bridgeId: draft.bridgeId,
                targetLiftMm: draft.targetLiftMm,
                syncRequirement: draft.syncRequirement,
                limitMm: draft.limitMm,
                leader: draft.leader.trim(),
              });
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '更新顶升步骤失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 顶升步骤：删除 */
  readonly deleteStep$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(stepActions.deleteStep),
        switchMap(({ id }) =>
          from(removeStep(id)).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '删除顶升步骤失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 顶升步骤：调整顺序 */
  readonly reorderSteps$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(stepActions.reorderSteps),
        switchMap(({ orderedIds }) =>
          from(
            (async () => {
              const rows = await listSteps();
              const hasAll = orderedIds.every((id) => rows.some((item) => item.id === id));
              if (!hasAll) return;
              await putSteps(resequenceSteps(rows, orderedIds));
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '调整顺序失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 顶升步骤：推进状态 */
  readonly advanceStep$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(stepActions.advanceState),
        switchMap(({ id, next }) =>
          from(
            (async () => {
              const existing = (await listSteps()).find((item) => item.id === id);
              if (!existing) return;
              await putStep({ ...existing, state: next });
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '推进步骤状态失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 验收：新建 */
  readonly createAcceptance$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(acceptanceActions.createAcceptance),
        switchMap(({ draft }) =>
          from(
            putAcceptance({
              id: newId('acc'),
              bearingId: draft.bearingId,
              stage: draft.stage,
              conclusion: draft.conclusion,
              acceptor: draft.acceptor.trim(),
              acceptedAt: draft.acceptedAt,
              ...rowMeta(),
            }),
          ).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '签署验收失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 验收：更新 */
  readonly updateAcceptance$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(acceptanceActions.updateAcceptance),
        switchMap(({ id, draft }) =>
          from(
            (async () => {
              const existing = (await listAcceptances()).find((item) => item.id === id);
              if (!existing) return;
              await putAcceptance({
                ...existing,
                bearingId: draft.bearingId,
                stage: draft.stage,
                conclusion: draft.conclusion,
                acceptor: draft.acceptor.trim(),
                acceptedAt: draft.acceptedAt,
              });
              await reconcileArchivedBridges();
              this.idb.emitChange();
            })(),
          ).pipe(
            map(() => writeSucceeded({ message: '数据已保存' })),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '更新验收记录失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 验收：删除 */
  readonly deleteAcceptance$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(acceptanceActions.deleteAcceptance),
        switchMap(({ id }) =>
          from(
            (async () => {
              await removeAcceptance(id);
              await reconcileArchivedBridges();
            })(),
          ).pipe(
            map(() => {
              this.idb.emitChange();
              return writeSucceeded({ message: '数据已保存' });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '删除验收记录失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /**
   * 验收：批量分步签署，并在全部合格时回传归档摘要。
   * 顺序约束：必须按「顶升到位 → 支座就位 → 落梁 → 竣工」签署，前置分步须已有
   * 当前有效的合格记录；调级后旧验收失效，须从第一步重新签起，不可跳步。
   * 不满足前置条件的支座自动跳过，跳过信息回传给页面提示。
   */
  readonly bulkSign$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(acceptanceActions.bulkSign),
        switchMap(({ bearingIds, draft }) =>
          from(
            (async () => {
              if (bearingIds.length === 0) return { summary: '', skipped: 0 };
              const bearings = await listBearings();
              const allAcceptances = await listAcceptances();
              const eligibleIds = bearingIds.filter((bearingId) => {
                const gradeChangedAt =
                  bearings.find((item) => item.id === bearingId)?.gradeChangedAt ?? null;
                const current = currentAcceptancesOf(
                  allAcceptances.filter((item) => item.bearingId === bearingId),
                  gradeChangedAt,
                );
                const passedStages = current
                  .filter((item) => item.conclusion === 'pass')
                  .map((item) => item.stage);
                return canSignStage(draft.stage, passedStages);
              });
              if (eligibleIds.length === 0) {
                return { summary: '', skipped: bearingIds.length };
              }
              const rows: AcceptanceRow[] = eligibleIds.map((bearingId) => ({
                id: newId('acc'),
                bearingId,
                stage: draft.stage,
                conclusion: draft.conclusion,
                acceptor: draft.acceptor.trim(),
                acceptedAt: draft.acceptedAt,
                ...rowMeta(),
              }));
              await Promise.all(rows.map((row) => putAcceptance(row)));
              await reconcileArchivedBridges();
              const check = await checkBridgeArchived();
              this.idb.emitChange();
              return { summary: check.summaries.join('；'), skipped: bearingIds.length - eligibleIds.length };
            })(),
          ).pipe(
            map(({ summary, skipped }) => {
              const skipText =
                skipped > 0 ? `${skipped} 个支座前序分步尚未有效验收，已跳过；` : '';
              return acceptanceActions.archiveResult({
                summary: summary
                  ? `${skipText}已满足归档条件：${summary}`
                  : `${skipText}本批次签署完成，尚不满足竣工归档条件`,
              });
            }),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '批量签署失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );

  /** 归档：写回桥梁 archived 标记；归档前强制复核有效验收，不满足条件一律拒绝 */
  readonly archiveAcceptance$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(acceptanceActions.archiveBridge),
        switchMap(({ bridgeId, archived, summary }) =>
          from(
            (async () => {
              const existing = (await listBridges()).find((item) => item.id === bridgeId);
              if (!existing) {
                return acceptanceActions.archiveResult({ summary: '桥梁不存在，归档失败' });
              }
              if (archived) {
                const check = await checkBridgeArchived();
                if (!check.archivableBridgeIds.includes(bridgeId)) {
                  return acceptanceActions.archiveResult({
                    summary: '归档复核未通过：存在调级后未按四步复验合格的支座，不能归档',
                  });
                }
              }
              await putBridge({ ...existing, archived });
              this.idb.emitChange();
              return acceptanceActions.archiveResult({ summary });
            })(),
          ).pipe(
            map((action) => action),
            catchError((error: unknown) =>
              from([
                writeFailed({ message: error instanceof Error ? error.message : '归档失败' }),
              ]),
            ),
          ),
        ),
      ),
    { dispatch: true },
  );
}
