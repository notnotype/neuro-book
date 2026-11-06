/**
 * 项目规则文件（docs/specs/agent/permissions.md 输出 6）。`.nbook/` 是控制目录，文件服务不给 Agent 看（`protected-path`）：规则是宿主
 * 自己读，从项目根的真实路径读。钩子每次判定读，设置页打开时读，两边看到的是同一份。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {Value} from "typebox/value";

import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import {RulesSchema} from "../../shared/permissions";
import type {Rule} from "../../shared/permissions";

export async function readProjectRules(files: WorkspaceFiles, project: string | undefined, signal?: AbortSignal): Promise<Rule[] | "invalid"> {
    if (project === undefined) return [];
    const root = await files.readPath(`projects://${project}`, signal === undefined ? {} : {signal});
    if (!root.ok) return "invalid";
    let text: string;
    try {
        text = await readFile(join(root.value.path, ".nbook", "permissions.json"), "utf8");
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : "invalid";
    }
    try {
        const parsed: unknown = JSON.parse(text);
        return Value.Check(RulesSchema, parsed) ? parsed : "invalid";
    } catch {
        return "invalid";
    }
}
