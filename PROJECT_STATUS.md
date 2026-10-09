# 店界 POI 项目状态

> 更新日期：2026-10-09。本文是当前接手入口；`README.md` 含早期 Python/SQLite 原型说明，正式环境以本文、`package.json`、`docker-compose.yml` 和实际代码为准。

## 2026-10-09 品牌门店统一筛选发布版

- 本发布源码以此前线上 `09dae8f` 为基线，包含下方记录的 POI 明细筛选、标签待核验筛选、爱零食历史阶段规则和最终 13 品牌统一规则。下方“仅本地／未发布”描述是各阶段记录，以本节的发布状态为准。
- 发布前生产只读预估确认 59,444 条原始记录均保留；最终规则将不符合自动接受条件的记录移入待核验或已排除候选，不物理删除。来优品完整名称兼容“来优品品牌零食”“来优品零食乐园”；此前用户确认的 8 家零食有鸣批发超市均判为接受。
- “地图万事通”仍严格留在本地工作区：本发布源码不含前端入口、助手 API、助手模块或构建资源。后续只有用户明确要求才发布。

## 2026-10-09 13品牌统一名称与业态初筛（仅本地，优先于下方旧规则）

- 用户最新确认：所有预设品牌统一保留符合零食／超市／购物分类证据的门店，爱零食也允许超市、便利店，不再执行品牌库原先的超市排除例外。按品牌关键词搜索后做完整名称与业态双重初筛；名称本身的“零食”不能代替高德标签。购物分类06开头的编码、分类文本或商业标签可作为正向证据；明确蛋糕/餐馆/仓库主体排除，名称不明确、缺标签或证据冲突保留待核验。括号内地标不当作业态，8家用户确认的零食有鸣批发超市回归通过。
- 13个预设品牌使用独立确认的品牌主体，允许列举的零售业态后缀和非空“××店”分店括号；不再以任意包含品牌词作为接受条件。新增赵一鸣省钱超市主体。旧好像来等名称仍兼容历史品牌归一和单店地址解析，但不在品牌发现中自动视为已确认名称。无法找到一手资料的品牌仅采用用户确认的主体名，不虚构官方POI命名规则；这些正则是应用初筛政策，不是品牌认证或完整官方门店名册。
- 新增 shared/brand-store-policy.ts、server/brand-store-policy-sql.ts、014_brand_store_policy.sql。发现结果按POI ID去重，所有判断保留入库，默认列表、地图候选、查询数量和看板只计接受；其他候选在原门店库“待核验（名称／标签）”“已排除候选”筛选，支持分页、跨页选择和导出。城市筛选选项包含候选所在城市，表格增加高德分类和判断原因。
- POI白/黑名单管理扩展到所有品牌，接口 /api/admin/brand-library/poi-reviews；兼容保留内部 ailingshi_poi_overrides 表及字段，不新建品牌页面。人工确认名称不能跳过标签门槛；管理员权限、租户隔离、审计和刷新保持名单均已验证。原始记录不删除，不执行旧清理脚本。
- 本地014应用前备份 backups/local-pre-brand-policy-20261009.dump，已验证可读取。161项单元测试、类型检查、生产构建以及8项相关数据库集成测试通过（含新增468组与原960组证据一致性）；6万条测试记录普通分页约11–194ms，6000条待核验筛选约13–38ms。HTTP验证接受5/待核验2/排除2，六组筛选与勾选导出一致，人工确认及看板5→6→5。浏览器验证筛选与核验弹窗，截图 .tmp/brand-policy-pending.png 为临时测试数据。
- 9条临时门店、名单和相关审计已清理，本地恢复原有0条。7090、API/Worker更新完成；未推送或部署，生产数据未更改。地图万事通继续仅本地，后续发布仍排除。
- 核对资料：[高德搜索2.0分类与标签字段](https://developer.amap.com/api/webservice/guide/api/newpoisearch)、[高德分类编码下载](https://developer.amap.com/api/webservice/download)、[好想来品牌介绍](https://www.hxl88.com/about)、[来优品省钱超市官方公告](https://www.laiyoupin.cn/news/20/488.html)、[赵一鸣官方发展历程](https://www.zymls.com/about.html)、[来伊份官网](https://www.laiyifen.com/company)。集团旗下品牌仍按用户所选13个品牌分别统计。

## 2026-10-09 爱零食严格名称初筛（历史阶段，品牌库规则已由上方统一规则替代）

- 用户明确要求这是爱零食的搜索规则，不新增品牌专属页面。仍以“爱零食”作为唯一搜索关键词，忽略该品牌扩展别名；先排除相似名称及超市/便利店等非目标业态，再完整匹配指定名称结构，其他结果待核实。原始名称保留，另存NFKC标准化名称；同POI ID去重。规则只作名称初筛，不声称验证品牌归属或搜齐全部门店。
- 默认门店库、地图查询结果、看板、任务门店数量只使用接受结果。待核实和排除候选保留原始资料，在原品牌门店库的核验状态下拉框内选择“名称待核实”或“名称已排除”查看；原名称、标准化名称、POI ID、地址、判断和原因可展示/导出。缺POI ID只能待核实，缺坐标保留为空且不可直接分析。
- 管理员在原门店表格中“确认纳入/确认排除”，填写依据后按租户+POI ID保存白/黑名单，可恢复名称规则。刷新不会覆盖人工结论；审计、名单变更、可见性及看板失效在同一事务中处理。普通成员禁止操作。
- 新增shared/ailingshi.ts、server/ailingshi-sql.ts、server/ailingshi-review.ts、013_ailingshi_review.sql及对应测试；搜索、入库和导出均接入。其余品牌保留既有规则。013应用前本地备份backups/local-pre-ailingshi-20261009.dump已验证可读；生产尚未应用013。
- 156项单元测试、7项相关PostgreSQL集成测试、类型检查与生产构建通过；真实HTTP验证5条接受/3条待核实/7条排除、人工确认统计5→6→5、按POI名单持久化、跨页ID及六字段导出一致。浏览器实测统一筛选、行内确认和恢复规则；截图.tmp/ailingshi-library-filter.png为临时测试数据。
- 本地7090与API/Worker已更新，未推送或部署；正式仍09dae8f，地图万事通继续仅本地。15条临时门店、对应临时名单和审计记录测试后清理，本地库恢复原有0条。

## 2026-10-09 蛋糕店排除与标签待核验筛选（仅本地）

- 品牌门店库新增“门店核验状态”下拉框：全部核验状态、标签待核验、标签已核验；可与品牌、省市、关键词等联合筛选，分页、跨页全选和导出使用同一筛选条件，切换核验状态时清空旧选择。
- 名称主体、分类或商业标签明确包含蛋糕/糕饼/西饼，且没有零食、超市、日杂店证据的记录从品牌库结果排除；蛋糕与零食/超市证据冲突时保留待核验，括号内分店地标不作名称排除证据。原有标签缺失保留规则、日杂店/综合超市规则及用户确认的8家零食有鸣门店继续保留。
- 新增012_brand_store_review.sql，更新library_visible生成表达式，增加needs_review生成列与筛选索引，同时更新区域缓存数量、使看板快照失效。原始记录保留，不执行历史清理脚本；已有门店和新增门店使用同一规则。后续发布需应用012迁移再运行新版API/Worker。
- 本地迁移前备份backups/local-pre-snack-review-20261009.dump；152项单元测试、6项PostgreSQL集成测试、类型检查与生产构建通过。960组证据组合的SQL与应用规则一致；6万条测试记录中筛选6000条待核验，首页和翻页数据库计时约7–22ms。
- 本地真实HTTP及浏览器验证待核验53条、已核验10条、蛋糕排除3条，分页50+3、跨页全选53条及导出53条一致。66条临时门店和测试导出已清理，本地品牌库恢复原有0条，看板缓存重新汇总。效果截图.tmp/snack-review/pending-filter.png中的数量仅为临时测试数据。
- 本地7090及Docker API/Worker已更新；尚未推送或部署，正式版本仍09dae8f，生产数据未改动。保留周边POI功能和地图万事通的全部本地改动，地图万事通后续发布仍须排除。

## 2026-10-09 周边 POI 点击详情与分类筛选（仅本地）

- 单店分析和任务内单店报告的地图、POI明细统一增加分类下拉框（系统16类及历史自定义类别）、名称/地址/关键词搜索、距离筛选、数量提示及重置。保留地图原有多分类图例和全选/清空；0结果类别仍可选择并明确提示本次任务没有对应数据。
- 地图标记和明细名称可以点击打开详情，显示当前任务已保存的名称、地址、原始高德分类、直线距离、评分、可用联系方式/消费/品牌及POI编号；真实POI提供高德详情入口。缺失数据明确标注，不额外调用高德或伪造信息。
- 新增 app/PoiExplorer.tsx、app/poi-explorer.ts、app/poi-explorer.css、tests/poi-explorer.test.ts；app/page.tsx集成两处明细和共用地图，保留地图万事通及既有改动。仅前端修改，不涉及生产数据库或后台接口。
- 149项单元测试、类型检查、生产构建通过；本地已有任务4的73条POI实测小学筛选为1条，地图点击、明细名称点击、分类与关键词联合筛选、距离、重置和零结果提示正常。未添加或删除测试数据。
- 截图 .tmp/poi-explorer/map-school-detail.png、table-school-detail.png；修改前页面备份 .tmp/poi-explorer/page.tsx。本地7090已更新；尚未推送或发布，正式版本仍09dae8f。

## 2026-10-09 门店看板及管理员删除已发布

- GitHub main 与生产版本：09dae8f5d2992c38792316d213b6eeb025aec293；生产目录 /opt/choose-store-dashboard-20261009；独立发布源码 .tmp/poi-release/release-dashboard-20261009。本地主工作区未被覆盖，地图万事通及其集成仍仅本地，生产源码和资源均排除。
- 010、011迁移已在同一事务应用。完整备份 /opt/choose-store-dashboard-20261009/backups/predeploy-dashboard-20261009.dump，已验证可读取；旧目录 /opt/choose-store-library-performance-20261009 与镜像标签 pre-dashboard-20261009 保留供回滚。
- 发布版124项单元测试、类型检查、生产构建通过。线上首页/健康、管理员/成员/匿名权限、地图资源、看板逐省逐品牌统计与真实队列执行均通过；每日北京时间02:00日程已注册，下次更新时间2026-10-10 02:00。
- 部署前后原始记录59,444条、可见门店58,170家（14个品牌），未删除生产门店；保留规则差异0条、指定8家门店均在、任务151仍暂停。分页查询本次抽查第1/58/1000页约65/36/75ms（服务端计时）。
- 入口：品牌门店库 → 门店看板；管理员可在品牌库单条/批量删除并到“已删除门店”恢复。发布回执 .tmp/poi-release/DASHBOARD_RELEASE_RECEIPT.json。

## 2026-10-09 门店数量看板（已发布）

- 品牌门店库新增“门店看板”页签，参考用户网站 https://storemap.zhekou.zirancuishipin.com/ 的全国数量、省级热力地图和各省品牌结构；支持品牌/省份多选、清空、图例联动、省份明细跳转及高清 PNG/展开长图导出。用户确认本次不加入合作状态看板。
- 数据源为当前租户的 brand_stores；每家有效门店计1家，包含待核验门店，排除 library_visible=false 与 deleted_at 非空记录。与旧参考站点的“品牌/省份数量汇总表取最新”口径不同，不读取飞书或参考站点数据。未识别省份仍计入总数并独立提示。
- 011迁移新增 brand_dashboard_snapshots。BullMQ 持久日程 brand-library-dashboard-refresh，每日 Asia/Shanghai 02:00 更新；Worker 启动补齐过期统计，首次访问/过期访问自动汇总，管理员可立即更新。失败保留最近成功快照并提示。删除/恢复会在同一事务内使看板缓存失效。
- 新增 shared/brand-dashboard.ts、server/brand-dashboard.ts、app/BrandDashboard.tsx、app/brand-dashboard-charts.ts、app/brand-dashboard.css、public/maps/china-provinces.geojson。地图边界来自参考站点并本地打包；ECharts 6.0.0、html2canvas 1.4.1 按需加载。Docker API/Worker 需复制 shared 目录。
- 本地迁移前备份 backups/local-pre-store-dashboard-20261009.dump。验证：146项单元测试、4项相关 PostgreSQL 集成测试、类型检查与生产构建通过；真实HTTP验证登录/管理员权限与自动任务执行，浏览器验证空库、刷新、筛选、跳转数量一致和PNG导出。
- 浏览器测试使用的1,555条临时门店已清理，本地门店库恢复原有0条状态；看板缓存也已重新汇总为0。测试效果截图 .tmp/store-dashboard/dashboard-preview.png，长图 .tmp/store-dashboard/dashboard-long-export.png。
- 此功能与管理员删除功能已发布为09dae8f，详见上方发布记录。后续发布继续排除本地地图万事通及其集成改动。

## 2026-10-09 管理员品牌门店删除（已发布）

- 品牌库新增管理员单条删除、勾选跨页批量删除、原因确认及“已删除门店”查询/恢复。普通成员没有入口，服务端也强制管理员权限及租户隔离。
- 010迁移增加删除标记和归档历史；保存删除前完整快照、原因、操作人、时间及恢复日志。门店原记录保留，高德刷新不会重建或更新已删除记录；历史分析报告保留。
- 列表、筛选选项、跨页ID、查询任务结果、新建反查及新生成导出统一排除已删除门店。新建反查在事务内锁定有效门店，避免与删除操作竞态。
- 验证：142项单元测试、11项数据库集成测试、12项真实HTTP检查、类型检查和生产构建通过；浏览器实测单条删除、取消确认、恢复、批量删除及选中状态更新通过，临时测试数据已清理。
- 本地数据库迁移前备份 backups/local-pre-admin-removal-20261009.dump。仅测试临时门店，不直接删除用户截图中的正式数据；地图万事通继续仅本地。

## 2026-10-09 品牌库性能优化已发布

- GitHub main 提交 d245a72，生产目录 /opt/choose-store-library-performance-20261009；前版 /opt/choose-store-cache-concurrency-20261008 及镜像标签 pre-library-performance-20261009 保留用于回退。
- 009 迁移已应用；生成列保存同一保留规则，分页先取 ID 再取本页详情。前端减少重复筛选请求并增加加载/错误/空结果提示。生产源码、API与前端资源均核验没有本地地图模块。
- 生产真实数据查询：首屏 3290→154 ms，第58页 3573→74 ms，第1000页 4774→299 ms；为后端查询计时，不含浏览器/网络耗时。
- 部署前后均有59,444条记录，当前规则下可见58,170家；保留规则计算差异0条，用户确认8家门店均在；任务151仍暂停，队列基线active/waiting/delayed均为0。
- 发布版118项单元测试、类型检查和构建通过；线上首页、健康、认证保护检查通过。部署前完整备份 /opt/choose-store-library-performance-20261009/backups/predeploy-library-performance-20261009.dump，已确认归档可读取。
- 本地主工作区与未发布的地图万事通继续保留。本地库仍独立、未同步生产门店数据。
## 2026-10-08 缓存与企业许可并发修复

- 已上传 main 提交54f2d66并部署至 /opt/choose-store-cache-concurrency-20261008；旧版本 /opt/choose-store-release-20261008 可回退。
- 之前清理统一设置缓存 complete=FALSE，加上新代码强制 filter_version=3，导致有效缓存被跳过。已修复：30天内同租户/城市/品牌缓存可复用，不完整缓存提示部分结果，旧好想来品牌名兼容；过期/缺失/强制刷新仍查询。清理脚本不再全量重置完整性。
- 生产和本地环境均配置 AMAP_MAX_QPS=80、BRAND_DISCOVERY_CONCURRENCY=8、POI_CATEGORY_CONCURRENCY=4；API/Worker通过Redis共享速率预算。用户提供的企业许可搜索上限100 QPS；默认模板仍10/1/1。
- 118项单元测试、9项数据库/Redis集成测试、类型检查与构建通过。生产使用真实百色市零食有鸣旧版不完整缓存验证，缓存命中1、高德调用0；临时验证事务已回滚。首页、API健康与登录保护检查通过。
- 任务151由用户暂停，已保持暂停，未自动恢复；部署核验时api_calls=1235。地图智能体继续仅保留本地，未加入发布代码。

## 2026-10-08 发布与本地开发

- 已上传 GitHub main 提交 ff43645，并部署至 /opt/choose-store-release-20261008。生产域名 https://choose.zhekou.zirancuishipin.com/，首页、健康检查、认证保护及评分/电话/核验字段导出验证通过。
- 本次 59,330 条历史记录全部核验；保留 59,135 条（其中 6,792 条待核验），195 条明确无关地点已归档后移除。目标品牌的日杂店、综合超市、标签缺失或分类冲突记录保留。清理运行号 snack-brands-20261008-v5；备份 /opt/choose-store-95babbe/backups/predeploy-20261008-snack-cleanup.dump。
- 地图万事通（原地图智能体）仅保留本地工作区，备份 backups/map-agent-local-20261008.zip；未包含在上传源码、生产接口和前端资源中。独立发布源码位于 .tmp/poi-release/release-20261008；本地主工作区的地图万事通及集成改动仍保留，后续发布继续显式排除此模块。
- 发布版 114 项单元测试通过，类型检查及生产构建通过。

## 2026-10-08 本地品牌库筛选性能修复

- 本地 7090 接入 Docker PostgreSQL；该库的 brand_stores 当前为 0 条，与生产品牌库独立。全选不会自动同步生产数据；页面已增加加载、超时/失败重试和空数据提示。
- 筛选/翻页原先重复执行全库正则保留判断并排序。新增 009_brand_library_browse.sql：用生成列 library_visible 保存同一保留规则，建立分页与已分析记录索引；先分页取 ID，再读取本页详细信息。没有删除任何门店。
- 前端用稳定查询字符串避免等价“全选/不限”重复请求，取消过时请求，筛选变化回到第一页，翻页期间提供加载反馈。
- 6 万条临时数据：首屏约 20 ms，第 58 页约 16 ms，第 1000 页约 126 ms；修复前约 1189/1286/1466 ms。含真实 PostgreSQL、保留规则一致性及用户确认 8 家门店回归，临时数据全部回滚。
- 140 项单元测试、类型检查、前端构建及 2 项 PostgreSQL 集成检查通过。本地迁移已应用；数据库变更前备份 backups/local-pre-library-performance-20261008.dump。
- 修复仅在本地生效，生产未更新。后续发布需要先应用 009 迁移；继续排除地图万事通及集成代码。
## 1. 项目目标

为儿童健康饮品线下活动筛选合适的渠道门店：搜索或批量导入门店，匹配高德 POI，分析周边家庭客群环境，并导出可执行报告。产品定位必须是“儿童健康饮品”，已知卖点仅为“清热下火、口感好喝”；不得把产品写成零食，也不得把 POI 推断描述为真实人口、客流、收入或医学结论。

## 2. 已完成内容

- 单门店：门店名称搜索、仅详细地址定位、候选评分与人工确认、周边 POI、多半径统计、商圈/潜在人群规则画像、AI 分析。
- 地图与证据：POI 分类标签支持全选/取消全选；新增“现场照片”页签，照片只取当前高德门店 POI，缺图不使用其他门店图片代替。
- 批量导入：支持 XLSX/XLS/CSV；结合表头与前 10 条有效数据识别门店名、地址等字段，允许人工改映射；门店名或详细地址任一存在即可处理。
- 批量任务与导出：后台队列、暂停/继续/失败重试、任务隔离、多工作表 Excel、字段筛选、公式注入防护、AI 批量导出。
- 独立“品牌门店库”：按省、市和多品牌后台检索，缓存、分页、任务进度、跨页筛选与选择、字段化 Excel 导出；可按多个 POI 条件（且/或）反查门店。已取消全国入口。
- 品牌检索是“高德当前可检索到的有效品牌 POI”，不是品牌总部官方全量名册；受高德分页、检索覆盖和每日额度限制。
- 登录与权限：邮箱密码登录、多租户/账号任务隔离、管理员账号管理；已实现企业微信自建应用扫码/OAuth 登录及自动绑定/建号。
- 正式部署：生产运行代码对应 GitHub 提交 `1733dc5`（`fix: serialize store match candidates as JSON`），生产目录 `/opt/choose-store-1733dc5`；域名 `https://choose.zhekou.zirancuishipin.com/`，服务器 `47.122.104.65`。API、Web、Worker、Nginx、PostgreSQL、Redis、Backup 容器均在运行，健康接口正常。

## 3. 关键技术决策

- 当前正式架构：React 19 + TypeScript + Vinext 前端；Express API；BullMQ/Redis 后台任务；PostgreSQL 17；Nginx；Docker Compose。`backend/` 下 Python/FastAPI/SQLite 是较早实现，不是当前正式服务器主链路。
- 高德 Web 服务 Key 只在后端；JS Key/安全码用于浏览器地图。坐标统一为 GCJ-02。关键词查询分页去重，但不得承诺高德结果等于品牌官方全量。
- 任务数据按 `tenant_id + created_by` 隔离；管理员的账号管理权限不自动等于查看全部业务任务。
- 企业微信以 `CorpID + userid` 为唯一身份：优先按企业邮箱绑定同租户现有账号，否则创建随机密码的成员账号。Secret 只存生产环境文件，不进入前端、Git、日志或本文。
- 企业微信登录依赖应用“可见范围”；不在范围内的成员不能授权登录。OAuth state 存 Redis，单次有效 5 分钟。
- 数据库变更使用 `server/migrations/*.sql`，由 `migrate` Compose 服务执行；现有迁移为 `001`–`007`。
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
