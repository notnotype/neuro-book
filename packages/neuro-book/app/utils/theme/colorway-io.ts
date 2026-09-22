import type {ProductAppearance} from "nbook/shared/theme/theme-axes";
import {productAppearances} from "nbook/shared/theme/theme-axes";
import {MAX_USER_COLORWAY_LABEL_LENGTH} from "nbook/shared/theme/user-colorway";
import {checkColorwayVarValue, colorwayVarKeys} from "nbook/app/utils/theme/colorway-vars";

/**
 * 用户配色的文件格式（导入 / 导出）。
 *
 * 一份自包含的 JSON：**不带 id**。id 是这台机器上这份配置的主键，导入到别处没有意义，
 * 带上只会制造「同一个 id 对应两套取值」的冲突；导入方每次都生成新 id。
 * `schema` + `kind` 两个字段是给「将来别的 JSON 文件被拖进来」准备的拒收依据。
 *
 * 导出用「用户存下来的取值」而不是「解析后的全量取值」：后者会把 `color-mix()` 这类派生写法
 * 固化成具体颜色，导出再导入就悄悄改掉了一套配色的构成方式。
 */
export const COLORWAY_FILE_KIND = "nb-colorway";
export const COLORWAY_FILE_SCHEMA = 1;

export type ColorwayFilePayload = {
    label: string;
    appearance: ProductAppearance;
    vars: Record<string, string>;
};

export function buildColorwayFileJson(payload: ColorwayFilePayload): string {
    return `${JSON.stringify({
        schema: COLORWAY_FILE_SCHEMA,
        kind: COLORWAY_FILE_KIND,
        label: payload.label,
        appearance: payload.appearance,
        vars: payload.vars,
    }, null, 2)}\n`;
}

export type ColorwayFileParseResult =
    | {ok: true; payload: ColorwayFilePayload}
    | {ok: false; messageKey: string; variableName?: string};

const IMPORT_INVALID_JSON = "settings.frontend.colorwayImportInvalidJson";
const IMPORT_SCHEMA_MISMATCH = "settings.frontend.colorwayImportSchemaMismatch";
const IMPORT_INVALID_VALUE = "settings.frontend.colorwayImportInvalidValue";
const IMPORT_EMPTY = "settings.frontend.colorwayImportEmpty";

/**
 * 解析并校验导入的配色 JSON。
 *
 * 与「读配置文件」那条路刻意不同：配置文件里的坏值一律静默丢弃（用户没做任何操作，
 * 不该被打扰），而导入是**用户刚刚按下的动作**，坏文件必须当场说清坏在哪——
 * 报变量名而不是只说「格式不对」，因为一个 33 行的文件里找一处笔误靠猜是找不到的。
 */
export function parseColorwayFileJson(text: string): ColorwayFileParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {ok: false, messageKey: IMPORT_INVALID_JSON};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {ok: false, messageKey: IMPORT_SCHEMA_MISMATCH};
    }
    const source = parsed as Record<string, unknown>;
    if (source.schema !== COLORWAY_FILE_SCHEMA || source.kind !== COLORWAY_FILE_KIND) {
        return {ok: false, messageKey: IMPORT_SCHEMA_MISMATCH};
    }
    const label = typeof source.label === "string" ? source.label.trim() : "";
    if (!label || label.length > MAX_USER_COLORWAY_LABEL_LENGTH) {
        return {ok: false, messageKey: IMPORT_SCHEMA_MISMATCH};
    }
    const appearance = source.appearance;
    if (typeof appearance !== "string" || !(productAppearances as readonly string[]).includes(appearance)) {
        return {ok: false, messageKey: IMPORT_SCHEMA_MISMATCH};
    }
    if (!source.vars || typeof source.vars !== "object" || Array.isArray(source.vars)) {
        return {ok: false, messageKey: IMPORT_SCHEMA_MISMATCH};
    }

    const vars: Record<string, string> = {};
    for (const [name, value] of Object.entries(source.vars as Record<string, unknown>)) {
        // 不在配色契约里的键直接忽略：文件可能来自更新的 nb-ui，多出来的键不该让导入失败
        if (!colorwayVarKeys.includes(name) || typeof value !== "string") {
            continue;
        }
        if (checkColorwayVarValue(name, value) !== null) {
            return {ok: false, messageKey: IMPORT_INVALID_VALUE, variableName: name};
        }
        vars[name] = value.trim();
    }
    if (Object.keys(vars).length === 0) {
        return {ok: false, messageKey: IMPORT_EMPTY};
    }
    return {ok: true, payload: {label, appearance: appearance as ProductAppearance, vars}};
}

/** 导出文件名：把展示名压成安全的短名，导出两次不会互相覆盖的前提是名字不同。 */
export function colorwayFileName(label: string): string {
    const slug = label.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return `${slug || "colorway"}.colorway.json`;
}
