/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 第 3 步：给模型工具，并由宿主决定要不要放行。
 *
 * 要说明的事：
 * - 工具实体由装配方给（`tools: [来源…]`），Profile 只用 `tools: ["read", "edit"]` 列名字：可见工具 = Profile 列的 ∩ 来源有的。
 *   列了没装的工具不算错，预览的 `diagnostics` 会给 `unknown-tool` 警告。
 * - 内置 `read`、`edit` 只经资源地址碰文件：这里登记 `project://` 指向一个临时目录（根外的路径一律 `outside-root`）。
 *   `edit` 必须先 `read`：读出来的 `[project://chapter-1.md#tag]` 头是改它的凭证。
 * - 审批：每次工具调用先按工具等级、配置与审批模式判定；要询问时先问宿主的 `approve` 回调（这里打印并批准），
 *   回调返回 `null` 才进入“等用户”（`status.pending` 加 `session.resolve`）。界面不给回调，改为订阅 `interaction` 事件后 `resolve`：
 *
 *       session.subscribe((event) => {
 *           if (event.type === "interaction" && event.phase === "request") void session.resolve({interactionId: event.interactionId, decision: "approve"});
 *       });
 *
 *   命令行那种“停下来问人”的交互用 `invocation.next()`（见 examples/cli.ts）。
 *
 * 运行：`bun examples/steps/03-tools-and-approval.tsx`。
 * 行为合同：docs/specs/harness/runtime.md 输出 6；docs/specs/harness/tools.md 输出 4、6；docs/specs/harness/builtin-tools.md 输出 2、6。
 */

import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {createBuiltinTools, createResourceAccess} from "@notnotype/nb-harness/builtin";
import {createLocalFileAccess} from "@notnotype/nb-harness/builtin/local";
import {Appending, defineProfile, History, Input, Prompt, System} from "@notnotype/nb-harness/profile";
import {liveModel, replyText, scratch} from "./env";

// write 模式下 edit 本来直接放行；配置把它改成“询问”，好让回调派上用场
const {config, apiKeys} = liveModel({mode: "write", tools: {edit: "ask"}});
const editor = defineProfile({
    id: "editor", name: "改稿助手", description: "第 3 步：读改章节", version: 1,
    tools: ["read", "edit"],
    prompt: () => (
        <Prompt>
            <System>你是改稿助手。改文件前先用 read 读到它，再用 edit 按 read 给出的 [地址#tag] 头修改；作品在 project://。只改用户要求的句子。</System>
            <History />
            <Appending><Input /></Appending>
        </Prompt>
    ),
});

const workspace = await scratch("step-03");
try {
    await writeFile(join(workspace.root, "chapter-1.md"), "第一章 出航\n林岚站在甲板上。\n远处是 1987 年的青岛。\n", "utf8");
    const runtime = await openRuntime({
        config, profiles: [editor], apiKeys,
        tools: [createBuiltinTools({resources: createResourceAccess({project: {provider: createLocalFileAccess({root: workspace.root}), doc: "作品目录"}})})],
        approve: async (request) => {
            console.log(`审批：${request.toolName}（${request.tier}）参数 ${JSON.stringify(request.args).slice(0, 160)}`);
            return {decision: "approve"};
        },
    });
    try {
        const session = unwrap(await runtime.createSession({profileId: "editor"}));
        const result = await unwrap(await session.prompt({content: "把 project://chapter-1.md 的第二行改成：林岚站在船头，风很大。"})).done;
        console.log(`状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
        console.log(replyText(result.entries));
        console.log("文件现在是：");
        console.log(await readFile(join(workspace.root, "chapter-1.md"), "utf8"));
        await session.close();
    } finally {
        runtime.close();
    }
} finally {
    await workspace.cleanup();
}
