---
标签: []
---

# AgentTextBubble

文本类消息的外壳分发器。
根据 `node.message.type` 分发到对应的具体子气泡实现：
- `system` -> `AgentSystemBubble`（系统通知、System Prompt、运行错误）
- `user` -> `AgentUserBubble`（用户提问、steer 引导、多模态附件卡片、就地编辑）
- `ai` -> `AgentAssistantBubble`（AI 模型回复、思维链折叠、Markdown 正文、用量费用统计）
纯零件，不持有任何独立状态，无外部隐藏通道。
