---
验证入口: EditorArea
标签: [state:local, env:global]
别名: ["源码编辑器", "Source Editor", "Monaco"]
---

# MonacoControl

源码编辑器控件：一个 Monaco 编辑器实例，按编辑器控件合同（`control.ts`）绑定文档（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 9–13、20）。同组的源码文件共用这一个实例，换文档只换模型。

## 数据

```ts
type Props = {
    binding: ViewBinding | null;
    readonly: boolean;
    /** 变为可见时重新布局（停放期间尺寸为零）。 */
    visible: boolean;
    /** 编辑器的可访问名称（文件名）。 */
    label: string;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

## 行为

- 第一次挂上时按需加载 Monaco（语言：Markdown、JSON、JavaScript、TypeScript、CSS、HTML、XML、YAML，其余纯文本），加载失败原位显示原因。
- 每“文档 × 组”一个模型，连同视图状态存在绑定的槽里：换文档时 `setModel` 并恢复光标、滚动与选区；A→B→A 回来时撤销栈还在。模型由编辑器区在标签关闭或淘汰时释放，组件卸载只释放编辑器实例。
- 每次输入立即经 `binding.commit` 交出；回执为 `conflict` 时保留自己的内容，裁决后按文档的正文重设。正文被别处改了时用 `setValue` 换成文档的正文，这会清掉这个模型的撤销栈（外部内容不进用户的撤销历史）。
- Monaco 的模型把换行统一成一种、把 BOM 单独存放：交给文档的正文是换入模型时的原文与模型内容按行三方合并的结果（`source-merge.ts`），没改的行连同自己的换行符原样保留，模型文本取时带上 BOM（`getValue(undefined, true)`）。只打开、切走、切回不会变 dirty。
- 组件重挂时编辑器实例重建（撤销栈在模型里，不丢）；焦点由编辑器区在重挂后交还给活动视图，控件自己不抢焦点。
- 句柄：聚焦、撤销、重做、行号导航（`revealLineInCenter` 并把光标放到行首）。

`state:local`：编辑器实例与当前绑定。`env:global`：观察文档根的属性（主题与明暗换了重新生成 Monaco 的主题），卸载时断开。
