/**
 * `nbook.models` 的消息目录与组件里取文字的函数（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的
 * `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎，命名空间是插件 id；文字引用的构造函数在 `shared/text.ts`。
 * 还有两页共用的几处措辞：失败原因、角色名、单价。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";
import type {BoundText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {builtinRoleNameKey, MODELS_TEXT_NAMESPACE} from "../shared/text";
import type {SnapshotModel, SnapshotRole} from "../shared/contracts";
import type {ModelsFailure} from "./models-store";
import {detailText} from "./models-store";

export const modelsCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

export type ModelsText = BoundText<typeof zhCN>;

/** 组件里取文字：`const text = useModelsText();` 然后 `text("rail.add")`。 */
export const useModelsText = (): ModelsText => usePluginText<typeof zhCN>(MODELS_TEXT_NAMESPACE);

const FAILURE_CODES = new Set(Object.keys(zhCN.failure));

/** 远程方法失败的原因，交给 `reportWriteFailure` 或原位显示。 */
export function failureReason(text: ModelsText, failure: ModelsFailure): string {
    const detail = detailText(failure.detail);
    if (!FAILURE_CODES.has(failure.code) || failure.code === "other") return text("failure.other", {code: failure.code});
    return text(`failure.${failure.code}` as "failure.other", {detail, code: failure.code});
}

type Role = Pick<SnapshotRole, "id" | "builtin" | "name" | "description">;

const BUILTIN = new Set(Object.keys(zhCN.roles.builtin));

/** 内置角色的名字与说明按界面语言给；用户改过名字（设置里写了）时用设置里的。 */
export function roleName(text: ModelsText, role: Role): string {
    const key = builtinRoleNameKey(role);
    if (key === null || !BUILTIN.has(role.id)) return role.name === "" ? role.id : role.name;
    return text(key as "roles.builtin.main.name");
}

export function roleDescription(text: ModelsText, role: Role): string {
    if (role.description !== "" || !role.builtin || !BUILTIN.has(role.id)) return role.description;
    return text(`roles.builtin.${role.id}.description` as "roles.builtin.main.description");
}

/** 单价：`null` 未知、输入与输出都是 0 为免费（决定 7）。 */
export function priceText(text: ModelsText, price: SnapshotModel["price"]): string {
    if (price === null) return text("models.priceUnknown");
    if (price[0] === 0 && price[1] === 0) return text("models.free");
    return text("models.price", {input: formatPrice(price[0]), output: formatPrice(price[1])});
}

const formatPrice = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(value < 1 ? 3 : 2).replace(/0+$/u, ""));

/** 上下文窗口写成“128K”“1M”。 */
export function tokensText(value: number): string {
    if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
    if (value >= 1000) return `${trim(value / 1000)}K`;
    return String(value);
}

const trim = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, ""));
