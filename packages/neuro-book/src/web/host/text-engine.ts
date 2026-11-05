/**
 * 宿主的翻译引擎（docs/specs/ui/i18n.md 输出 3 到 7、9、10）：外面包一层 i18next，拦住它不合用的默认行为。
 *
 * - 每个窗口一个 `createInstance`，不用全局单例：测试同进程跑多个文件时全局实例会串。
 * - 回退链自己走（当前语言 → 命名空间的源语言 → en-US → 键名）：i18next 的 `fallbackLng` 只认语言，表达不了“插件
 *   自己的源语言”，所以关掉它，每一级用 `exists` 探。
 * - `nsSeparator: false`：只经选项传命名空间不够，i18next 仍会先从键里解析 `ns:`（t02 原型与提案审查实测）。
 * - nesting 的前后缀设成目录里不会出现的控制字符，等于关掉 `$t(…)`；目录检查另外拒绝 `$t(`。
 * - 不转义插值：交给 Vue。
 * - 插值参数放进 `replace`，不摊进 `t` 的选项：参数名叫 `context`、`ns`、`lng`、`lngs` 时，摊开会被 i18next 当成控制项
 *   （换命名空间、取上下文形，`lngs` 还会抛错）。`count` 另放顶层，i18next 只从顶层取它选复数形。
 * - `number` 格式只格式化数字，字符串原样：内置的会把 `"1234567"` 也格式化（`"abc"` 得 `NaN`），最小实现不会（输出 6、9）。
 */

import i18next from "i18next";
import type {i18n as I18n} from "i18next";
import {shallowRef} from "vue";

import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "@notnotype/nb-agent-ui/locales";
import {NB_FORM_CATALOGS, NB_FORM_NAMESPACE} from "@notnotype/nb-form/locales";
import {NB_LAYOUT_CATALOGS, NB_LAYOUT_NAMESPACE} from "@notnotype/nb-layout/locales";
import {NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE} from "@notnotype/nb-markdown/locales";
import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {isLocaleMap, isTextRef, resolveLocaleMap, sanitizeParams} from "@notnotype/nb-ui/text";
import type {Catalog, ReportTextProblem, Text, TextParams, TextProblem} from "@notnotype/nb-ui/text";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {HOST_LOCALES} from "nbook/shared/host-locales";
import type {WindowText} from "nbook/shared/window-text";

import {HOST_NAMESPACE} from "../host-text";
import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export interface TextEngineOptions {
    /** 启动时的语言（本地记录或缺省）。 */
    readonly locale: string;
    /** 测试环境为 true：缺键、缺插值参数时抛错。 */
    readonly strict?: boolean;
    readonly report?: ReportTextProblem;
    /** `setLocale` 带 `remember` 时调用，由宿主写本地记录。 */
    readonly remember?: (tag: string) => void;
}

const NESTING_OFF = "\u0000";

export function createTextEngine(options: TextEngineOptions): WindowText {
    const supported = new Set(HOST_LOCALES.map((locale) => locale.tag));
    const locale = shallowRef(supported.has(options.locale) ? options.locale : "zh-CN");
    // 目录增删也要让渲染期的 t() 重新求值：组件读这个版本号建立依赖。
    const version = shallowRef(0);
    const sources = new Map<string, string>();
    const languages = new Map<string, ReadonlySet<string>>();

    const reported = new Set<string>();
    const report = (problem: TextProblem): void => {
        const id = `${problem.kind}\u0000${problem.ns ?? ""}\u0000${problem.key}\u0000${problem.param ?? ""}`;
        if (reported.has(id)) return;
        reported.add(id);
        options.report?.(problem);
    };

    // 缺插值参数的回调拿不到键，翻译时把当前键放在这里。
    let current: {readonly ns: string | undefined; readonly key: string} = {ns: undefined, key: ""};
    const i18n: I18n = i18next.createInstance();
    void i18n.init({
        lng: locale.value,
        fallbackLng: false,
        resources: {},
        initAsync: false,
        nsSeparator: false,
        keySeparator: ".",
        returnNull: false,
        interpolation: {escapeValue: false, nestingPrefix: NESTING_OFF, nestingSuffix: NESTING_OFF},
        missingInterpolationHandler: (text: string, value: RegExpExecArray | null) => {
            const name = value?.[1]?.trim() ?? "";
            if (options.strict === true) throw new Error(`Missing text param "${name}" for key "${current.key}" in namespace "${current.ns ?? ""}"`);
            report({kind: "missing-param", ns: current.ns, key: current.key, param: name});
            return value?.[0] ?? text;
        },
    });
    // `initAsync: false` 时 init 同步完成，formatter 此时已建好。语言是正在探的那一级（`t` 选项里的 `lng`）。
    i18n.services.formatter?.addCached("number", (lng, formatOptions: Intl.NumberFormatOptions) => {
        const format = new Intl.NumberFormat(lng, formatOptions);
        return (value: unknown) => (typeof value === "number" ? format.format(value) : String(value));
    });

    const translateRef = (ns: string | undefined, key: string, rawParams: TextParams | undefined): string => {
        const params = sanitizeParams(rawParams, (param, kind) => report({kind, ns, key, param}));
        if (rawParams !== undefined && "count" in rawParams && typeof params["count"] !== "number") report({kind: "param-dropped", ns, key, param: "count"});
        const chain = [...new Set([locale.value, sources.get(ns ?? "") ?? "zh-CN", "en-US"])];
        const count = params["count"];
        const lookup = {ns: ns ?? "", ...(typeof count === "number" ? {count} : {}), replace: params};
        for (const lng of chain) {
            if (!i18n.exists(key, {...lookup, lng})) continue;
            current = {ns, key};
            return i18n.t(key, {...lookup, lng});
        }
        if (options.strict === true) throw new Error(`Missing text key "${key}" in namespace "${ns ?? ""}"`);
        report({kind: "missing-key", ns, key});
        return key;
    };

    const port: TextPort = {
        locale,
        t(text: Text): string {
            void version.value;
            if (typeof text === "string") return text;
            if (isTextRef(text)) return translateRef(text.ns, text.key, text.params);
            return isLocaleMap(text) ? resolveLocaleMap(text, locale.value) : "";
        },
        variants(text: Text): readonly string[] {
            void version.value;
            if (typeof text === "string") return [text];
            if (isLocaleMap(text)) return [...new Set(Object.values(text))];
            if (!isTextRef(text)) return [];
            const ns = text.ns ?? "";
            const found = [...(languages.get(ns) ?? [])].map((lng) => {
                const value: unknown = i18n.getResource(lng, ns, text.key) ?? i18n.getResource(lng, ns, `${text.key}_other`);
                return typeof value === "string" ? value : undefined;
            });
            return [...new Set(found.filter((value): value is string => value !== undefined))];
        },
    };

    const unregister = (ns: string): void => {
        for (const lng of languages.get(ns) ?? []) i18n.removeResourceBundle(lng, ns);
        languages.delete(ns);
        sources.delete(ns);
    };

    return {
        port,
        setLocale(tag, setOptions) {
            if (!supported.has(tag)) return;
            if (setOptions?.remember === true) options.remember?.(tag);
            if (tag === locale.value) return;
            locale.value = tag;
            void i18n.changeLanguage(tag);
        },
        register(ns, catalogs, source) {
            // addResourceBundle 即使 deep=false 也是浅合并（t02 原型）：先整个注销，旧键不会残留。
            unregister(ns);
            for (const [lng, catalog] of Object.entries(catalogs)) i18n.addResourceBundle(lng, ns, catalog satisfies Catalog, false, true);
            languages.set(ns, new Set(Object.keys(catalogs)));
            sources.set(ns, source);
            version.value += 1;
        },
        unregister(ns) {
            unregister(ns);
            version.value += 1;
        },
    };
}

/**
 * 宿主窗口用的引擎：在 `createTextEngine` 之上登记共享包的目录（`nb-ui`、`nb-agent-ui`、`nb-form`、`nb-layout`、`nb-markdown`）与宿主自己的目录（`nbook.host`），
 * 源语言都是 `zh-CN`。窗口缺省与浏览器引导都用它，页面和失败页才翻得出文字；插件的目录由各插件自己登记。共享包的
 * 组件读注入的端口，不用 nb-ui 的缺省端口，所以用到哪个共享包，就要在这里登记它的目录。
 */
export function createHostTextEngine(options: TextEngineOptions): WindowText {
    const text = createTextEngine(options);
    text.register(NB_UI_NAMESPACE, NB_UI_CATALOGS, "zh-CN");
    text.register(NB_AGENT_UI_NAMESPACE, NB_AGENT_UI_CATALOGS, "zh-CN");
    text.register(NB_FORM_NAMESPACE, NB_FORM_CATALOGS, "zh-CN");
    text.register(NB_LAYOUT_NAMESPACE, NB_LAYOUT_CATALOGS, "zh-CN");
    text.register(NB_MARKDOWN_NAMESPACE, NB_MARKDOWN_CATALOGS, "zh-CN");
    text.register(HOST_NAMESPACE, {"zh-CN": zhCN, "en-US": enUS}, "zh-CN");
    return text;
}
