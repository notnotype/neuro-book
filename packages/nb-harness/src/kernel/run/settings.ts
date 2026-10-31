/**
 * `changeSettings` 的校验（docs/specs/harness/runtime.md 输出 31）：补丁按扩展 id 分组，核心设置组是 `core`；
 * 整体校验，有一项不合法就都不改。扩展的组按它 `settings` schema 里那一项校验。
 */

import {Value} from "typebox/value";
import type {JsonValue} from "../api/index.js";
import type {Assembly} from "../extension/assemble.js";

/** 核心设置的每一项：值的 JSON Schema。 */
const CORE_SETTINGS: Readonly<Record<string, object>> = {
    model: {anyOf: [{type: "string", minLength: 1}, {type: "null"}]},
    effort: {anyOf: [{type: "string", minLength: 1}, {type: "null"}]},
    approvalMode: {enum: ["ask", "allow-writes", "auto", "yolo"]},
    readOnly: {type: "boolean"},
};

export type SettingsProblem =
    | {readonly code: "unknown-extension"; readonly extension: string}
    | {readonly code: "unknown-key"; readonly extension: string; readonly key: string}
    | {readonly code: "invalid-value"; readonly extension: string; readonly key: string; readonly message: string};

export function settingsProblem(assembly: Assembly, patch: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>): SettingsProblem | null {
    for (const [extension, values] of Object.entries(patch)) {
        let schemas: Readonly<Record<string, object>>;
        if (extension === "core") schemas = CORE_SETTINGS;
        else {
            const item = assembly.order.find((entry) => entry.definition.id === extension);
            if (item === undefined) return {code: "unknown-extension", extension};
            schemas = (item.definition.settings as {properties?: Record<string, object>} | undefined)?.properties ?? {};
        }
        for (const [key, value] of Object.entries(values)) {
            const schema = schemas[key];
            if (schema === undefined) return {code: "unknown-key", extension, key};
            if (!Value.Check(schema as never, value)) {
                const first = [...Value.Errors(schema as never, value)][0] as {message?: string} | undefined;
                return {code: "invalid-value", extension, key, message: first?.message ?? "invalid value"};
            }
        }
    }
    return null;
}
