# Pi native Main Agent completion and visible activity

## Decision

Main Agent 使用 Pi Agent 的自然结束语义：没有后续 Tool Call 的非空 assistant 普通文本直接成为最终回答。空响应、协议错误、预算耗尽、供应商错误和用户取消仍失败关闭。

图片生成、编辑、批量、导出和图像 Skill 必须显式调用 `handoff_to_image_planner`。如果模型漏交接而直接返回文本，本地接受该文本但不执行任何图像动作；这属于模型质量问题，不增加本地关键词路由或第二次模型复核。

复杂任务的用户可见过程由两部分组成：模型输出简短工作说明，本地输出真实的友好工具、Planner、确认和执行状态。reasoning/thinking、系统提示、工具参数、完整 Prompt、图片 URL和原始工具结果不进入用户事件流。

`update_conversation_memory` 是非终止、非外部动作工具。记忆补丁只暂存，在最终回答或 Planner 交接成功后提交；失败或取消时丢弃。

当前 Topic 最近一次失败、取消、部分成功或本地交付失败统一保存为 `AgentRecoveryRecord`。记录保留精确任务 ID、原始用户消息、归一化失败、恢复路由、锁定 Skill、稳定引用和任务快照；原始供应商 HTML、URL和堆栈只进入日志。

用户手输消息时，Main Agent 先运行受限恢复门控。门控只接收最新文字、紧凑恢复记录、Skill manifests 和手动 Skill，只能调用 `resolve_failed_task_recovery`，最多初次请求加一次结构修复；不读取图片、完整历史、Topic 记忆或上下文实体。点击重试直接提交精确 `recoveryTaskId`，已知恢复路由时跳过门控。

恢复聊天和只读视觉时重新运行 Main Agent；恢复图片、Planner 或 Skill 时，Image Planner 使用原始请求和原请求之前的历史重新生成合同；本地交付失败只重新发送任务快照中已保存的资产。部分成功任务先选择补齐缺失槽位或全部重做。Main Agent 的改写或“继续”文本不会成为 Planner 的权威 Brief，本地也不增加关键词恢复路由。

## Consequences

- 简单聊天只需一次模型请求，不再因缺少 finish 工具而报错。
- 工作说明可以在工具调用前实时显示，最终文本原位升级，不重复渲染。
- Main Agent 不设应用墙钟超时，只受供应商结束/错误、协议预算和用户取消控制。
- 恢复门控不占用正常 Main Agent 的 12 回合和 12 次查询预算；非法结果只修复一次，之后失败关闭。
- 旧恢复候选在后续任务成功、进入确认或澄清后不再触发；一次只暴露一个未解决任务。
- Image Planner 的权威合同边界保持不变，详见 [ADR 0002](./0002-model-routed-image-planner.md)。
