/**
 * 提示词模板的节点。JSX 自动运行时在 `@notnotype/nb-harness/prompt`（`jsxImportSource` 指向它）；
 * 节点的渲染规则见 docs/specs/harness/ 的 Profile Spec（第 4 片新建）。
 */

/** 模板节点：`type` 是组件函数本身。 */
export interface PromptNode {
    readonly type: PromptComponent<any>;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly PromptChild[];
}
export type PromptChild = PromptNode | string | number | boolean | null | undefined | readonly PromptChild[];
export type PromptComponent<P> = (props: P) => PromptNode;

/** 节点的属性。有子节点时 `<System>` 是容器；自闭合的 `<System />` 放 Profile 的 `system`。 */
export interface PromptComponents {
    System: PromptComponent<{children?: PromptChild}>;
    User: PromptComponent<{children?: PromptChild}>;
    Assistant: PromptComponent<{children?: PromptChild}>;
    P: PromptComponent<{children?: PromptChild}>;
    Tag: PromptComponent<{name: string; attrs?: Readonly<Record<string, string>>; children?: PromptChild}>;
    /** 工具在生效工具集里时才渲染。 */
    If: PromptComponent<{tool: string; children?: PromptChild}>;
    /** 工具交给服务商的名字（按适配器的换算），提示词里提到工具时用它，不手写换算后的名字。 */
    ToolName: PromptComponent<{id: string}>;
    /** 压缩摘要与已提交的轮；`last` 只取最近几轮。 */
    History: PromptComponent<{last?: number}>;
    /** 进行中的这一轮，按 Profile 的 `turn` 渲染；模板里必须恰好一个。 */
    Turn: PromptComponent<{}>;
    /** `name="*"` 只收没被单独摆放的槽；`drop` 表示有意不要这个槽，不写诊断。 */
    Slot: PromptComponent<{name: string; stable?: boolean; volatile?: boolean; drop?: boolean}>;
    Fragment: PromptComponent<{children?: PromptChild}>;
}
