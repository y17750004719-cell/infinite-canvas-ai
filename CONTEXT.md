# Project Context

## 供应商连接

供应商配置保存在本机 `runtime/api-providers.json`。聊天可为当前会话选择任意已启用供应商和聊天模型；保存或登录供应商不会隐式修改全局 `primary`。

## 小米平台登录凭证

Xiaomi 浏览器登录是专用凭证交换，不是标准 OAuth。平台返回的加密数据解密为 `{ sk, uid, url }`，其中 `sk` 按普通 API Key 保存和使用；没有 refresh token，也不能刷新。待处理登录的 X25519 私钥只在本机 `runtime/xiaomi-login.json` 中保存五分钟，成功后立即移除并禁止重放。

## Agent 图像职责

- **Main Agent Loop**：Pi Agent 的统一入口，可在最多 12 个模型回合内按需读取 Topic 记忆、上下文实体和历史视觉资产。没有后续 Tool Call 的非空普通文本自然成为最终回答；空响应失败关闭。它不直接调用任何图像变更工具。
- **工作说明（Agent Commentary）**：复杂任务在读取上下文、调用重要工具、改变方向或遇到阻碍时显示的简短用户可见进展。工作说明不是 reasoning，不包含思维链、系统提示、工具参数、完整 Prompt 或内部诊断。
- **活动时间线（Agent Activity Timeline）**：按实际发生顺序保存工作说明、友好工具状态和本地 Planner/执行状态。每条工作说明最多 1200 字符，每个任务最多持久化 24 条活动记录；简单聊天没有工作说明或工具时不显示时间线。
- **最终回答（Final Response）**：Main Agent 没有后续 Tool Call 的普通文本。文本先作为当前活动流式显示，回合自然结束后原位升级为最终回答，不重复追加。
- **Planner 交接（Planner Handoff）**：Main Agent 显式调用 `handoff_to_image_planner`，提交已验证的 Skill ID、稳定引用 ID和由当前视觉证据形成的 `visualSummary`，并立即结束 Main Agent Loop。图片动作不能用普通文本假装交接。
- **只读上下文**：主 Agent 只按稳定 ID读取历史资产；本地不根据“上一张”“刚才那张”等文字自动选择图片。视觉资产通过 `load_visual_reference` 作为下一轮模型视觉输入加载，单次最多 4 张。
- **主题记忆**：每个 Topic 持久化近期对话、滚动摘要、事实、偏好、活动任务和最近引用资产。Main Agent 通过非终止的 `update_conversation_memory` 暂存语义补丁，仅在最终回答或 Planner 交接成功后提交；失败或取消时丢弃。完整历史保留，但每轮只注入受限快照；不使用跨 Topic 检索或向量数据库。
- **统一任务恢复**：失败、取消、部分成功或本地交付失败统一持久化 `AgentRecoveryRecord`，包含精确任务 ID、原始用户消息、失败分类、恢复路由、锁定 Skill、稳定引用和可选任务快照。当前 Topic 只暴露最近一个未解决记录；后续成功、确认或澄清会关闭旧候选。
- **恢复门控**：用户手输新消息且存在恢复候选时，Main Agent 先运行最多两轮的受限 Pi 门控，只能调用 `resolve_failed_task_recovery`；不接收图片、完整历史、Topic 记忆、实体清单或其他工具。两轮都没有返回有效协议时，手输消息按新任务继续；精确重试仍失败关闭。点击重试直接提交 `recoveryTaskId`，已知路由时不运行门控。门控只决定恢复、继续当前请求或说明无法恢复，不改写原始 Brief。
- **恢复执行**：聊天和只读视觉重新进入 Main Agent；图片和 Skill 失败重新进入 Main Agent 并生成新合同；已保存资产的本地交付失败只重新交付对应资产。部分成功必须先选择补齐缺失项或全部重做。原 Skill 默认保持，手动 Skill 可以覆盖；未知、禁用或被模型替换的 Skill 失败关闭。
- **只读图片对话**：描述、识别、OCR、评价、比较、建议或只输出 Prompt，不改变、导出或生成图片。
- **图像执行合同**：由 Main Agent 在读取必要上下文和唯一选中 Skill 后形成；本地只做协议、引用、权限、数量和执行安全校验，不再发起独立 Planner 模型请求。
- **图像交付动作**：会产生或改变交付物的生成、编辑、批量输出和导出操作，必须先经过 Main Agent 的图像执行合同。
- **图像 Skill**：`image_pipeline` manifest 的 `planningGuidance` 和 `generationContract` 必须足以独立指导 Image Planner 编译最终供应商 Prompt；不向 Planner 注入完整 `SKILL.md`，也不把 Skill 的工作流、输出检查或质量门塞进运行时合同。真实图像动作仍由 `generate_image` 执行。

图像执行合同校验通过后，本地按合同确定性执行；不会再启动第二个模型 Loop 决定是否调用图像工具。供应商能力不足只作为模型配置错误处理，不添加供应商专用 Agent 协议分支。

避免使用独立 Front Door、展示思维链、强制 finish 工具或把 Main Agent 普通文本视为协议错误。
