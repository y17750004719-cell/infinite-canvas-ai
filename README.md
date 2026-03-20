# Infinite Canvas AI

一个基于 Next.js 14 的 AI 设计画布项目，支持在无限画布中进行图片生成、上传参考图、对话式创作和作品管理。

## 功能简介

- 无限画布编辑，支持图片、文字、形状等内容组织
- AI 生图与对话模式切换
- 参考图上传与生成结果本地保存
- 多工作区 / 会话管理
- 本地浏览器存储历史项目数据

## 运行环境

- Node.js 18 或更高版本
- npm 9 或更高版本

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
COMFLY_API_URL=https://ai.comfly.chat/v1
LOG_LEVEL=basic
LOG_ALL_REQUESTS=1
```

项目中还支持这些可选变量：

```env
GPT_BEST_API_KEY=
GPT_BEST_BASE_URL=
COMFLY_ASYNC_POLL_TIMEOUT_MS=600000
COMFLY_ASYNC_POLL_INTERVAL_MS=2000
IMAGE_SIZE_ALLOWLIST=1024x1024,1024x1792,1792x1024,2048x2048
```

说明：

- `COMFLY_API_KEY` 是主要使用的接口密钥
- `COMFLY_API_URL` 不填写时会默认使用 `https://ai.comfly.chat/v1`
- `GPT_BEST_API_KEY` / `GPT_BEST_BASE_URL` 可作为兼容备用配置
- `.env.local` 已被 Git 忽略，不会上传到 GitHub

## 启动开发环境

```bash
npm run dev
```

启动成功后，打开：

[http://localhost:3000](http://localhost:3000)

## 生产构建

构建项目：

```bash
npm run build
```

启动生产环境：

```bash
npm run start
```

## 常用目录说明

- `app/`：Next.js App Router 页面与接口
- `app/components/`：画布、面板、工具栏等界面组件
- `app/lib/`：接口调用、本地存储、状态逻辑
- `public/uploads/`：本地上传与生成后的图片资源目录

## 常见问题

### 1. 启动后无法生成图片

优先检查：

- `.env.local` 是否存在
- `COMFLY_API_KEY` 是否填写正确
- 接口地址 `COMFLY_API_URL` 是否可访问

### 2. 上传的图片保存在哪里

上传与生成的图片会保存在：

```bash
public/uploads/
```

以及：

```bash
public/uploads/generated/
```

### 3. 为什么 GitHub 上没有 `.env.local`

这是正常的。为了避免泄露本地密钥，`.env.local` 已在 `.gitignore` 中排除。

## GitHub

仓库地址：

[https://github.com/y17750004719-cell/infinite-canvas-ai](https://github.com/y17750004719-cell/infinite-canvas-ai)
