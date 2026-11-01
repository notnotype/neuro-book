---
标签: [state:inject, env:portal]
---

# CapabilityIcons

模型行上的能力小图标：能看图、支持推理（悬停写出支持的推理档）。图标不进 Tab 序列（一行一两个，几十行就是上百个停靠点），读屏念出文字说明，推理档也写在里面（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 6）。只画有的能力，都没有时什么都不画。

## 隐藏通道理由

- `state:inject`：说明文字经宿主注入的翻译端口取（`useModelsText`）。
- `env:portal`：悬停提示传送到 `body`。
