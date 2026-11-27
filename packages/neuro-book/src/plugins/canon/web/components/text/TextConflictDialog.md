---
标签: [state:local, state:inject, env:portal]
别名: ["主文字冲突", "Text Conflict Dialog"]
---

# TextConflictDialog

提交主文字时要作者定的事（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 44）：作者动过的块在这期间被别处改了、删了，或现在做不了了，逐条列出来让作者选。受控：选了什么、确认以后怎样发由宿主定。

现在宿主只给它一条（整篇，`id` 为 `whole`，种类是 `changed` 或 `locked`）；别的种类（`gone`、`rerouted`、`manual`）与按块的 `id` 是按块编辑时留下的，现在没有调用方。

## 布局与交互

一个对话框，每条冲突一行：

- 两边都改了（`changed`）：并排两个可按下的块，“现在的”与“我的”，只把两边不一样的那一截标出来（前后相同的部分用次级色）；某一边是删除时写一句话。
- 被别处删了（`gone`）：“当作新加的一块留着”（下面是我的文字）与“去掉我的改动”。
- 现在做不了了（`locked`）：一句原因与唯一的选择“照现在的”，默认已经选上。
- 换了地方（`rerouted`）：这一块现在是剧情里的文字，上面一句说明，下面同样是“现在的”与“我的”。
- 要回去整理（`manual`）：只有一句说明，没有可选的；有这样的一条时“提交”发不出去，作者点“回去再改”。

每条都选了“提交”才发 `confirm`；发不出去时点它，列表下面淡入一句（`role="alert"`）：还有没选的写“每一块都选了才能提交”，有要回去整理的写“有要回去整理的块，先回去再改”。“回去再改”关掉对话框；选过的记在宿主那里（`choice`），再打开时还在这一轮的冲突照旧选着。窄的时候两个块上下排（按对话框自己的宽度，不按视口）。

## 数据

类型 `ConflictItem`、`ConflictChoice` 在 `text-conflict-dialog.ts`（宿主逻辑也用它）。

```ts
interface ConflictItem {
    /** 这条冲突的键（块的键）。 */
    id: string;
    kind: "changed" | "gone" | "locked" | "rerouted" | "manual";
    /** 我的文字；null 是我删了它。`locked` 时不用。 */
    mine: string | null;
    /** 现在的文字；`gone` 时为 null。 */
    theirs: string | null;
    /** `locked`、`rerouted`、`manual` 时的一句说明。 */
    reason?: string;
    /** 已经选的；没选为 null。 */
    choice: "mine" | "theirs" | "keep" | "drop" | null;
}

type Props = {
    open: boolean;
    items: readonly ConflictItem[];
    /** 正在提交：按钮不可用。默认 false。 */
    busy?: boolean;
};

type Emits = {
    (event: "choose", id: string, choice: "mine" | "theirs" | "keep" | "drop"): void;
    (event: "confirm"): void;
    (event: "update:open", value: boolean): void;
};
```

没有 slots、expose；attrs 不透传。

## 隐藏通道理由

- `state:local`：点过“提交”而还有没选的（只管列表下面那一句）。
- `state:inject`：经 `useCanonText()` 取翻译端口。
- `env:portal`：对话框渲染到 nb-ui `Dialog` 的 Teleport 目标（宿主提供的目标或 `body`）。
