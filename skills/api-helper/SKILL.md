---
name: api-helper
description: 查阅第三方 AI 供应商 API 文档并生成 Node.js 调用代码。当用户提到“API 怎么调”“生图接口调用”“按文档写请求”时使用。
---

# API Helper

## 目标

把供应商文档转换成两类结果：
1) 可直接改造的 Node.js 调用示例
2) 简短调用指南（必填参数、返回结构、常见坑）

## 默认文档入口

- 文档索引: `https://gpt-best.apifox.cn/llms.txt`
- Base URL / API Key 说明: `https://gpt-best.apifox.cn/doc-6535931.md`
- 常用接口速查: `references/quick-map.md`

当用户没给具体链接时，先从文档索引定位到目标 API 页面，再生成代码。

## 输入约定

用户通常会给出其中一种：
- API 类型（如“绘图模型 post 请求格式”）
- 具体接口名（如“/v1/images/generations”）
- 文档链接（Apifox doc/api 页面）

如果信息不完整，先补齐这 4 项再产出代码：
- 使用场景（文生图/图生图/聊天/视频等）
- 模型名
- 是否同步或异步
- 期望返回字段（如图片 URL、task_id）

## 输出格式

每次输出保持固定结构，避免啰嗦：

1. `接口结论`：方法 + 路径 + 用途（一句话）
2. `Node.js 示例`：可运行最小代码（优先 `fetch`）
3. `参数说明`：只列必填和高风险参数
4. `响应提取`：告诉用户从哪里取关键字段
5. `排错清单`：3-5 条常见错误

## 实施流程

1. 先读用户给的文档链接；如果是索引页，再进入对应 API 详情页。
2. 以文档为准提取：请求方法、路径、Header、Body、返回结构。
3. 生成 Node.js 代码：
   - 用环境变量读取密钥（`process.env.GPT_BEST_API_KEY`）
   - 明确 `Authorization: Bearer ...`
   - 包含错误处理（非 2xx 时打印响应体）
4. 若同一能力有多个格式（如 OpenAI Chat 格式 vs 官方格式）：
   - 先给推荐方案（通常优先通用/兼容格式）
   - 再给可切换说明（何时换另一种格式）
5. 如果文档存在歧义，明确标注“需用户确认项”，不要猜测。

## 代码模板（默认）

```js
const apiKey = process.env.GPT_BEST_API_KEY;
const baseUrl = process.env.GPT_BEST_BASE_URL || "https://gpt-best.cn";

async function callApi() {
  const res = await fetch(`${baseUrl}/REPLACE_PATH`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // REPLACE_BODY
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data;
}
```

## 质量标准

- 只写文档中可验证的信息，不杜撰参数。
- 示例必须能直接运行（补上路径和 body 即可）。
- 用户要“快”时，先给最小可用版本，再给可选高级参数。
- 用户要“准”时，给字段级映射（请求字段 -> 含义 -> 是否必填）。

## 不该触发的场景

以下场景不使用本 Skill：
- 纯前端 UI 设计
- 与 API 文档无关的通用编程题
- 不涉及第三方接口调用的问题
