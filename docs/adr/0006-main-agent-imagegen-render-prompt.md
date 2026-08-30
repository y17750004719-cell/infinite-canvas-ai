# Main Agent ImageGen renderPrompt contract

状态：Accepted（当前架构）。

## Decision

图片生成和编辑由同一个 Main Agent Turn 负责。运行时在模型调用前加载 `imagegen` host Skill 与锁定的视觉 Skill；视觉 Skill 的 `renderPrompt` 输出约定由 Main Agent 直接执行。`generate_image.args.prompt` 是唯一最终供应商 Prompt。

Main Agent 可以先读取必要的只读上下文，再在同一会话中调用 `generate_image`。本地执行层只负责工具参数 schema、图片合同、权限、稳定引用、幂等、确认、取消、重试状态和供应商请求。供应商只接收最终 Prompt、图片引用和已解析图片参数。

## Prompt provenance

最终 Prompt 可追溯为“用户原始需求 + imagegen 执行规则 + 锁定视觉 Skill”。允许整理语言和顺序，但必须保留主体关系、构图与空间比例、材质工艺、色彩锚点、文字排版限制及明确禁止项。`concise` 只能删除工作流说明、隐藏上下文和工具说明，不能把视觉约束压缩成几个风格标签。

旧 `executionPlan`、`generationBrief`、`executionBrief` 和 `promptCompilation` 只为历史读取和迁移保留，不能覆盖当前工具参数或重新编译图片 Prompt。旧 ADR 0002 保留为历史记录。

## Recovery and retry

确认继续使用已保存的 `generate_image` 工具参数。供应商失败不会自动重放；用户显式重试时创建新的 `attemptId`/`callId`，重新加载并校验锁定 Skill，并从原始请求和当前修订开启新的 Main Agent Turn。已完成的有副作用工具调用不可重放。

## Consequences

系统不再有图片 Prompt Planner、Prompt Optimizer 或第二个 Prompt 模型边界。Prompt 质量由 Main Agent 按 Skill 规则负责；本地不会以关键词、长度或旧 Prompt 静默替换模型输出。

