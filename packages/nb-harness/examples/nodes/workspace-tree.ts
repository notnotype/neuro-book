/**
 * 注册一个内容节点 `<WorkspaceTree />`：把工作区根目录的一层列表渲染成一段文字，放进提示词里。
 *
 * 要说明的事：
 * - Profile 的提示词函数只能读 `ctx`，不能做 I/O。要用外部数据，先注册一个**数据源**（取数函数与取数时机），
 *   再注册一个声明依赖它的**节点**；渲染时节点只读 `context.sources` 里已经取好的值。内置节点也是这样注册进来的。
 * - 取数时机 `invocation`：每次调用开始 `prepare` 时取一次，整次调用内不变；`model-call` 则每次模型调用前都刷新。
 *   目录列表在一次调用里不需要变，用 `invocation`。
 * - 节点要声明能放在哪些父节点里（`parents`）；示例 Profile 把它放在 `<Tag>` 里，所以 `BUILTIN.tag` 在列表里。
 * - 取数函数抛错时，这次调用以 `invalid-profile`（诊断 `source-failed`）受理失败，不会带着半份数据去请求模型。
 *
 * 行为合同：docs/specs/harness/profile.md 输出第 1、4、5 条与“注册”一节。
 */

import Type from "typebox";
import type {FileAccess} from "@notnotype/nb-harness/builtin";
import {BUILTIN, nodeComponent} from "@notnotype/nb-harness/profile";
import type {ProfileHost} from "@notnotype/nb-harness/profile";

/** 注册方用自己的命名空间；`harness/` 留给内核。 */
export const WORKSPACE_LISTING = "example/workspace-listing";
export const WORKSPACE_TREE = "example/workspace-tree";

/** Profile 里写 `<WorkspaceTree />`；组件只是产生 `{type, props, children}` 这样的节点数据。 */
export const WorkspaceTree = nodeComponent(WORKSPACE_TREE);

export function registerWorkspaceTree(host: ProfileHost, access: FileAccess): void {
    const source = host.registerSource({
        id: WORKSPACE_LISTING,
        schema: Type.Array(Type.String()),
        phase: "invocation",
        resolve: async () => {
            const listed = await access.list(".");
            if (!listed.ok) throw new Error(`列工作区失败：${listed.code}（${listed.detail}）`);
            return listed.value.map((entry) => (entry.kind === "directory" ? `${entry.name}/` : entry.name));
        },
    });
    if (!source.ok) throw new Error(source.detail);
    const node = host.registerNodeType({
        id: WORKSPACE_TREE,
        category: "content",
        // layout 缺省 inline：示例 Profile 把它放在 <Tag> 里，标签本身已经换行。要直接嵌进一段文字时用 "block"，渲染时与前后空一行
        props: Type.Object({}),
        parents: [BUILTIN.user, BUILTIN.developer, BUILTIN.system, BUILTIN.tag],
        children: "none",
        sources: [WORKSPACE_LISTING],
        render: (_node, context) => {
            const names = context.sources[WORKSPACE_LISTING] as string[];
            return names.length === 0 ? "（工作区是空的）" : names.map((name) => `- ${name}`).join("\n");
        },
    });
    if (!node.ok) throw new Error(node.detail);
}
