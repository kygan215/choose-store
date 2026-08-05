# 门店周边 POI 搜索与分析平台

一个可本地运行、测试并继续扩展的中文企业级门店分析工作台。支持门店候选匹配与人工确认、POI 分类配置、周边搜索、距离分层、潜在人群环境画像、批量导入、任务记录和多工作表 Excel 导出。

## 技术栈

- 前端：React 19、TypeScript、Next/Vinext、CSS
- 后端：Python、FastAPI、SQLAlchemy、Pydantic、httpx
- 数据：SQLite（可通过 `DATABASE_URL` 切换 PostgreSQL）
- 表格：pandas、openpyxl
- 地图：高德 Web 服务 API 2.0；前端保留高德 JS API Key 配置

## 目录

- `app/`：前端页面与样式
- `backend/`：API、数据模型、高德客户端、业务算法与测试
- `data/`：SQLite 数据库
- `docs/业务使用说明.md`：非技术用户操作手册
- `.env.example`：完整环境变量模板

## 安装与启动

要求 Node.js 22+、Python 3.11+。

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m backend.migrate
npm install
```

分别打开两个终端：

```powershell
.\.venv\Scripts\python -m uvicorn backend.main:app --reload --port 8000
npm run dev
```

浏览器访问前端打印的地址（默认 `http://localhost:3000`），API 文档为 `http://127.0.0.1:8000/docs`。

## 高德 Key

在高德开放平台创建应用，并分别申请：

- `AMAP_WEB_SERVICE_KEY`：Web 服务 API Key，只供后端调用，绝不能放入前端或 Git。
- `NEXT_PUBLIC_AMAP_JS_KEY`：JavaScript API Key，供浏览器地图展示；需按高德要求配置域名白名单。
- `NEXT_PUBLIC_AMAP_SECURITY_CODE`：JS API 安全密钥。

复制 `.env.example` 为 `.env` 后填写。真实查询需同时设置：

```env
AMAP_WEB_SERVICE_KEY=你的Web服务Key
ENABLE_MOCK_AMAP=false
```

未配置 Key 或 `ENABLE_MOCK_AMAP=true` 时，系统明确标注“演示模式”，不会把 Mock 数据冒充真实结果。所有坐标为 GCJ-02；如果未来导入 WGS-84，必须先显式转换。

## 真实高德接口实现

后端使用官方 POI 2.0：

- 关键字搜索：`/v5/place/text`
- 周边搜索：`/v5/place/around`
- 单页 25 条、自动翻页、同请求最多 200 条
- 结果按 POI ID 去重；无 ID 时按名称、坐标、地址去重
- 关键词与 typecode 禁止同时为空
- 超时与网络错误有限重试；限流退避重试；Key 不写入日志
- 达到 200 条标记“可能截断”

## 导入、任务与导出

“批量导入”支持 `.xlsx`、`.xls`、`.csv`，自动识别常见中文表头别名，也允许在页面重新映射字段。系统预览前 20 行并标记空行和文件内重复门店，默认限制 5,000 行和 15 MB。门店名称或详细地址至少填写一项即可；仅有地址时会进入地址定位流程，低精度定位要求人工确认。模板从首页右上角或 `/api/import/template` 下载。

创建任务前可统一配置搜索半径、POI 分类以及是否生成智能画像。任务以每批最多 10 家的方式执行高德匹配，已完成进度会写入数据库；刷新页面或中途停止后可继续。高置信度候选自动确认，其他门店在任务页逐家选择候选位置；失败记录可单独重试，不会导致整个批次作废。

任务状态、候选门店、确认结果和分析结果持久化到 SQLite，页面刷新后不会丢失。任务页会显示匹配进度、待确认数、失败数，并支持继续匹配、候选确认、失败重试、智能画像对比和导出。普通导出包含“门店汇总、POI明细、待确认门店、失败记录、搜索配置”；生成商圈画像后还会追加“商圈汇总、商圈特征明细、潜在人群画像、商圈评分配置”。工作表冻结表头、启用筛选、设置列宽、保留数值距离和经纬度，所有危险公式前缀会被转义。

## 匹配、半径与地址定位

- 门店匹配总分为 100 分：名称 40、品牌 10、城市 15、区县 15、地址 10、POI 类型 5、唯一候选 5。候选卡片会展示逐项得分、冲突和扣分原因。
- 城市、区县和地址允许留空；留空不会被误判为冲突。行政区名称会去除“省、市、区、县”等常见后缀后比较，同时使用 `adcode` 辅助判断。
- 只有得分不低于 85、名称高度一致、城市一致且不存在硬冲突时才允许自动确认；分店序号、跨城市、品牌冲突会阻止自动确认。
- 默认 POI 仅勾选住宅小区、小学、幼儿园。半径支持 500 m、1 km、2 km 等预设和自定义值，最多 5 个、最大 50 km；超过 10 km 时前端会二次确认。
- 地址模式调用高德地理编码，保留原始地址、标准化地址、解析层级和定位来源。道路级或更低精度结果必须人工确认。

## 商圈画像

在门店完成周边 POI 分析后，可生成商圈画像。系统按住宅、教育、商业、零售生活、餐饮娱乐、商务办公、产业园区、交通、医疗休闲和竞品 10 组特征聚合不同半径内的数量、密度、占比、最近距离和高德 `business_area`。

画像输出商圈名称及来源、商圈类型、S/A/B/C/D 能级、业务适配度、竞争压力、可信度、优势、不足和数据警告。结果包含算法版本、POI 配置版本、权重版本和查询时间，历史结果不会被新配置覆盖。批量任务页支持生成、筛选、排序、对比并单独导出商圈工作簿。

商圈类型和能级属于基于 POI 结构的规则推断，不代表人口、客流、消费能力或销售预测。发生接口失败、结果截断、坐标未确认或有效特征不足时，系统会降低可信度并明确展示警告。

### 潜在人群智能画像

“潜在人群”页使用可解释的 POI 环境代理模型，输出可能较集中的人群类型与宽泛年龄段、消费环境指数和商场档次线索。每项结果都附带推断依据、可信度和限制说明；年龄指数用于比较环境倾向，不是人口比例，消费环境也不是居民收入或真实客单价。

当前版本仅使用高德 POI，不包含住宅房价、建成年代、手机信令、会员、订单或 SKU 销售数据。商场档次是依据商业 POI 数量及名称中的品牌、业态线索生成的系统推断，不是高德官方评级。重新生成商圈画像后，新结果会同时保存潜在人群画像并可导出到 Excel。

主要接口：

- `POST /api/geocode`、`POST /api/stores/from-geocode`
- `POST|GET /api/stores/{store_id}/business-district-analysis`
- `POST /api/analysis-jobs/{job_id}/business-district-analysis`
- `GET /api/analysis-jobs/{job_id}/business-district-results`
- `GET /api/analysis-jobs/{job_id}/business-district-export`
- `GET|PUT /api/business-district-config`

## 测试

```powershell
.\.venv\Scripts\python -m pytest -q
npm run build
```

测试覆盖名称标准化、行政区归一化、品牌/分店冲突、100 分匹配明细、自定义半径边界、10 类商圈识别、降级可信度、POI 去重、地址导入、高德错误码、公式注入防护，以及 Mock 模式下“搜索候选→确认→周边 POI→商圈画像→批量比较→多工作表 Excel 导出”的集成流程。

## 常见问题

- “后端服务未连接”：确认 8000 端口上的 FastAPI 已启动。
- “Key 无效/类型错误”：确认填写的是 Web 服务 API Key，而不是 JS API Key。
- “接口频率受限”：系统会有限退避重试；持续失败时稍后重试或检查配额。
- “结果可能被截断”：同一查询达到高德 200 条限制，不能视为全量数据。
- “地图 JS 加载失败”：核对 JS Key、安全密钥、域名白名单。
- Excel 未识别门店列：将表头改为“门店名称”或在映射页面选择正确列。

## 当前边界与扩展

系统不把环境代理指数表述为真实人口、客流、收入、消费或销售；无边界数据时不伪造住宅或商圈轮廓。步行距离字段与直线距离分开保存，目前默认不批量请求路径规划。当前批量商圈计算由 API 请求内顺序执行，超大任务建议后续接入 Redis/Celery 队列；也可继续扩展房价与建成年代补充数据、会员和订单聚合数据、Alembic、PostgreSQL、登录与多用户隔离、地图点聚合和可选步行路径。
