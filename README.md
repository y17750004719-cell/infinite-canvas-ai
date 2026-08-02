# Infinite Canvas AI

一个基于 Next.js 16、React 19 和 Turbopack 的 AI 设计画布项目，支持在无限画布中进行图片生成、上传参考图、对话式创作和作品管理。

## 快速开始

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

启动后访问 [http://localhost:3001](http://localhost:3001)。

如果你已经准备好了接口密钥，这 3 步就可以把项目跑起来。

## 功能简介

- 无限画布编辑，支持图片、文字、形状等内容组织
- AI 生图与对话模式切换
- 参考图上传与生成结果本地保存
- 多工作区 / 会话管理
- 本地浏览器存储历史项目数据

## 运行环境

- Node.js 24 LTS
- npm 11 或更高版本

仓库中包含 `.nvmrc`，如果你使用 `nvm`，可以先执行：

```bash
nvm use
```

## 安装依赖

在项目根目录执行：

```bash
npm install
```

## 环境变量配置

项目启动前需要先创建本地环境变量文件：

```bash
cp .env.local.example .env.local
```

如果仓库里还没有 `.env.local.example`，也可以直接手动创建 `.env.local`。

推荐至少配置以下变量：

```env
COMFLY_API_KEY=your_api_key_here
COMFLY_API_URL=https://ai.comfly.org/v1
LOG_LEVEL=basic
LOG_ALL_REQUESTS=1
```

项目中还支持这些可选变量：

```env
GPT_BEST_API_KEY=
GPT_BEST_BASE_URL=
COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS=1800000
COMFLY_ASYNC_POLL_TIMEOUT_MS=1800000
COMFLY_ASYNC_POLL_INTERVAL_MS=2000
IMAGE_SIZE_ALLOWLIST=1024x1024,1024x1792,1792x1024,2048x2048
IMAGE_SIZE_ALLOWLIST_GPT_IMAGE_2=1024x1024,1536x1024,1024x1536,2048x2048,2048x1152,3840x2160,2160x3840
AGENT_UNIFIED_PLANNER_ENABLED=1
AGENT_PLANNER_PROVIDER_ID=
AGENT_PLANNER_MODEL=
AGENT_PLANNER_TIMEOUT_MS=1800000
AGENT_RUN_TIMEOUT_MS=1800000
AGENT_PLANNER_SHADOW_MODE=0
```

说明：

- `COMFLY_API_KEY` 是主要使用的接口密钥
- `COMFLY_API_URL` 不填写时会默认使用 `https://ai.comfly.org/v1`
- `GPT_BEST_API_KEY` / `GPT_BEST_BASE_URL` 可作为兼容备用配置
- `COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS` 控制统一生图接口异步提交阶段的超时时间，默认 `1800000ms`
- `COMFLY_ASYNC_POLL_TIMEOUT_MS` / `COMFLY_ASYNC_POLL_INTERVAL_MS` 控制异步任务轮询超时与轮询间隔，默认 `1800000ms` / `2000ms`
- `IMAGE_SIZE_ALLOWLIST_GPT_IMAGE_2` 可以给 `gpt-image-2` 单独声明官方推荐尺寸集，当前示例已补到 `1024x1024 / 1536x1024 / 1024x1536 / 2048x2048 / 2048x1152 / 3840x2160 / 2160x3840`
- `AGENT_UNIFIED_PLANNER_ENABLED` 默认启用模型主导的统一需求规划；设为 `0` 可回退到旧路由流程
- `AGENT_PLANNER_PROVIDER_ID` / `AGENT_PLANNER_MODEL` 必须成对配置；留空时，带图任务复用当前聊天模型，纯文本任务复用 Agent Router 模型
- `AGENT_PLANNER_TIMEOUT_MS` 控制单次 Agent 多模态分析的超时，默认 `1800000ms`（1800 秒），允许范围为 `10000ms` 到 `1800000ms`
- `AGENT_RUN_TIMEOUT_MS` 控制整次 Agent 请求的超时，默认 `1800000ms`（1800 秒），避免总运行超时提前中断规划器
- Unified Planner 的正常执行严格只发起一次分析请求，不自动重试、不切换备用模型，也不再调用 Prompt Optimizer；失败后由用户点击“重新分析”创建新请求
- `AGENT_PLANNER_SHADOW_MODE=1` 时只记录 Planner 结果，不改变现有执行路径，便于灰度比较
- `.env.local` 已被 Git 忽略，不会上传到 GitHub

## 启动开发环境

```bash
npm run dev
```

启动成功后，打开：

[http://localhost:3001](http://localhost:3001)

默认开发服务器会监听本地 `3001` 端口。

Next.js 16 默认使用 Turbopack；开发和生产构建都不需要额外的 `--turbopack` 参数。

## 生产构建

构建项目：

```bash
npm run build
```

提交或部署前可以运行完整质量门禁：

```bash
npm run check
```

该命令会依次执行 ESLint、Next 路由类型生成、TypeScript 检查、Node 测试和生产构建。

启动生产环境：

```bash
npm run start
```

## 常用目录说明

- `app/`：Next.js App Router 页面与接口
- `app/components/`：画布、面板、工具栏等界面组件
- `app/lib/`：接口调用、本地存储、状态逻辑
- `runtime/uploads/`：本地上传与生成后的图片资源目录

## 开发建议

- 首次运行前先确认 `.env.local` 中已经填写可用的 API Key
- 如果切换了 Node 版本，建议重新执行一次 `npm install`
- `runtime/` 里的文件是本地产物，默认不会提交到 GitHub
- 浏览器中的历史项目数据主要保存在 IndexedDB，本地清缓存后可能丢失

## 常见问题

### 1. 启动后无法生成图片

优先检查：

- `.env.local` 是否存在
- `COMFLY_API_KEY` 是否填写正确
- 接口地址 `COMFLY_API_URL` 是否可访问

### 2. 上传的图片保存在哪里

上传与生成的图片会保存在：

```bash
runtime/uploads/
```

以及：

```bash
runtime/uploads/generated/
```

### 3. 为什么 GitHub 上没有 `.env.local`

这是正常的。为了避免泄露本地密钥，`.env.local` 已在 `.gitignore` 中排除。

### 4. `git push` 时 SSH 22 端口连不上

如果你的网络拦截了 GitHub 的 `22` 端口，可以改走 `443`：

```sshconfig
Host github.com
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/id_ed25519_github_y17750004719_cell
```

然后执行：

```bash
ssh -T git@github.com
```

### 5. 本地开发时出现 `Content Security Policy` / `unsafe-eval` 报错

如果你在 `npm run dev` 的本地页面里看到类似下面的报错：

```text
Content Security Policy of your site blocks the use of 'eval' in JavaScript
```

先不要急着改项目代码。当前仓库本身没有配置 `Content-Security-Policy`，也没有业务层的 `eval()` / `new Function()` 调用。这类报错在本地开发环境里更常见的原因是：

- 浏览器扩展注入了 CSP
- 本机代理 / VPN / 抓包工具修改了 `localhost` 响应头
- 企业安全软件或浏览器策略拦截了开发脚本

推荐按这个顺序排查：

1. 用浏览器 DevTools 打开 `Network`，选中 `Document` 请求，检查响应头里是否真的带有 `Content-Security-Policy`
2. 用无扩展窗口或全新浏览器 profile 打开 `http://localhost:3001`
3. 暂时关闭代理插件、系统代理、VPN、抓包工具、安全软件后再试
4. 如果普通浏览器有问题，但无扩展窗口正常，基本可以确认是浏览器侧注入，不需要改项目

注意：

- `next dev` 在开发环境下可能依赖被某些严格策略视为不安全的脚本能力
- 不要为了本地临时报错，直接把 `unsafe-eval` 放进生产环境 CSP
- 如果必须加兼容，只能做 `development` 环境下的临时放宽，不能带到生产环境

## GitHub

仓库地址：

[https://github.com/y17750004719-cell/infinite-canvas-ai](https://github.com/y17750004719-cell/infinite-canvas-ai)
