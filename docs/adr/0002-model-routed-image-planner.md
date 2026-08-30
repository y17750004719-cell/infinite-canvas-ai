# Main Agent Loop and Image Planner boundary

状态：Superseded。图像生成、编辑、批量和导出现在由 Main Agent 图像执行合同直接驱动；本 ADR 保留为历史记录。

当前实现见 [ADR 0006](./0006-main-agent-imagegen-render-prompt.md)：Main Agent 直接执行视觉 Skill 的 `renderPrompt` 约定，`generate_image.args.prompt` 是唯一最终 Prompt。

Main Agent 负责查看当前轮或按稳定 ID加载的视觉资产，并把与请求相关的主体、视角、空间关系、构图、色彩、光线、文字和必须保留项整理为结构化 `visualSummary`。Image Planner 不再接收图片像素，也不加载完整 `SKILL.md`；它只接收用户原始需求、必要的原始历史、已验证的稳定引用 ID、`visualSummary` 和唯一 Skill 的精简 manifest，并独立形成执行合同。原始需求仍是权威 Brief，Main Agent 不得把改写 Prompt 当作交接内容。

`image_pipeline` Skill 的运行时 manifest 必须通过 `planningGuidance` 和 `generationContract` 自包含地描述适用边界、最终 Prompt 结构、核心视觉规则、引用证据保留规则和负面约束。Skill 的工作流、工具调用说明、输出检查和质量门不进入 Planner 上下文。本地只校验协议、权限、安全、稳定 ID和预算，不承担关键词语义路由。合同校验后由本地确定性执行，不增加第二个模型执行层。

Main Agent 的自然文本结束语义和可见活动时间线由 [ADR 0003](./0003-pi-native-main-agent-completion.md) 定义；该决定不改变 Image Planner 对所有图像变更的权威边界。
