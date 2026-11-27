---
标签: [state:inject]
别名: ["还原对话框", "Revert Dialog"]
---

# RevertDialog

还原一次修订的对话框（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 22、29、30）。受控：阶段、预览的结果与原因都由宿主给（`RevertHost`，状态在 `revert.ts`）；结果回来之前宿主让 `saving` 为真。

## 布局与交互

nb-ui 的 `Dialog`（中号），标题“还原“某次修订”？”（还不知道标题时“还原这次改动？”）。按阶段（`phase`）：

- `previewing`：一行“正在预览…”（`role="status"`），“还原”不可用。
- `ready`：“还原以后：”与带来的变化，一句一行；按钮“还原”。
- `dependents`：“后面这些改动依赖它，要一起还原：”，依赖它的修订的标题从新到旧（还没读到的写“读取中…”），列不下的写“还有 N 次”；按钮“连同这些一起还原”，没有“还原”。
- `blocked`：只写原因，没有确认按钮，取消按钮写“关闭”。

`reason` 在 `ready`、`dependents` 时是世界写不了的原因（独占、只读、断开），这时确认按钮不可用。被拒收的原因（`error`）写在下面（`role="alert"`），结局不明时后面有“再查一次”，发 `recheck`。

事件：确认按钮发 `confirm`；取消、关闭、Escape、点遮罩发 `update:open(false)`（保存中不发、按钮不可用）；收起的动画结束发 `closed`（宿主在这之前接着给最后的内容）。

## 数据

```ts
type RevertPhase = "previewing" | "ready" | "dependents" | "blocked";

type RevertDialogProps = {
    open: boolean;
    /** 原来那次修订的标题；默认空。 */
    title?: string;
    phase: RevertPhase;
    impact?: readonly string[];
    /** 从新到旧；还没读到的为 null。 */
    dependents?: readonly (string | null)[];
    moreDependents?: number;
    reason?: string;
    error?: string;
    recheck?: boolean;
    saving?: boolean;
};
```

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
