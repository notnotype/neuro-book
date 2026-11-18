---
标签: [state:local, state:inject]
别名: ["排队消息", "排队区", "Queued Messages"]
---

# AgentQueuedMessages

输入框上方的排队区：还没交给 Agent 的话。就绪的话（补充说明在这一步结束后插入，排队在这一轮结束后发送）等运行来取；留着的话（运行被停、出错或没能接着开时留下的）不会被取走，等人放行。每条一行，让用户知道刚才按下的回车没有丢，也知道哪几条停住了、为什么。行为合同见 [ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md) 的“排队区”。

## 布局与交互

- **头行**：有留着的话时出现在列表上方：暂停图标（提醒色）、“已暂停 N 条”、原因（留着的原因不止一种时取第一条的原因加“等”；先截断原因，“继续”完整保留）、“继续”按钮。头行另有一处读屏可见的状态播报，头行出现与条数变化时播报。
- **每条一行**：左侧小标签，后面是正文第一行（淡色，过长截断，悬停给全文），右端是“取出来改”与“删除”。
  - 标签：有 `author`（别的会话或插件排的）时是它的图标与名字，最长约 12 字宽，截断；否则补充说明用回车箭头图标，排队用列表图标。
  - 留着的行用虚线边框、透明底，读屏名称是“已暂停：<正文第一行>”。
  - `editable` 为 `false`（不是自己排的）时没有“取出来改”，“删除”照常。
- **收起**：就绪的行最多显示 3 条，更多的收成一行“还有 N 条”按钮，点开后全部列出（列表限高、内部滚动），再点收起。留着的行不受这个上限：它们不会被运行取走，收起了就处理不到。
- 点“取出来改”发 `edit`，点“删除”发 `remove`，点“继续”发 `continue`。`continueDisabled` 有值时“继续”不可用，悬停给出原因。

## 数据

```ts
import type {Text} from "@notnotype/nb-ui/text";

interface AgentQueuedMessagesProps {
    /** 必填，按缓冲区的顺序；为空时不渲染任何内容。 */
    queued: ReadonlyArray<{
        id: string;
        text: string;
        delivery: "steer" | "followup";
        /** 别人排的：标签换成它的图标与名字。 */
        author?: {label: Text; icon: string};
        /** false 时没有“取出来改”；缺省可改。 */
        editable?: boolean;
        /** 有值即留着的话，`reason` 是头行的原因。 */
        held?: {reason: Text};
    }>;
    /** “继续”为什么不可用；null 或不写时可用。 */
    continueDisabled?: Text | null;
}

type AgentQueuedMessagesEmits = {
    (e: "edit", id: string): void;
    (e: "remove", id: string): void;
    /** 放行留着的话：与输入框空着回车继续是同一个动作，由输入框翻成 `run.continue`。 */
    (e: "continue"): void;
};
```

本地状态只有“还有 N 条”展开与否。没有插槽与 expose。未声明的 attribute 落到根元素上。
