/**
 * 规则文件进开场（docs/specs/agent/builtin-profiles.md 输出 4、5）：用户的 `user://AGENTS.md` 与书的 `project://AGENTS.md`。
 * 读的时机是 `opening()` 定的：建会话时与每次压缩之后。
 */

import {opening} from "@notnotype/nb-harness/kernel";
import type {Resources} from "@notnotype/nb-harness/kernel/contracts";
import type {AgentExtensionImplementation} from "../../../shared/points";

import {ResourceReadError} from "../../resources";

export const RULES_EXTENSION = "nbook.agent.rules";
const LIMIT_BYTES = 32 * 1024;

const FILES = [
    {uri: "user://AGENTS.md", tag: "user_rules"},
    {uri: "project://AGENTS.md", tag: "book_rules"},
] as const;

/** 前 `limit` 个字节，退到完整字符的边界（UTF-8 的后续字节是 `10xxxxxx`）；没超过时为 null。 */
function truncateUtf8(text: string, limit: number): string | null {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= limit) return null;
    let end = limit;
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    return new TextDecoder().decode(bytes.subarray(0, end));
}

export async function loadRules(resources: Resources, report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void): Promise<string[]> {
    const parts: string[] = [];
    for (const {uri, tag} of FILES) {
        let text: string | undefined;
        try {
            text = await resources.read(uri);
        } catch (error) {
            // 没有打开书与文件不存在一样，都是没有这份规则。
            if (error instanceof ResourceReadError && error.code === "no-project") continue;
            report("rules-unreadable", `could not read the rules file ${uri}; the session continues without it`, {uri, message: error instanceof Error ? error.message : String(error)});
            continue;
        }
        if (text === undefined || text.trim() === "") continue;
        const truncated = truncateUtf8(text, LIMIT_BYTES);
        const body = truncated === null ? text : `${truncated}\n\n[文件超过 32 KiB，这里只有开头，全文读 ${uri}]`;
        parts.push(`<${tag} source="${uri}">\n${body}\n</${tag}>`);
    }
    return parts.length === 0 ? [] : ["下面是作者写的说明，优先于上面的工作习惯。", ...parts];
}

export function rulesOpening(report: Parameters<typeof loadRules>[1]): AgentExtensionImplementation {
    return opening({id: RULES_EXTENSION, load: ({resources}) => loadRules(resources, report)});
}
