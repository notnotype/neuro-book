import {applyColorway} from "@notnotype/nb-ui/colorway";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import type {ColorwayMeta} from "@notnotype/nb-ui/colorway";
import type {InstalledTheme} from "@notnotype/nb-ui/theme";
import {computed, readonly, ref} from "vue";
import type {ComputedRef, Ref} from "vue";
import {
    DEFAULT_PRODUCT_APPEARANCE,
    DEFAULT_PRODUCT_THEME_ID,
    productAppearances,
    productThemeIds,
    type ProductAppearance,
    type ProductThemeId,
} from "nbook/shared/theme/theme-axes";
import {createUserColorwayId, isUserColorwayId, MAX_USER_COLORWAYS, type UserColorwayConfig} from "nbook/shared/theme/user-colorway";
import {colorwaySwatchOf, filterColorwayContractVars, resolveUserColorwayVars} from "nbook/app/utils/theme/colorway-vars";
import {productThemeOptions, productThemes, type ProductThemeOption} from "nbook/app/utils/theme/theme-packs";

/**
 * 产品主题会话（两轴：主题包 × 配色明暗，外加配色轴的显式选择与用户配色库）。
 *
 * 这是产品侧**唯一**的主题状态与落地点：
 *
 * · 状态：`themeId`（nbook / macos）与 `appearance`（light / dark）。默认情况下具体配色 id 不落状态，
 *   它由当前主题包的 `manifest.defaultColorway[appearance]` 决定——各主题自带的配色是按自己的
 *   材料调的（macOS 玻璃在通用暗色下会发灰），所以「明暗」才是用户做选择的粒度。
 * · 配色轴的显式选择：用户选中某套具体配色（主题自带的另一套，或自己存的）时记在 `colorwayId`。
 *   它**不**取代明暗轴，而是与之保持一致：应用某套配色时 `appearance` 跟着它的明暗属性走
 *   （这是本模块的不变量：`appearance` 永远等于当前有效配色的明暗），于是刷新 / 删配色之后
 *   回落到的默认配色仍是正确的那一档。
 * · 用户配色库：`userColorways`。取值只管颜色，形状与合法性见 `shared/theme/user-colorway.ts`
 *   与 `app/utils/theme/colorway-vars.ts`；这里只负责「哪一套生效」与落 DOM。
 * · 落地点：`<html>`。主题包的取值写在 `:root[data-nb-theme="…"]`，配色变量又要在**声明处**
 *   完成代换（主题里大量 `color-mix(… var(--accent-main) …)`），所以属性和配色变量都必须落在
 *   文档根上，写页面根节点的话主题包整包选择器都匹配不到。
 * · 持久化：不在这里。Global Config 是唯一持久化（见 `useThemeSettings` 与
 *   `app/plugins/theme-colorway.client.ts`），本模块只管内存与 DOM。
 *
 * 模块层单例：主题是全局的，登录页 / 管理页 / 工作台共享同一份状态。
 */
const themeId = ref<ProductThemeId>(DEFAULT_PRODUCT_THEME_ID);
const appearance = ref<ProductAppearance>(DEFAULT_PRODUCT_APPEARANCE);
/** 显式选中的配色 id；null = 跟随主题（`manifest.defaultColorway[appearance]`） */
const colorwayId = ref<string | null>(null);
const userColorways = ref<UserColorwayConfig[]>([]);

const activeThemePack: ComputedRef<InstalledTheme | undefined> = computed(
    () => productThemes.find((theme) => theme.manifest.id === themeId.value),
);

const userColorwayById: ComputedRef<Map<string, UserColorwayConfig>> = computed(
    () => new Map(userColorways.value.map((colorway) => [colorway.id, colorway])),
);

/** 用户在设置里编辑的那一份（取值是**存下来的原文**，不是解析后的全量，导出才可往返）。 */
export type UserColorwayOption = UserColorwayConfig & {
    /** 卡片上的小色块。取解析后的底色，缺键时为空串（视图不画色块） */
    swatch: string;
};

export type UserColorwayInput = {
    /** 带了就是「改这一套」（含重命名），不带就是新建 */
    id?: string;
    label: string;
    appearance: ProductAppearance;
    vars: Record<string, string>;
};

/** 主题包按明暗给出的默认配色 id。装载器保证它存在（colorway-mismatch 会直接拒绝装载）。 */
function defaultColorwayIdFor(target: ProductAppearance): string | undefined {
    return activeThemePack.value?.manifest.defaultColorway?.[target];
}

function themeColorwayVars(id: string): NbColorwayVars | undefined {
    return activeThemePack.value?.colorways[id];
}

/** 某套配色在**当前主题**下的铺底取值：按它的明暗属性取主题自带的那一套。 */
function baseColorwayVars(target: ProductAppearance): NbColorwayVars | undefined {
    const fallbackId = defaultColorwayIdFor(target);
    return fallbackId === undefined ? undefined : themeColorwayVars(fallbackId);
}

/** 一套配色的展示信息与明暗归属：主题自带的优先，其次用户配色。 */
function colorwayMetaOf(id: string): ColorwayMeta | undefined {
    const themeMeta = activeThemePack.value?.colorwayMeta[id];
    if (themeMeta !== undefined) {
        return themeMeta;
    }
    const user = userColorwayById.value.get(id);
    return user === undefined ? undefined : {label: user.label, appearance: user.appearance};
}

/**
 * 当前生效的配色 id。
 *
 * 显式选择解析不了（换了主题、配色被删、配置里是别的机器上的 id）时**回落主题默认配色**，
 * 不报错也不改配置：用户没做错什么，只是那套配色在这套主题下不存在。
 */
const activeColorwayId: ComputedRef<string | undefined> = computed(() => {
    const explicit = colorwayId.value;
    if (explicit !== null && (themeColorwayVars(explicit) !== undefined || userColorwayById.value.has(explicit))) {
        return explicit;
    }
    return defaultColorwayIdFor(appearance.value);
});

const activeColorwayVars: ComputedRef<NbColorwayVars | undefined> = computed(() => {
    const id = activeColorwayId.value;
    if (id === undefined) {
        return undefined;
    }
    const themeVars = themeColorwayVars(id);
    if (themeVars !== undefined) {
        return themeVars;
    }
    const user = userColorwayById.value.get(id);
    return user === undefined ? undefined : resolveUserColorwayVars(user, baseColorwayVars(user.appearance));
});

/** 当前配色是否出自用户库（决定设置里给不给「编辑 / 删除」）。 */
const activeColorwayIsUser: ComputedRef<boolean> = computed(
    () => activeColorwayId.value !== undefined && userColorwayById.value.has(activeColorwayId.value),
);

/** 当前配色的展示名。主题包没给标签时退回 id——导出文件名与「另存为」的起点都要一个非空名字。 */
const activeColorwayLabel: ComputedRef<string> = computed(() => {
    const id = activeColorwayId.value;
    return id === undefined ? "" : (colorwayMetaOf(id)?.label ?? id);
});

const userColorwayOptions: ComputedRef<UserColorwayOption[]> = computed(() => userColorways.value.map((colorway) => ({
    ...colorway,
    swatch: colorwaySwatchOf(resolveUserColorwayVars(colorway, baseColorwayVars(colorway.appearance))),
})));

/**
 * 把两轴与配色落到文档根：`data-nb-theme` / `data-nb-appearance` / `colorScheme` + 配色变量。
 *
 * `style.colorScheme` 管浏览器原生 UI（滚动条、原生控件），`data-nb-appearance` 管主题分档——
 * 两者都必须写，且都取自**配色的明暗属性**而不是配色身份，理由见 nb-ui `colorway-store.ts`。
 *
 * 写变量这一步与 nb-ui 配色 store 同构（`applyColorway` 到 `<html>` 与 `<body>`）：
 * 产品与库共用一条落盘路径，不额外发明「先清后写」的第二套语义。
 */
function applyToDocument(): void {
    if (typeof document === "undefined") {
        return;
    }
    const root = document.documentElement;
    root.dataset.nbTheme = themeId.value;
    root.dataset.nbAppearance = appearance.value;
    root.style.colorScheme = appearance.value;

    const vars = activeColorwayVars.value;
    if (vars === undefined) {
        return;
    }
    applyColorway(root, vars);
    applyColorway(document.body, vars);
}

/** 两轴取值的白名单：老体系 id（sepia / tokyo-night / custom-*）与打错的值都落到默认。 */
const productThemeIdLookup: Record<string, true> = Object.fromEntries(productThemeIds.map((id) => [id, true]));
const productAppearanceLookup: Record<string, true> = Object.fromEntries(productAppearances.map((value) => [value, true]));

export type ProductThemeAxes = {
    themeId: ProductThemeId;
    appearance: ProductAppearance;
};

export type ProductThemeSession = {
    themeId: Readonly<Ref<ProductThemeId>>;
    appearance: Readonly<Ref<ProductAppearance>>;
    /** 当前主题包（nbook / macos），未装载时为 undefined */
    activeTheme: ComputedRef<InstalledTheme | undefined>;
    /** 当前配色 id（主题自带或用户配色；显式值解析不了时是主题默认） */
    colorwayId: ComputedRef<string | undefined>;
    /** 当前配色变量取值表，供 JS 侧需要具体颜色的地方（如 Monaco）读取 */
    colorwayVars: ComputedRef<NbColorwayVars | undefined>;
    /** 当前配色是否出自用户库 */
    colorwayIsUser: ComputedRef<boolean>;
    /** 当前配色的展示名 */
    colorwayLabel: ComputedRef<string>;
    /** 用户配色库（含解析后的预览色） */
    userColorways: ComputedRef<UserColorwayOption[]>;
    themes: readonly InstalledTheme[];
    themeOptions: readonly ProductThemeOption[];
    /** 设置两轴并落到 DOM。只改内存与文档，不写配置。 */
    setAxes: (next: Partial<ProductThemeAxes> & {colorwayId?: string | null}) => void;
    /**
     * 选中一套配色（`null` = 回到主题自带配色）。会同步明暗轴，只改内存与文档，不写配置。
     */
    setColorway: (id: string | null) => void;
    /** 新建 / 覆盖一套用户配色并即时生效。返回它的 id；取值不合法时返回 null。 */
    saveUserColorway: (input: UserColorwayInput) => string | null;
    /** 删除一套用户配色；删的是当前生效那套时回到主题自带配色。 */
    deleteUserColorway: (id: string) => boolean;
    /** 读持久化值：非法 / 缺失（含老字段、老 id）一律回落默认，不做映射。 */
    applyStoredAxes: (raw: {themeId?: unknown; appearance?: unknown}) => void;
    /** 读持久化值：配色轴。缺失 = 回到「跟随主题」+ 空配色库，坏条目静默丢弃。 */
    applyStoredColorways: (raw: {colorwayId?: unknown; userColorways?: unknown}) => void;
};

const session: ProductThemeSession = {
    themeId: readonly(themeId),
    appearance: readonly(appearance),
    activeTheme: activeThemePack,
    colorwayId: activeColorwayId,
    colorwayVars: activeColorwayVars,
    colorwayIsUser: activeColorwayIsUser,
    colorwayLabel: activeColorwayLabel,
    userColorways: userColorwayOptions,
    themes: productThemes,
    themeOptions: productThemeOptions,
    setAxes(next) {
        if (next.themeId !== undefined) {
            themeId.value = next.themeId;
        }
        // 「明暗」这一档说的就是主题自带的那两套配色，所以选明暗等于放弃显式选择。
        // 不这么做的话，明暗轴会在用户配色生效时变成一个按了没反应的按钮。
        if (next.appearance !== undefined) {
            appearance.value = next.appearance;
            if (next.colorwayId === undefined) {
                colorwayId.value = null;
            }
        }
        if (next.colorwayId !== undefined) {
            colorwayId.value = next.colorwayId;
            const meta = next.colorwayId === null ? undefined : colorwayMetaOf(next.colorwayId);
            if (meta !== undefined) {
                appearance.value = meta.appearance;
            }
        }
        applyToDocument();
    },
    setColorway(id) {
        setColorwaySelection(id);
    },
    saveUserColorway(input) {
        const label = input.label.trim();
        const vars = filterColorwayContractVars(input.vars);
        // 一套一个合法变量都没有的配色存了也是空壳：它会在任何主题下长得和默认配色一模一样，
        // 用户只会以为是坏了。宁可不存。
        if (!label || Object.keys(vars).length === 0) {
            return null;
        }
        const editing = input.id !== undefined && userColorwayById.value.has(input.id);
        if (!editing && userColorways.value.length >= MAX_USER_COLORWAYS) {
            return null;
        }
        const id = editing ? input.id as string : createUserColorwayId(userColorways.value.map((colorway) => colorway.id));
        const saved: UserColorwayConfig = {id, label, appearance: input.appearance, vars};
        const index = userColorways.value.findIndex((colorway) => colorway.id === id);
        if (index >= 0) {
            userColorways.value.splice(index, 1, saved);
        } else {
            userColorways.value.push(saved);
        }
        setColorwaySelection(id);
        return id;
    },
    deleteUserColorway(id) {
        const index = userColorways.value.findIndex((colorway) => colorway.id === id);
        if (index < 0) {
            return false;
        }
        userColorways.value.splice(index, 1);
        // 删掉正在用的那套：回到主题自带配色（明暗轴保持不动，于是落到同明暗的那一套）
        if (colorwayId.value === id) {
            colorwayId.value = null;
        }
        applyToDocument();
        return true;
    },
    applyStoredAxes(raw) {
        const storedThemeId = typeof raw.themeId === "string" ? raw.themeId : "";
        const storedAppearance = typeof raw.appearance === "string" ? raw.appearance : "";
        themeId.value = Object.hasOwn(productThemeIdLookup, storedThemeId)
            ? storedThemeId as ProductThemeId
            : DEFAULT_PRODUCT_THEME_ID;
        appearance.value = Object.hasOwn(productAppearanceLookup, storedAppearance)
            ? storedAppearance as ProductAppearance
            : DEFAULT_PRODUCT_APPEARANCE;
        applyToDocument();
    },
    applyStoredColorways(raw) {
        userColorways.value = normalizeStoredUserColorways(raw.userColorways);
        const storedId = typeof raw.colorwayId === "string" ? raw.colorwayId.trim() : "";
        const resolvable = storedId !== ""
            && (themeColorwayVars(storedId) !== undefined || userColorwayById.value.has(storedId));
        colorwayId.value = resolvable ? storedId : null;
        const meta = resolvable ? colorwayMetaOf(storedId) : undefined;
        if (meta !== undefined) {
            appearance.value = meta.appearance;
        }
        applyToDocument();
    },
};

/**
 * 选中一套配色：认不出来的 id **忽略**（视图不会给出这种 id，给了就是调用点写错了）。
 *
 * 选中的是主题自带的那套明暗默认值时，显式选择清成 null 而不是记下具体 id：
 * 这样换主题后仍然跟着新主题走，而不是停在上一个主题的配色 id 上。
 */
function setColorwaySelection(id: string | null): void {
    if (id === null) {
        colorwayId.value = null;
        applyToDocument();
        return;
    }
    const meta = colorwayMetaOf(id);
    if (meta === undefined) {
        return;
    }
    appearance.value = meta.appearance;
    colorwayId.value = defaultColorwayIdFor(meta.appearance) === id ? null : id;
    applyToDocument();
}

/** 配置里读到的用户配色：形状坏了的丢掉、契约外的键丢掉、取值不合法的键丢掉，都不报错。 */
function normalizeStoredUserColorways(raw: unknown): UserColorwayConfig[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<string>();
    const out: UserColorwayConfig[] = [];
    for (const entry of raw) {
        if (out.length >= MAX_USER_COLORWAYS) {
            break;
        }
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const candidate = entry as Partial<UserColorwayConfig>;
        const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
        const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
        const storedAppearance = typeof candidate.appearance === "string" ? candidate.appearance : "";
        if (!isUserColorwayId(id) || !label || seen.has(id) || !Object.hasOwn(productAppearanceLookup, storedAppearance)) {
            continue;
        }
        const vars = filterColorwayContractVars(candidate.vars);
        if (Object.keys(vars).length === 0) {
            continue;
        }
        seen.add(id);
        out.push({id, label, appearance: storedAppearance as ProductAppearance, vars});
    }
    return out;
}

/** 首次求值就把默认两轴落下去：配置还没读回来之前，界面也是完整的主题。 */
if (typeof document !== "undefined") {
    applyToDocument();
}

export function useProductTheme(): ProductThemeSession {
    return session;
}
