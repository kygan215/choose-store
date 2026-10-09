# 店界 POI 项目状态

> 更新日期：2026-10-08。本文是当前接手入口；`README.md` 含早期 Python/SQLite 原型说明，正式环境以本文、`package.json`、`docker-compose.yml` 和实际代码为准。

## 2026-10-08 缓存与企业许可并发修复

普通查询复用同租户、同城市/品牌的30天内缓存，含旧过滤版本和不完整结果；旧“好想来零食”缓存可供“好想来”使用。部分缓存明确提示不等于全量；过期、缺失或强制刷新仍调用高德。清理脚本不再将全部缓存标成不完整。任务151保持用户暂停状态。

企业许可控制台已确认搜索类上限100 QPS；生产配置 AMAP_MAX_QPS=80、BRAND_DISCOVERY_CONCURRENCY=8、POI_CATEGORY_CONCURRENCY=4。API及Worker使用Redis共享速率预算，品牌任务并行计数使用数据库累加，暂停后不派发新单元；同分类分页仍顺序执行。默认配置保持10/1/1，其他账号需按各自许可配置。生产发布目录 /opt/choose-store-cache-concurrency-20261008，前一版为 /opt/choose-store-release-20261008。

验证：118项单元测试、9项PostgreSQL/Redis集成测试、类型检查和构建通过。集成测试使用临时表并回滚，不调用高德；配置 DATABASE_URL 和 REDIS_URL 后运行 npm run test:integration。

## 2026-10-08 发布范围

本次发布包含全国品牌查询、品牌名单修正、高德标签与目标品牌联合核验、门店评分/电话显示与可选导出、搜索表单布局以及多选全选/清空。地图智能体仍在本地开发，发布源码、前端资源和接口均不包含该模块。

历史品牌门店通过 tools/reconcile-snack-library.ts 按高德 POI ID 重新核验。--audit 可断点续跑且不删除门店；--apply 仅在全部记录已核验且未发生并发修改时执行，先将待移除记录和历史分析关联保存到 maintenance_snack_removed，再从 brand_stores 移除。API/网络错误不会被当作非零食门店处理。发布前保留完整 PostgreSQL 备份。用户确认：目标品牌的日杂店／综合超市门店保留；标签或详情不足的门店保留待核验（界面及可选导出字段显示“标签核验”）；仅明确酱卤、餐饮等无关证据允许清理。旧版无零食标签即移除的审计决定作废，v5 审计复用详情但重新判定。大类与商业标签冲突的目标门店也保留待核验；例如高德大类写中餐厅、keytag 写零食时，不允许自动删除。

历史库 59,330 条已全部回查：保留 59,135 条，包含 6,792 条待核验；移除 195 条明确无关地点并归档。58,941 条返回详情的保留记录已同步高德商业标签、评分与电话，其余 194 条没有详情的记录原样保留。完整备份位于 `/opt/choose-store-95babbe/backups/predeploy-20261008-snack-cleanup.dump`，清理归档表为 `maintenance_snack_removed`，审计运行号 `snack-brands-20261008-v5`。

发布验证：114 项单元测试通过，TypeScript 类型检查和生产构建通过；发布源码和构建资源均未包含地图智能体入口、接口或模块。

## 1. 项目目标

为儿童健康饮品线下活动筛选合适的渠道门店：搜索或批量导入门店，匹配高德 POI，分析周边家庭客群环境，并导出可执行报告。产品定位必须是“儿童健康饮品”，已知卖点仅为“清热下火、口感好喝”；不得把产品写成零食，也不得把 POI 推断描述为真实人口、客流、收入或医学结论。

## 2. 已完成内容

- 单门店：门店名称搜索、仅详细地址定位、候选评分与人工确认、周边 POI、多半径统计、商圈/潜在人群规则画像、AI 分析。
- 地图与证据：POI 分类标签支持全选/取消全选；新增“现场照片”页签，照片只取当前高德门店 POI，缺图不使用其他门店图片代替。
- 批量导入：支持 XLSX/XLS/CSV；结合表头与前 10 条有效数据识别门店名、地址等字段，允许人工改映射；门店名或详细地址任一存在即可处理。
- 批量任务与导出：后台队列、暂停/继续/失败重试、任务隔离、多工作表 Excel、字段筛选、公式注入防护、AI 批量导出。
- 独立“品牌门店库”：按省、市和多品牌后台检索，缓存、分页、任务进度、跨页筛选与选择、字段化 Excel 导出；可按多个 POI 条件（且/或）反查门店。支持全国入口。
- 品牌检索是“高德当前可检索到的有效品牌 POI”，不是品牌总部官方全量名册；受高德分页、检索覆盖和每日额度限制。
- 登录与权限：邮箱密码登录、多租户/账号任务隔离、管理员账号管理；已实现企业微信自建应用扫码/OAuth 登录及自动绑定/建号。
- 正式部署：本次生产发布目录 `/opt/choose-store-release-20261008`，提交号保存在该目录 `RELEASE_COMMIT`，上一个可回退版本目录 `/opt/choose-store-95babbe`；域名 `https://choose.zhekou.zirancuishipin.com/`，服务器 `47.122.104.65`。API、Web、Worker、Nginx、PostgreSQL、Redis、Backup 容器均在运行，健康接口正常。

## 3. 关键技术决策

- 当前正式架构：React 19 + TypeScript + Vinext 前端；Express API；BullMQ/Redis 后台任务；PostgreSQL 17；Nginx；Docker Compose。`backend/` 下 Python/FastAPI/SQLite 是较早实现，不是当前正式服务器主链路。
- 高德 Web 服务 Key 只在后端；JS Key/安全码用于浏览器地图。坐标统一为 GCJ-02。关键词查询分页去重，但不得承诺高德结果等于品牌官方全量。
- 任务数据按 `tenant_id + created_by` 隔离；管理员的账号管理权限不自动等于查看全部业务任务。
- 企业微信以 `CorpID + userid` 为唯一身份：优先按企业邮箱绑定同租户现有账号，否则创建随机密码的成员账号。Secret 只存生产环境文件，不进入前端、Git、日志或本文。
- 企业微信登录依赖应用“可见范围”；不在范围内的成员不能授权登录。OAuth state 存 Redis，单次有效 5 分钟。
- 数据库变更使用 `server/migrations/*.sql`，由 `migrate` Compose 服务执行；现有迁移为 `001`–`008`。
- AI 文案统一使用“AI 活动摘要”等中性界面名称；提示词必须遵守 `CONTEXT.md` 的儿童健康饮品语言边界。

## 4. 修改过的重要文件

- `app/page.tsx`：主要 UI、单店/批量/品牌库/POI 反查/企业微信登录入口。
- `app/globals.css`：页面、品牌库、照片和登录样式。
- `server/index.ts`：API 路由、认证、任务、导入导出入口。
- `server/store-search.ts`：高德门店搜索、候选匹配、照片解析。
- `server/store-resolution.ts`、`server/import-reader.ts`：智能字段识别与门店定位。
- `server/store-match.ts`：将门店匹配候选显式序列化为合法 JSON 数据库参数。
- `server/brand-library.ts`、`server/worker.ts`：品牌库查询、筛选导出和后台任务。
- `server/activity-ai.ts`、`server/ai-export.ts`、`server/batch-export.ts`：AI 和 Excel 导出。
- `server/wecom-auth.ts`：企业微信授权 URL、令牌、成员信息及配置读取。
- `server/migrations/003_ai_activity_exports.sql` 至 `006_wecom_login.sql`：近期数据结构。
- `docker-compose.yml`、`Dockerfile`、`.env.production.example`：正式运行及企业微信环境变量。
- `public/WW_verify_6Hxer2SbcgdwQPTa.txt`：企业微信可信域名归属验证文件。
- `tests/*.test.ts`：当前 Node 主链路回归测试，尤其 `store-search`、`import-reader`、`brand-library`、`wecom-*`。

## 5. 当前问题和未完成任务

- **企业微信端到端登录已由服务端证实成功。** 2026-09-07 11:44（北京时间）核验：扫码后浏览器已跳回系统首页，近 10 分钟收到 2 次授权回调且无 HTTP 5xx；数据库已有 2 个企业微信绑定用户和 2 条 `login_wecom` 审计记录。
- 企业微信后台已配置可信域名、授权回调域、可信 IP 和应用可见范围；仍需确认应用主页/工作台入口指向 `https://choose.zhekou.zirancuishipin.com/api/auth/wecom/start`，测试成员必须在可见范围内。
- 服务器临时向导 `/root/configure-wecom.sh` 已于登录成功核验后删除并确认不存在；核验和删除过程未读取或输出 `.env.production` 和 Secret。
- 小批量回归已完成：2026-09-07 定向运行 `brand-library`、`import-reader`、`store-search`、`batch-export`、`export-validation`，45/45 通过；`npm run typecheck` 通过。真实界面用“湖北省武汉市武昌区中北路109号凯德1818”验证仅地址搜索，返回 21 个候选并要求人工确认；确认后完成 500 米、3 分类分析，共 27 个去重 POI，并显示当前门店的 3 张高德现场照片。
- 品牌库真实界面验证完成：最小后台任务 #17 为 2/2、100%，命中 1 个缓存单元并调用高德 26 次；任务结果可进入 POI 条件反查。随后只选 1 家已有分析记录的门店，任务 #56 为 1/1 成功，Excel 导出接口返回 HTTP 200；当日高德计数最终为 28/2000，未做全量分析。
- 烟雾测试发现的 `found_stores` 城市范围统计问题已在本地修正：任务进度和最终结果均按任务所选省/市/品牌计数，不再混入同省其他城市；已增加单城市、多城市和全省展开 3 类回归场景。
- 共享品牌门店数据已上线品牌、省份、城市三组多选筛选，可对组合结果执行跨页批量选择，并继续用于导出或 POI 条件反查；旧的单值接口参数保持兼容。“临时新品牌”已调整为“其余品牌”，由用户输入后直接启用并参与本次查询，不再等待管理员审核。
- 2026-09-07 发布前完整测试 77/77、`npm run typecheck`、生产构建均通过；源码定向 ESLint 为 0 错误、3 个既有非阻断警告。部署前数据库备份为 `/opt/choose-store-b907f70/backups/predeploy-3e9c598-a9f4.dump`，旧发布目录继续保留用于回滚；部署后 Compose 健康、登录保护、企业微信配置和外部 HTTPS 健康接口均通过。
- 任务 #59 的 347 家门店曾全部报 `invalid input syntax for type json`。根因是 `node-postgres` 会把直接传入的 JavaScript 候选数组编码为 PostgreSQL 数组文本，而 `match_candidates_json` 是 `jsonb`；批量匹配与人工重新搜索现已统一先做 JSON 序列化。修复后完整测试 78/78、类型检查和生产构建通过，生产冒烟门店 6108 成功写入候选，任务 #59 重试后 347/347 全部已确认、失败为 0。部署前备份为 `/opt/choose-store-3e9c598/backups/predeploy-1733dc5.dump`。
- 2026-09-09 高德额度排查确认并完成两阶段上线：先增加管理员调用监控与逐次归属日志，随后按业务确认取消全部个人上限、组织上限和 90% 保护线。系统仍按北京时间累计调用并同步用户、任务和查询内容，但任何内部累计值都不再暂停任务；高德平台自身返回的官方配额或限流错误仍照常展示。无限额版本完整测试 82/82、类型检查和生产构建通过；生产代码提交 `40ac52b`，发布目录 `/opt/choose-store-40ac52b`，部署前备份 `/opt/choose-store-b6f3d65/backups/predeploy-40ac52b.dump`。上线前当天的旧用量保留为未归属历史汇总，不强行写入个人审计日志。
- 本地工作树有多个用户自己的未跟踪目录/压缩包（`.tmp/`、PPT 依赖、`projects/`、归档包等）；不要清理、提交或覆盖。
- `README.md` 的启动部分仍偏向旧 Python 原型，后续应拆分“旧原型”和“当前正式版”说明。

## 6. 测试、启动、部署命令

### 当前 Node 主链路（本地）

本地需 Node.js 22+、PostgreSQL 和 Redis，并配置环境变量：

```powershell
npm install
npm run server:migrate
npm run server:api
npm run server:worker
npm run dev
```

API、Worker、前端应分别在终端运行。也可用完整 Compose 环境：

```powershell
Copy-Item .env.production.example .env.production
docker compose --env-file .env.production up -d --build
```

### 测试

```powershell
npm run typecheck
npm run test:unit
npm run build
# 完整组合
npm test
# 企业微信定向测试
node --import tsx --test tests/wecom-auth.test.ts tests/wecom-login-ui.test.ts tests/cloud-auth-route.test.ts
```

涉及真实高德时只抽查少量门店；优先运行无外部调用的单元测试。

### 正式服务器

SSH 使用本机专用密钥 `C:\Users\1\.ssh\choose_store_ed25519`，不要使用密码自动化：

```powershell
ssh -i C:\Users\1\.ssh\choose_store_ed25519 root@47.122.104.65
```

服务器上始终显式传入环境文件，避免 Compose 把变量当成空值：

```bash
cd /opt/choose-store-40ac52b
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 api worker
docker compose --env-file .env.production up -d --build
sh deploy/smoke-test.sh http://127.0.0.1:7090
curl -fsS http://127.0.0.1:7090/api/auth/wecom/config
```

不要直接打印 `.env.production`。部署前先备份数据库，确认目标目录和版本，再构建及迁移；生产变更完成后检查健康、日志、登录保护和少量核心流程。

## 7. 下一步建议

1. 更新 `README.md`，拆分“旧 Python 原型”和“当前正式版”的启动说明。
2. 为当前生产版本打 tag；后续继续采用新 release 目录发布，保留可回滚版本和数据库备份。

## 2026-10-09 品牌门店库性能发布

品牌库使用生成列保存已有保留规则，按索引分页取 ID 后加载本页详情；前端去除等价筛选的重复请求，并增加加载、失败重试及空结果说明。新增 009 迁移须先于新 API 应用。没有清理或删除门店。该发布不含本地地图助手。
