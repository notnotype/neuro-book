# 开始前检查

这一节结束后，你会确认 NeuroBook 已经能正常调用 Agent。先做这一步，可以避免后面卡在“项目建好了，但 AI 没法工作”。

## 你需要准备什么

开始第一本书前，先确认四件事：

- 你已经能打开 NeuroBook 并登录。
- 你已经配置至少一个模型 Provider。
- 当前默认 Agent profile 可以创建 session。
- 你知道要写一本新书，或者至少有一个可以探索的灵感。

如果你还没有把应用跑起来，先回到 [快速开始](/quick-start)。

## 配置模型 Provider

点顶栏最右侧的**账号头像 → 设置**，进入设置页的**模型**分区，按顺序完成四步：选择 Provider、填写 API Base 与接口格式、填写 API Key、确认模型条目。四张图分别对应一个操作；图片中的密钥是脱敏占位，不能照抄到真实配置。

1. 选择 Provider：![选择 Provider](/images/tutorial-api-config-step-01-provider.png)
2. 填写 API Base 与接口格式：![填写 API Base](/images/tutorial-api-config-step-02-endpoint.png)
3. 填写 API Key：![填写 API Key](/images/tutorial-api-config-step-03-api-key.png)
4. 确认模型条目：![确认模型条目](/images/tutorial-api-config-step-04-model.png)

部署脚本不会替你保存 API Key；Agent 能不能工作，完全取决于这里是否配置成功。

Provider 就是提供大模型 API 的服务商，费用由服务商计价、直接结算给服务商，NeuroBook 本身不收费。详见 [配置 AI 模型](/quick-start#配置-ai-模型)。

配置完成后，点顶栏最右侧的按钮展开 **Agent 面板**（右侧抽屉），发一句话做最小检查：

```text
请简单回复：你现在可以作为 NeuroBook 的创作 Agent 工作吗？
```

如果 Agent 能正常回复，继续下一步。如果不能，优先检查：

- API Key 是否保存。
- 默认模型是否已选择。
- Provider 是否能连通。
- 当前账号是否已经登录。

## 确认当前项目

第一次进入教程时，你可能还没有项目。没关系，下一节会创建。

如果你已经有项目，先确认页面当前选中的项目就是你要写的那一本。后续 Agent 读写文件、调用 writer、导入角色卡、用 World Engine 追踪世界状态，都会围绕当前 Project Workspace 工作。

## 准备一个起点

你不需要完整大纲。任选一种起点就够：

```text
我想写一个夜行列车题材，主角是失忆检票员。
```

```text
我想写学院奇幻，女主是被学院当作秘密兵器培养的人造龙姬。
```

```text
我手里有一张 SillyTavern 角色卡，想把它变成 NeuroBook 项目。
```

## 成功标志

完成本节后，你应该能做到：

- 打开 Agent 抽屉。
- 发出一条测试消息。
- 收到 Agent 回复。
- 知道下一节要创建或选择哪个 Project Workspace。

下一节开始创建第一本书。
