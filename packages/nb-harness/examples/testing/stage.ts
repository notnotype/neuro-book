/**
 * 场地与探针：每个场景一个真实的临时目录（工作区放小说文件，状态目录放会话与凭据库），
 * 加上几条读日志条目的小函数。临时根按仓库的测试规则放在系统临时目录下（docs/testing/README.md）。
 */

import {mkdir, readdir, readlink, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {SessionEntry} from "@notnotype/nb-harness";
import type {ApprovalMode} from "@notnotype/nb-harness/config";
import type {Profile} from "@notnotype/nb-harness/profile";
import {loadProfile} from "@notnotype/nb-harness/profile/loader";

export const CHAPTER_1 = "第一章 出航\n林岚站在甲板上。\n远处是 1987 年的青岛。\n";

export type Stage = {
    /** 工具的根：模型只能读写这里面的文件。 */
    workspace: string;
    /** 会话日志与凭据库所在目录。 */
    state: string;
    cleanup(): Promise<void>;
};

export async function createStage(name: string): Promise<Stage> {
    const root = await createTestTmpRoot("nb-harness-examples", name);
    const workspace = join(root, "workspace");
    const state = join(root, "state");
    await mkdir(join(workspace, "notes"), {recursive: true});
    await mkdir(state, {recursive: true});
    await writeFile(join(workspace, "chapter-1.md"), CHAPTER_1, "utf8");
    await writeFile(join(workspace, "notes", "outline.md"), "主角：林岚\n反派：周沉\n", "utf8");
    return {workspace, state, cleanup: () => rm(root, {recursive: true, force: true})};
}

/**
 * 场景用的配置：一个自建服务 `scripted`，模型 `m`。地址指向一个不会有人监听的端口——模型的流被场景换成脚本，
 * 这个地址不会被访问；凭据库里也只放一个假 key，因为运行时受理时要求“选中的模型取得到凭据”。
 */
export function exampleConfig(approval: {mode?: ApprovalMode; tools?: Record<string, "allow" | "deny" | "ask">} = {}): unknown {
    return {
        providers: [{id: "scripted", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{id: "m", contextWindow: 100_000, maxTokens: 4_000}]}],
        models: {defaultModel: "scripted/m"},
        approval: {mode: approval.mode ?? "write", tools: approval.tools ?? {}},
    };
}

/** 从文件加载示例 Profile：与产品里“Profile 文件放在用户目录”同一条路。 */
export async function loadWriterProfile(): Promise<Profile> {
    const loaded = await loadProfile(fileURLToPath(new URL("../profiles/writer.profile.tsx", import.meta.url)));
    if (!loaded.ok) throw new Error(`${loaded.code}: ${loaded.detail}`);
    return loaded.value;
}

/** 条目的简写：`message:<角色>`、`custom:<customType>`、`custom_message:<customType>` 或条目类型，便于断言写入顺序。 */
export function kinds(entries: readonly SessionEntry[]): string[] {
    return entries.map((entry) => {
        if (entry.type === "message") return `message:${entry.message.role}`;
        if (entry.type === "custom" || entry.type === "custom_message") return `${entry.type}:${entry.customType}`;
        return entry.type;
    });
}

/** 日志里每个 `harness/invocation` 条目的阶段，按顺序。 */
export function invocationPhases(entries: readonly SessionEntry[]): string[] {
    return entries
        .filter((entry) => entry.type === "custom" && entry.customType === "harness/invocation")
        .map((entry) => (entry.type === "custom" ? (entry.data as {phase: string}).phase : ""));
}

/** 工具结果的文字与是否出错，按顺序。 */
export function toolResults(entries: readonly SessionEntry[]): {text: string; isError: boolean}[] {
    const out: {text: string; isError: boolean}[] = [];
    for (const entry of entries) {
        if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
        out.push({text: entry.message.content.map((block) => ("text" in block ? block.text : "")).join(""), isError: entry.message.isError === true});
    }
    return out;
}

/** 本进程打开的、指向该目录的文件描述符（Linux 的 /proc）；别的平台返回空数组，断言退化为不检查。装配失败不能漏掉凭据库。 */
export async function openFilesUnder(prefix: string): Promise<string[]> {
    if (process.platform !== "linux") return [];
    const files: string[] = [];
    for (const fd of await readdir("/proc/self/fd")) {
        try {
            const target = await readlink(`/proc/self/fd/${fd}`);
            if (target.startsWith(prefix)) files.push(target);
        } catch {
            // 枚举期间关闭的描述符
        }
    }
    return files;
}
