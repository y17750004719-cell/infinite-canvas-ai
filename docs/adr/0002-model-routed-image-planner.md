# Main Agent Loop and Image Planner boundary

图像生成、编辑、批量和导出必须先经过 Image Planner。主 Agent 使用 Pi Agent Loop 处理普通聊天、只读视觉分析和历史资产查询；原 Front Door 只是该 Loop 第一轮的职责，不再发起独立模型请求。主 Agent 只能调用只读上下文工具、结束工具或 `handoff_to_image_planner`，不能调用图像变更工具。

Main Agent 负责查看当前轮或按稳定 ID加载的视觉资产，并把与请求相关的主体、视角、空间关系、构图、色彩、光线、文字和必须保留项整理为结构化 `visualSummary`。Image Planner 不再接收图片像素，也不加载完整 `SKILL.md`；它只接收用户原始需求、必要的原始历史、已验证的稳定引用 ID、`visualSummary` 和唯一 Skill 的精简 manifest，并独立形成执行合同。原始需求仍是权威 Brief，Main Agent 不得把改写 Prompt 当作交接内容。

`image_pipeline` Skill 的运行时 manifest 必须通过 `planningGuidance` 和 `generationContract` 自包含地描述适用边界、最终 Prompt 结构、核心视觉规则、引用证据保留规则和负面约束。Skill 的工作流、工具调用说明、输出检查和质量门不进入 Planner 上下文。本地只校验协议、权限、安全、稳定 ID和预算，不承担关键词语义路由。合同校验后由本地确定性执行，不增加第二个模型执行层。

Main Agent 的自然文本结束语义和可见活动时间线由 [ADR 0003](./0003-pi-native-main-agent-completion.md) 定义；该决定不改变 Image Planner 对所有图像变更的权威边界。
