# Model-routed Image Planner boundary

图像生成、编辑、批量和导出必须先经过 Image Planner；主 Agent Front Door 直接处理普通聊天和只读图片对话。Front Door 是主 Agent 的首轮无工具、非流式结构化请求，可读取当前轮图片，并依据原始文字、历史摘要、附件元数据和全部启用 Skill manifest 返回路径与 Skill ID；不再发起独立 Router 请求。Image Planner 随后读取用户原始需求、原始图片和唯一 Skill 的完整正文，并独立形成执行合同。Front Door 的自然语言答案不能替代 Planner Brief；本地代码只校验协议、权限和安全，不承担关键词语义路由。
