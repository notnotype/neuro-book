/**
 * 账号菜单里的“外观”一项（开发者 2026-11-27 看演示后加）：管理面板左下角与账号页右上角两处账号菜单共用。它是一个级联父项，
 * 子菜单是跟随系统、亮色、暗色三个单选项，当前的选择打勾。选中后由菜单所在的组件调 `theme.setAppearance`，存下由 `site.ts` 负责。
 */

import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {APPEARANCES} from "../host/theme";
import type {Appearance} from "../host/theme";
import type {SiteTextKey} from "../text";

/** 子菜单项的 id：`appearance:<明暗>`，与菜单里别的项（`account`、`sign-out` 等）分得开。 */
const ID_PREFIX = "appearance:";

const LABELS = {system: "account.appearance.system", light: "account.appearance.light", dark: "account.appearance.dark"} as const satisfies Record<Appearance, SiteTextKey>;

/** “外观”这一项；`t` 是站点目录的取字函数（`useSiteText()`），`current` 是现在的选择（`theme.appearance`）。 */
export function appearanceMenuItem(t: (key: SiteTextKey) => string, current: Appearance): DropdownMenuItemData {
    return {
        id: "appearance",
        label: t("account.appearance.title"),
        children: APPEARANCES.map((appearance) => ({
            id: `${ID_PREFIX}${appearance}`,
            label: t(LABELS[appearance]),
            type: "radio",
            group: "appearance",
            checked: appearance === current,
        })),
    };
}

/** 菜单发出的 id 是不是“外观”里的一项；是就回那一项的明暗，不是回 `undefined`。 */
export function selectedAppearance(id: string): Appearance | undefined {
    if (!id.startsWith(ID_PREFIX)) return undefined;
    const appearance = id.slice(ID_PREFIX.length);
    return APPEARANCES.find((candidate) => candidate === appearance);
}
