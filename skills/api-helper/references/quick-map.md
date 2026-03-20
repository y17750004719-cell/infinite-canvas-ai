# API Quick Map

面向 `api-helper` 的常用接口速查，优先覆盖“先跑通再扩展”的场景。

## 1) 启动前检查

- Base URL: 从供应商工作台获取（文档见 `doc-6535931.md`）
- API Key: 放到环境变量 `GPT_BEST_API_KEY`
- Header: `Authorization: Bearer <API_KEY>`
- Content-Type: JSON 请求用 `application/json`

## 2) 核心接口（已确认路径）

| 能力 | 方法 | 路径 | 文档 |
|---|---|---|---|
| 列出模型 | GET | `/v1/models` | `https://gpt-best.apifox.cn/api-287780941.md` |
| 聊天补全（含流式） | POST | `/v1/chat/completions` | `https://gpt-best.apifox.cn/api-139393491.md` |
| 画图（文生图/图生图） | POST | `/v1/images/generations` | `https://gpt-best.apifox.cn/api-302915860.md` |
| 画图异步结果查询 | GET | `/v1/images/tasks/{task_id}` | `https://gpt-best.apifox.cn/api-356258956.md` |

## 3) 绘图能力入口（高频）

- 生图简介: `https://gpt-best.apifox.cn/doc-5824149.md`
- Dall-e 通用 Generations: `https://gpt-best.apifox.cn/api-302915860.md`
- Midjourney 接入向导: `https://gpt-best.apifox.cn/doc-6172523.md`
- Ideogram 快速接入: `https://gpt-best.apifox.cn/doc-6850468.md`
- Recraft 附录: `https://gpt-best.apifox.cn/doc-5763915.md`
- Flux（Replicate 格式接入）: `https://gpt-best.apifox.cn/doc-6826694.md`

## 4) 其它常用能力入口

- 视频统一接口介绍: `https://gpt-best.apifox.cn/doc-7324259.md`
- Suno 场景总览: `https://gpt-best.apifox.cn/doc-5633215.md`
- 文件上传 README: `https://gpt-best.apifox.cn/doc-3530861.md`

## 5) 最小可用请求模板

```js
const apiKey = process.env.GPT_BEST_API_KEY;
const baseUrl = process.env.GPT_BEST_BASE_URL || "https://gpt-best.cn";

async function createImage(prompt) {
  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "flux-schnell",
      prompt,
      aspect_ratio: "1:1",
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data?.data?.[0]?.url;
}
```

## 6) 异步画图模板

```js
async function createImageAsync(prompt) {
  const submit = await fetch(`${baseUrl}/v1/images/generations?async=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "nano-banana", prompt }),
  });

  if (!submit.ok) throw new Error(await submit.text());
  const submitted = await submit.json();
  const taskId = submitted?.data?.task_id || submitted?.task_id;
  return taskId;
}

async function getImageTask(taskId) {
  const res = await fetch(`${baseUrl}/v1/images/tasks/${taskId}`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

## 7) 常见坑位

- `401`：密钥错误，或没带 `Bearer` 前缀。
- `404`：Base URL 或路径拼错，先用 `/v1/models` 验证连通性。
- `400`：`model` 不可用，先拉模型列表再替换。
- 异步任务无结果：确认是否使用了对应查询接口 `/v1/images/tasks/{task_id}`。
- 图片 URL 为空：检查返回结构中 `data.data[0].url`（异步）或 `data[0].url`（同步）。
