# 桥梁支座更换与顶升监测台（sologsb101-1005 / gbbridgebear）

## 一、Docker 一键启动（推荐）

```bash
cd sologsb101-1005
cp .env.example .env
docker compose up -d --build
```

启动后访问：**http://localhost:22805**

停止与清理：

```bash
docker compose down          # 停止并删除容器
docker compose up -d --build # 代码改动后重建
```

## 二、项目简介

面向桥梁养护项目的技术员与施工班组，按墩台编排支座更换作业，并在顶升过程中按测点逐级记录位移与应力，最后分步验收归档。

核心动作：

- 建立桥梁与墩台台账（跨径组合、桥型、建成年、公路等级、盖梁标高）
- 登记支座并按完好 / 轻微 / 较重 / 严重四级评定病害，较重及以上触发更换建议，支持批量调级与升级
- 编排分级顶升步骤（目标顶升量、同步要求、限位值、负责人），支持上移 / 下移调序与**累计顶升量校验**
- 按步骤批量录入多测点位移与应力，实时计算**同步偏差**（同批次极差）并按限位值给出告警
- 四步签署验收（顶升到位 → 支座就位 → 落梁 → 竣工），全部支座合格后可执行竣工归档
- **调级复验联动**：支座病害等级一旦变更（批量调级 / 升级 / 评级编辑），早于最近一次等级变更时间的验收签署立即失效，必须按四步顺序重新复验合格后才重新计入归档；失效记录保留并标记，仍可查询。等级未变或调级时未签过验收的支座不受影响
- 查看 IndexedDB 结构版本并导出 / 导入整库 JSON

本项目为**纯前端单页应用**：无后端、无数据库服务、无外部接口，全部数据保存在浏览器 IndexedDB。

## 三、技术栈

| 分类 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | Angular | 18.2 |
| 语言 | TypeScript | 5.5 |
| UI 组件库 | Angular Material + CDK | 18.2 |
| 响应式 | RxJS | 7.8 |
| 状态管理 | NgRx（@ngrx/store + effects + store-devtools） | 18.1 |
| 路由 | Angular Router（懒加载 + Hash 策略） | 18.2 |
| 本地持久化 | Dexie（IndexedDB） | 4.0 |
| 构建 | @angular-devkit/build-angular:application | 18.2 |
| 容器 | 多阶段构建 node:20-alpine → nginx:alpine | — |

## 四、路由一览

| 路由 | 页面组件 | 说明 |
| --- | --- | --- |
| `/bridges` | `BridgeListPage` | 建立桥梁与墩台台账，按桥型与建成年筛选 |
| `/bearings` | `BearingBoardPage` | 登记支座规格并评定病害等级，按等级批量处置 |
| `/steps` | `StepPlanPage` | 顶升步骤编排、顺序调整与累计顶升量校验 |
| `/readings` | `ReadingEntryPage` | 按步骤批量录入位移与应力，同步偏差与限位告警 |
| `/acceptances` | `AcceptanceArchivePage` | 四步签署、竣工归档与结构版本 JSON 导出 / 导入 |

> 路由定义在 `src/app/core/router/app.routes.ts`，使用默认的 `PathLocationStrategy`（history 模式），与 nginx 的 `try_files $uri $uri/ /index.html` 配合，直接访问上述深链接（含刷新）都能命中对应页面。

## 五、目录结构

```
sologsb101-1005/
├── README.md
├── docker-compose.yml                    # 顶层 name: gbbridgebear，无 version 字段
├── .env / .env.example                   # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── .gitignore
└── frontend/
    ├── Dockerfile                        # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf                        # try_files 前端路由回退 + gzip
    ├── .dockerignore
    ├── package.json / angular.json / tsconfig.json / tsconfig.app.json
    ├── public/favicon.svg
    └── src/
        ├── main.ts                       # bootstrapApplication(AppComponent, appConfig)
        ├── index.html
        ├── styles.scss                   # Angular Material 主题 + 全局样式
        └── app/
            ├── app.component.ts          # 应用外壳（工具栏 + 侧边导航 + 统计）
            ├── app.config.ts             # provideRouter / provideStore / provideEffects
            ├── core/
            │   ├── types/                # bridge.ts pier.ts bearing.ts step.ts reading.ts acceptance.ts persistence.ts
            │   ├── store/                # app.actions.ts notice.reducer.ts archive.helper.ts
            │   │                         # bridge.store/reducer/selectors、bearing.*、step.*、acceptance.*、app.effects.ts
            │   ├── services/             # idb-table.service.ts step-timeline.service.ts change-bus.service.ts
            │   ├── router/app.routes.ts
            │   └── utils/                # unit.ts tolerance.ts db.ts export.ts
            ├── shared/components/common/ # grade-tag / filter-bar / stat-badge / empty-panel
            └── features/
                ├── bridges/pages/bridge-list.page.ts
                ├── bearings/pages/bearing-board.page.ts
                ├── steps/pages/step-plan.page.ts
                ├── readings/pages/reading-entry.page.ts
                └── acceptances/pages/acceptance-archive.page.ts
```

## 六、数据存储说明

- **存储介质**：浏览器 IndexedDB，库名 **`gbbridgebear`**，通过 Dexie 4.x 封装。
- **数据结构版本**：`core/utils/db.ts` 中 `DB_SCHEMA_VERSION = 3`，登记 v1 → v2（补齐行修订号、迁移 `span → spanCombo`、`grade → diseaseGrade`、`syncType → syncRequirement`、`limit → limitMm`，新增 `settings` 表）与 v2 → v3（支座新增 `gradeChangedAt` 最近一次等级变更时间，索引不变；迁移不回填，缺省即视为从未调级，避免历史合格记录被误判失效）的 `upgrade` 迁移。
- **调级复验判定**：验收是否有效只取决于「签署时间是否严格晚于该支座最近一次等级变更时间（`Bearing.gradeChangedAt`）」，而不是当前等级——因此严重改回轻微后，旧合格记录不会复活。归档判定（`core/store/archive.helper.ts`）与验收页四步进度只统计有效记录；调级后重签必须按「顶升到位 → 支座就位 → 落梁 → 竣工」顺序，跳步签署会在页面预检与 effect 写入两处被拦截；失效记录保留在 `acceptances` 表中，列表以「失效（调级前签署）」标记并可查询 / 导出。
- **数据表**：

  | 表名 | 实体 | 主要索引 |
  | --- | --- | --- |
  | `bridges` | 桥梁 | id / name / bridgeType / builtYear / roadClass / archived |
  | `piers` | 墩台 | id / bridgeId / code / capElevation / [bridgeId+code] |
  | `bearings` | 支座 | id / pierId / diseaseGrade / type / serial / [pierId+serial]（另有 `gradeChangedAt` 最近调级时间，不建索引） |
  | `steps` | 顶升步骤 | id / bridgeId / seq / state / syncRequirement / [bridgeId+seq] |
  | `readings` | 测点读数 | id / stepId / pointCode / recordedAt / [stepId+pointCode] |
  | `acceptances` | 分步验收 | id / bearingId / stage / conclusion / [bearingId+stage] |
  | `settings` | 自定义字典 | id |

- **首屏自动播种**：`initDatabase()` 在 `bridges` 表为空时写入演示数据（幂等）——2 座桥梁 × 各 2~3 个墩台 × 各 2~3 个支座（四级病害各覆盖）+ 2~3 级顶升步骤 + 每级多测点读数 + 分步验收记录，父子记录通过 `bridgeId / pierId / bearingId / stepId` 互相引用。
- **跨页状态**：全部放在 NgRx store（`bridge / bearing / step / acceptance` + `notice` 提示），页面只通过 `select` 读 store、通过 `dispatch` 写；Dexie 写入后由 `ChangeBusService` 广播，`AppEffects` 重新加载全部表。
- **数据不出浏览器**：容器无状态，不挂载卷、不使用数据库服务。

## 七、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:22805（ng serve）
npm run typecheck  # tsc --noEmit -p tsconfig.app.json
npm run build      # ng build（含 Angular 模板类型检查与 TS 校验）
```

## 八、容器化细节

- `Dockerfile` 两阶段构建：`node:20-alpine` 安装依赖并执行 `npm run build`，随后把 `dist/gbbridgebear/browser` 拷贝到 `nginx:alpine` 的 `/usr/share/nginx/html`。
- 运行阶段在 COPY 之后执行 `RUN chmod -R a+rX /usr/share/nginx/html`，规避历史遗留的 favicon 权限 0600 导致 nginx 403 的问题。
- `nginx.conf` 使用 `try_files $uri $uri/ /index.html;` 支持前端路由直接刷新，并开启 gzip。
- `docker-compose.yml` 不写 `version:`，顶层 `name: gbbridgebear` 兜底（避免中文目录名导致项目名为空），服务名 `frontend`，容器名 `${COMPOSE_PROJECT_NAME:-gbbridgebear}-frontend`，端口 `${FRONTEND_PORT:-22805}:80`，`restart: unless-stopped`。
