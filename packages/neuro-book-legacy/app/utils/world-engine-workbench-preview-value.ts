import type {WorkbenchJsonValue} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

export type WorkbenchPreviewParsedValue = {
    error: string;
    ok: false;
} | {
    ok: true;
    value: WorkbenchJsonValue;
};

/** 将 mutation / state value 压成适合单行输入与表格展示的文本。 */
export function formatWorkbenchPreviewValue(value: WorkbenchJsonValue | undefined): string {
    if (value === undefined) {
        return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
}

/** 将 Mutation Editor 文本草稿解析成 JSON 值；JSON-like 输入必须是合法 JSON。 */
export function parseWorkbenchPreviewMutationValue(text: string): WorkbenchPreviewParsedValue {
    const trimmed = text.trim();
    if (!trimmed) {
        return {ok: true, value: ""};
    }
    if (/^(?:\{|\[|"|-?\d|true$|false$|null$)/.test(trimmed)) {
        try {
            return {ok: true, value: JSON.parse(trimmed) as WorkbenchJsonValue};
        } catch {
            return {
                ok: false,
                error: "value 看起来像 JSON，但不是合法 JSON",
            };
        }
    }
    return {ok: true, value: text};
}
