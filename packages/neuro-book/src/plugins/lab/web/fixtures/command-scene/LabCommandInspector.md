---
标签: [state:local]
---

# LabCommandInspector

Lab 命令场景的只读检视：当前上下文、已登记命令的描述、`when` 求值与实际的 Agent 暴露。渲染在 fixture 的底部控制抽屉里，不进画布。

## 数据

```ts
type Props = {
    /** 命令场景（lab-command-scene.ts）：局部命令表、上下文、面板宿主与最近一次失败。 */
    scene: LabCommandScene;
};
```

无 emits、slots、expose。

## 行为

- 只读：不执行命令、不改上下文；执行记录走 Lab 的事件 tab。
- 命令标题按 Lab 自己的语言常量（`lab-locale.ts`）显示，不跟随产品的界面语言配置。
- 场景的失败只在唯一的 `role="alert"` 区域显示，可以手动清掉（清的是场景里的失败记录）。
