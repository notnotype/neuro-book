---
schema: nbook.work/v1
workId: w00051-computer-use
issueId: null
status: active
updated: 2026-11-19
---

# Computer use：按截图与坐标操作界面

## 目标

让 Agent 按截图与坐标操作文字层读不到的界面（canvas、自定义字体的页面、浏览器之外的桌面应用），对接 Gemini 的 computer_use 工具、GPT-6.1 Terra 这类擅长 computer use 的模型。来源：w00034 t01 讨论（开发者 2026-11-19：computer use 另开 Work，本次不做）。

## 已知情况

- Gemini 的 `computer_use` 工具：模型收截图与当前网址，发 `click`、`type`、`navigate`、`scroll`、`drag_and_drop` 等，坐标按 1000×1000 归一化；环境有浏览器、桌面、移动三种；每个动作可能带 `safety_decision`（允许、要确认、拦下），可选的提示注入检测扫描截图。GPT-6.1 Terra 主打 computer use（只有二手报道）。见 [w00034 调研](../w00034-browser-use/research/2026-11-19-browser-agents-survey.md)“各家做法”。
- w00034 的浏览器插件第一版只做截图给模型看，不做按坐标操作（w00034 t01 调研的推荐）。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计：截图与坐标操作的范围、与浏览器插件的关系、安全确认 | 未开工 |

## 相关

- [w00034](../w00034-browser-use/README.md)：浏览器插件（CodeAct，按 DOM 与无障碍树操作）。
- [w00033](../w00033-page-agent/README.md)：w00032 t16 决定 12：以后有桌面外壳时由外壳提供可信输入与真实截图。
