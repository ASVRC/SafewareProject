# AI 软件工程任务分级与 Agent 可靠性评估平台

一个面向软件工程项目组的本地 Web 平台，用于管理 AI 协作任务、计算任务等级、登记 Agent 失效、评估可靠度并分析维护优先级。

## 项目简介

在软件需求、设计、编码、测试和维护过程中，AI 工具需要受到明确的任务边界和人工复核约束。本项目将以下能力集中到一个可运行的平台中：

- 根据风险、可逆性、自动验收条件和安全属性计算 L1/L2/L3 任务等级。
- 管理任务标题、说明、负责人、截止日期和处理状态。
- 记录 Agent 输出的错误结果、边界越权、证据不足、指令偏离和恢复成本。
- 根据五维权重计算失败分、可靠度和严重度。
- 按失效根因生成帕累托排序，辅助维护人员确定修复优先级。
- 通过 React 仪表盘展示任务进度、质量信号和最近复盘记录。

## 功能概览

### 任务管理

- 新建任务并由服务端自动计算任务等级。
- 按关键词搜索任务。
- 按 L1、L2、L3 筛选任务。
- 更新 `todo`、`in_progress`、`done` 三种状态。
- 删除任务并处理关联数据。

### Agent 可靠性评估

失效记录使用五个维度，每项取值为 0—4 的整数：

| 维度 | 权重 |
|---|---:|
| 错误结果 | 35% |
| 边界越权 | 20% |
| 证据不足 | 20% |
| 指令偏离 | 15% |
| 恢复成本 | 10% |

计算公式：

```text
失败分 = round((错误结果 × 0.35
             + 边界越权 × 0.20
             + 证据不足 × 0.20
             + 指令偏离 × 0.15
             + 恢复成本 × 0.10) × 25)

可靠度 = 100 - 失败分
```

严重度区间：

| 失败分 | 严重度 | 处理建议 |
|---:|---|---|
| 0—19 | low | 常规审阅 |
| 20—39 | medium | 加强协作 |
| 40—59 | high | 人工接管 |
| 60—100 | critical | 停止相关工作并复盘 |

当边界越权分达到 4 且基础严重度为 low 或 medium 时，系统将结果提升到 high；基础严重度为 critical 时保持 critical。

## 技术栈

| 层次 | 技术 |
|---|---|
| 前端 | React 19、Vite 7、原生 CSS |
| 后端 | Node.js 22.13+、Express 5 |
| 数据库 | Node.js 原生 `node:sqlite` |
| 测试 | Node.js 内置 Test Runner |
| 运行方式 | Windows、PowerShell、本地 HTTP 服务 |

## 环境要求

- Node.js `22.13.0` 或更高版本。
- npm 可用。
- Windows 环境下可直接使用 `npm.cmd` 命令。

## 快速开始

### 安装依赖

```powershell
npm.cmd install
```

### 开发模式

开发模式会同时启动 Vite 前端服务和 Express API 服务：

```powershell
npm.cmd run dev
```

默认开发地址：

- 前端：`http://localhost:5173`
- API：`http://localhost:3000`

### 构建并启动

```powershell
npm.cmd run build
npm.cmd start
```

构建后由 Express 同时提供静态文件和 REST API，默认地址为 `http://localhost:3000`。

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | Express 监听端口 |
| `DATABASE_PATH` | 服务端默认路径 | SQLite 数据文件路径；可按运行环境指定 |
| `SEED_INITIAL_DATA` | `1` | 设为 `0` 时创建不含初始化验证记录的空数据库 |

## REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 检查服务状态 |
| `GET` | `/api/tasks` | 获取任务列表 |
| `POST` | `/api/tasks` | 创建任务并计算等级 |
| `PATCH` | `/api/tasks/:id` | 更新任务状态 |
| `DELETE` | `/api/tasks/:id` | 删除任务 |
| `GET` | `/api/failures` | 获取失效记录 |
| `POST` | `/api/failures` | 创建失效记录并计算评分 |
| `GET` | `/api/dashboard` | 获取仪表盘聚合数据 |
| `POST` | `/api/classify` | 单独计算任务等级 |

### 创建任务示例

```powershell
$body = @{
  title = '生成单元测试样例'
  description = '为纯逻辑校验函数补充边界测试'
  risk = 'low'
  reversible = $true
  autoVerifiable = $true
  safetyCritical = $false
  status = 'todo'
  owner = '测试负责人'
  dueDate = '2026-11-15'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://localhost:3000/api/tasks' `
  -ContentType 'application/json' `
  -Body $body
```

客户端不应直接提交 `level` 字段。服务端根据任务原始属性重新计算等级，避免派生字段被覆盖。

## 任务分级规则

规则按以下顺序执行：

1. `risk = high`、`safetyCritical = true` 或 `reversible = false`，结果为 L3。
2. 在不满足 L3 的条件下，`risk = low`、`reversible = true` 且 `autoVerifiable = true`，结果为 L1。
3. 其他情况，结果为 L2。

| 等级 | 适用范围 | 人员责任 |
|---|---|---|
| L1 | 低风险、可逆、可自动验收 | 抽样检查和结果验收 |
| L2 | 存在不确定性或需要领域判断 | 责任人逐项复核 |
| L3 | 高风险、不可逆、安全关键或重要数据相关 | 人员执行并审批 |

## 项目结构

```text
.
├─ src/
│  ├─ App.jsx              # React 主页面和交互逻辑
│  ├─ main.jsx             # 前端入口
│  └─ styles.css           # 页面样式
├─ server/
│  ├─ index.js             # Express 应用、路由和输入校验
│  ├─ db.js                # SQLite 初始化、CRUD 和聚合
│  ├─ rules.js             # 任务分级和失效评分
│  ├─ api.test.js          # API 集成测试
│  ├─ db.test.js           # 数据层测试
│  └─ rules.test.js        # 规则单元测试
├─ data/                   # 本地 SQLite 数据目录
└─ dist/                   # Vite 构建输出
```

## 测试与验证

执行自动化测试：

```powershell
npm.cmd test
```

当前验证结果：

- 9 个测试全部通过。
- Vite 生产构建成功。
- `GET /api/health`、`GET /api/dashboard`、`GET /api/tasks` 返回正常。
- 首页静态资源和 `/docs` 文档资源返回正常。
- 服务停止后 3000 端口能够释放。
