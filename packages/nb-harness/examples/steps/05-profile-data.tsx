/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 第 5 步：让 Profile 用上外部数据——数据源加节点。
 *
 * 要说明的事：
 * - 提示词函数只读 `ctx`，不做 I/O。外部数据先注册成**数据源**（schema、取数函数、取数时机），再注册一个声明依赖它的**节点**；
 *   `prepare` 统一取数（并发、按 schema 校验、失败变成诊断），渲染时节点只读已取好的值。
 * - 取数时机两种：`invocation` 一次调用取一次（工作区目录，放在种子里）；`model-call` 每次请求模型前都重取
 *   （这里的时钟，放在系统提示词里：一次调用里模型来回几轮，每轮看到的都是当时的时间）。
 * - 注册都落在一个**主机**上：使用方自己建一个 `createProfileHost()`、注册好再交给运行时；运行时会把自己的字段也登记上去。
 *
 * 运行：`bun examples/steps/05-profile-data.tsx`。
 * 行为合同：docs/specs/harness/profile.md 输出 1、4 与“注册”一节；docs/specs/harness/runtime.md 输出 4。
 */

import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import Type from "typebox";
import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {createLocalFileAccess} from "@notnotype/nb-harness/builtin/local";
import {Appending, BUILTIN, createProfileHost, defineProfile, History, Input, nodeComponent, Prompt, System, Tag, User} from "@notnotype/nb-harness/profile";
import {registerWorkspaceTree, WorkspaceTree} from "../nodes/workspace-tree";
import {liveModel, replyText, scratch} from "./env";

const {config, apiKeys} = liveModel();
const Clock = nodeComponent("example/clock");

const writer = defineProfile({
    id: "writer", name: "写作助手", description: "第 5 步：带外部数据的 Profile", version: 1,
    prompt: () => (
        <Prompt>
            <System>你是写作助手。现在是 <Clock />。</System>
            <History>
                <User><Tag name="workspace"><WorkspaceTree /></Tag></User>
            </History>
            <Appending><Input /></Appending>
        </Prompt>
    ),
});

const workspace = await scratch("step-05");
try {
    await mkdir(join(workspace.root, "notes"));
    await writeFile(join(workspace.root, "chapter-1.md"), "第一章 出航\n", "utf8");
    await writeFile(join(workspace.root, "chapter-2.md"), "第二章 起雾\n", "utf8");

    const host = createProfileHost();
    // invocation 时机的数据源与节点：工作区一层目录（实现见 examples/nodes/workspace-tree.ts）
    registerWorkspaceTree(host, createLocalFileAccess({root: workspace.root}));
    // model-call 时机的数据源与节点：此刻的时间
    unwrap(host.registerSource({id: "example/now", schema: Type.String(), phase: "model-call", resolve: async () => new Date().toISOString()}));
    unwrap(host.registerNodeType({
        id: "example/clock", category: "content", props: Type.Object({}), parents: [BUILTIN.system], children: "none", sources: ["example/now"],
        render: (_node, context) => String(context.sources["example/now"]),
    }));

    const runtime = await openRuntime({config, profiles: [writer], apiKeys, host});
    try {
        const session = unwrap(await runtime.createSession({profileId: "writer"}));
        const input = {content: "工作区里有哪些文件？现在是几点（UTC）？"};
        const preview = unwrap(await session.preview(input));
        console.log("系统提示词：", preview.system);
        console.log("种子：", preview.seeds.map((message) => message.content));
        const result = await unwrap(await session.prompt(input)).done;
        console.log(`状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
        console.log(replyText(result.entries));
        await session.close();
    } finally {
        runtime.close();
    }
} finally {
    await workspace.cleanup();
}
