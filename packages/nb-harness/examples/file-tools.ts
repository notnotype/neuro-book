/**
 * 直接调用内置 read / edit 工具（不经过模型），演示 hashline 的“先读后改”。
 *
 * 运行：bun examples/file-tools.ts
 */
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AgentToolResult} from "@oh-my-pi/pi-agent-core";
import {EditStore} from "@oh-my-pi/pi-natives";
import {createEditTool, createReadTool} from "@notnotype/nb-harness";

function textOf(result: AgentToolResult): string {
    return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

const root = await mkdtemp(join(tmpdir(), "nb-harness-tools-"));

try {
    await writeFile(join(root, "chapter.md"), "# 第一章\n林照推开门。\n雨下得很大。\n", "utf-8");

    // read 与 edit 必须共享同一个 EditStore，read 输出的锚点才对 edit 有效。
    const store = new EditStore();
    const read = createReadTool({cwd: root, store});
    const edit = createEditTool({cwd: root, store});

    // 1. 读：首行是 [path#tag] 锚点头，之后是 “行号: 内容”。
    const view = textOf(await read.execute("read-1", {path: "chapter.md"}));
    console.log(`read 输出：\n${view}`);
    const header = view.split("\n")[0] as string;

    // 2. 改：用锚点头 + 行操作改第 3 行。
    const edited = await edit.execute("edit-1", {input: `${header}\nPUT 3.=3:\n+雨停了。\n`});
    console.log("edit isError：", edited.isError === true);
    console.log("磁盘内容：", JSON.stringify(await readFile(join(root, "chapter.md"), "utf-8")));

    // 3. 伪造锚点被拒绝，磁盘不变。
    const forged = await edit.execute("edit-2", {input: "[chapter.md#0000]\nPUT 1.=1:\n+# 序章\n"});
    console.log("伪造锚点 isError：", forged.isError === true);

    // 4. 写前确认：宿主可以拒绝写入。
    const guarded = createEditTool({cwd: root, store, confirmWrite: (request) => !request.displayPath.endsWith(".md")});
    const fresh = textOf(await read.execute("read-2", {path: "chapter.md"})).split("\n")[0] as string;
    const denied = await guarded.execute("edit-3", {input: `${fresh}\nPUT 1.=1:\n+# 序章\n`});
    console.log("写前确认拒绝：", textOf(denied));
} finally {
    await rm(root, {recursive: true, force: true});
}
