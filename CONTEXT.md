# Project Context

## 供应商连接

供应商配置保存在本机 `runtime/api-providers.json`。聊天可为当前会话选择任意已启用供应商和聊天模型；保存或登录供应商不会隐式修改全局 `primary`。

## 小米平台登录凭证

Xiaomi 浏览器登录是专用凭证交换，不是标准 OAuth。平台返回的加密数据解密为 `{ sk, uid, url }`，其中 `sk` 按普通 API Key 保存和使用；没有 refresh token，也不能刷新。待处理登录的 X25519 私钥只在本机 `runtime/xiaomi-login.json` 中保存五分钟，成功后立即移除并禁止重放。

## Agent 图像职责

- **主 Agent Front Door**：主 Agent 的首轮无工具、非流式结构化请求。它可以读取当前轮图片，返回 `chat`、`vision_analysis` 或 `planner`，并可为 `planner` 选择一个明确匹配的 Skill manifest。内部路由值仍为 `planner`，不再发起独立 Router 请求。
- **主 Agent 回复阶段**：`chat` 和 `vision_analysis` 由 Front Door 直接返回文字；图像执行请求只在已有 Image Planner 合同内调用获准工具。
- **只读图片对话**：描述、识别、OCR、评价、比较、建议或只输出 Prompt，不改变、导出或生成图片。
- **Image Planner**：读取用户原始需求、原始历史、当前明确提供的原图、Front Door 的结构化路由元数据和唯一选中 Skill 的完整 `SKILL.md`，形成生成、编辑、批量、导出或 Skill 执行合同。Front Door 的自然语言答案不是权威 Brief。
- **图像交付动作**：会产生或改变交付物的生成、编辑、批量输出和导出操作，必须先经过 Image Planner。
- **图像 Skill**：用于 Image Planner 编译最终供应商 Prompt 的领域规则，不是独立工具调用；真实图像动作仍由 `generate_image` 执行。
