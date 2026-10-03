/**
 * 用户自定义配色（配色轴的用户侧扩展）的**形状契约**。
 *
 * 放在 shared 层而不是 app 层，理由与 `theme-axes.ts` 相同：server 侧的配置 schema、
 * normalizer 与 route meta 都要用同一份约束，而 nb-ui 的配色包会拉 `vue`，
 * 配置服务不该为了一个键白名单去装整个库。
 *
 * 这里**只放不认识具体变量取值的规则**（形状 / 长度 / 字符集）。具体 33 个配色变量的
 * 白名单与「这个值到底是不是合法颜色」的判定在 `app/utils/theme/colorway-vars.ts`——
 * 那件事要求助浏览器（`CSS.supports`），Node 里做不了也不该假装做得了。
 *
 * 分工的落点：
 * · 服务端只保证**存进去的形状不坏**（键名合法、值不越界、条数有上限），读到不认识的值一律忽略；
 * · 客户端负责**能不能用**：契约白名单过滤、颜色/长度校验、无效 id 回落内置配色。
 */

/** 用户配色 id 前缀。与老体系同名，主题自带配色永远不会用到这个前缀，因此两类 id 不可能撞车。 */
export const USER_COLORWAY_ID_PREFIX = "custom-";

/** 用户配色 id：前缀 + 小写字母数字与连字符，且不以连字符结尾。 */
export const USER_COLORWAY_ID_PATTERN = /^custom-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * 内置/主题自带配色 id 的形状。
 *
 * 服务端**只校验形状**：具体有哪些配色由主题包给出（`manifest.defaultColorway` 与
 * 各主题自带的 colorways），而主题包 `import "./vars.css"`，Node 侧装不进它们。
 * 于是「这个 id 真的存在吗」只能由客户端在应用时回答——答不上来就回落内置配色，
 * 不报错、不清库。这是三条职责里唯一一处服务端故意放手的。
 */
export const COLORWAY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** 配色 id 的长度上限，与 DTO 里的一致：超长的东西不是 id。 */
export const MAX_COLORWAY_ID_LENGTH = 64;

/** 用户配色条数上限。够用且不至于让一次配置写入变得很大。 */
export const MAX_USER_COLORWAYS = 20;

/** 展示名长度上限（按字符计）。 */
export const MAX_USER_COLORWAY_LABEL_LENGTH = 40;

/** 单个变量取值的长度上限。最长的合法取值是 color-mix 字面串，远低于此。 */
export const MAX_COLORWAY_VAR_VALUE_LENGTH = 120;

/** 变量名形状：CSS 自定义属性。 */
export const COLORWAY_VAR_NAME_PATTERN = /^--[a-z0-9-]+$/;

/**
 * 取值的**结构性**底线：非空、不含控制字符、不含 `;` `{` `}`。
 *
 * 这不是颜色合法性检查（那是客户端的 CSS.supports），而是「这一串东西不能是别的 CSS 语句」
 * 的底线。用户配色的取值最终走 `style.setProperty`，注入本身不可能，但拒绝坏值仍然要有门槛：
 * 一条 `red; background: url(...)` 落在配置里，任何将来改成字符串拼接的消费点都会中招。
 */
export const COLORWAY_VAR_VALUE_PATTERN = /^[^\u0000-\u001f\u007f;{}]+$/;

/** 用户配色的持久化形状。vars 只存「用户改过的**全部**变量」，缺失键在应用时逐键兜底。 */
export type UserColorwayConfig = {
    id: string;
    label: string;
    appearance: "light" | "dark";
    vars: Record<string, string>;
};

/** 形状判定：id 合法、标签非空、明暗合法。 */
export function isUserColorwayId(value: unknown): boolean {
    return typeof value === "string" && USER_COLORWAY_ID_PATTERN.test(value.trim());
}

/** 单个变量名是否可被用户配色持有。 */
export function isColorwayVarName(value: unknown): boolean {
    return typeof value === "string" && COLORWAY_VAR_NAME_PATTERN.test(value);
}

/** 单个变量取值是否通过结构性底线（长度 / 控制字符 / 语句分隔符）。 */
export function isStructurallySafeColorwayVarValue(value: unknown): boolean {
    return typeof value === "string"
        && value.trim().length > 0
        && value.trim().length <= MAX_COLORWAY_VAR_VALUE_LENGTH
        && COLORWAY_VAR_VALUE_PATTERN.test(value.trim());
}

/**
 * 过滤一张变量表：留下「名字合法 + 取值过底线」的项，其余丢弃（不报错）。
 *
 * 输入来自配置文件或导入的 JSON，两边都可能是任意东西，所以这里不看具体变量白名单——
 * 那一步在客户端（`colorway-vars.ts`），它会顺带把不在配色契约里的键丢掉。
 */
export function sanitizeColorwayVars(input: unknown): Record<string, string> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
        if (!isColorwayVarName(name) || !isStructurallySafeColorwayVarValue(value)) {
            continue;
        }
        out[name] = (value as string).trim();
    }
    return out;
}

/**
 * 新的用户配色 id。
 *
 * 用 `Date.now()` + 随机后缀而不是自增序号：自增要读全表找下一个空位，删除后再新建
 * 会复用旧 id，而旧 id 可能还留在别处的配置快照里。带上 `existing` 只是兜底去重。
 */
export function createUserColorwayId(existing: readonly string[] = []): string {
    const taken = new Set(existing);
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const id = `${USER_COLORWAY_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        if (!taken.has(id)) {
            return id;
        }
    }
    return `${USER_COLORWAY_ID_PREFIX}${Date.now().toString(36)}-overflow`;
}
