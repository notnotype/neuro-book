---
标签: [state:local]
---

# ExplorerRootsDraft

w00058 t01 第 1 轮静态稿：资源管理器加上 Agent 注册方案之后的样子。行的结构与样式照 `ExplorerRow` 抄（展开箭头、文件图标、名字、行尾状态列），按已定的注意力排序摆出三组八个根；当前会话、当前 Profile 的标记与只读根的标记各出几种候选。样本写死在 `samples.ts`，不接文件服务，行不能点。

```ts
type Props = {
    /** 画哪种情形；默认 "overview"。 */
    scene?: "overview" | "sessions-few" | "temps-empty" | "profiles" | "readonly";
    /** 当前会话、当前 Profile 的标记；默认 "dot"。 */
    marker?: "dot" | "icon" | "badge";
    /** 只读根的标记；默认 "lock"。 */
    readonlyMark?: "lock" | "text";
    /** 树有没有焦点，决定选中行的底色；默认 true。 */
    focused?: boolean;
};
```

没有 emits、slots、expose；attrs 落在根元素上。静态稿，没有状态之间的过渡。
