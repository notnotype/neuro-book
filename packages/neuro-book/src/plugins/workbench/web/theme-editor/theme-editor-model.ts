/**
 * 主题编辑器的模型（docs/specs/theme/editor.md）：一次编辑会话的状态与所有修改。界面只读它、调它的动作，自己不存声明的副本——
 * 声明在 Storage 的“我的主题”记录里，修改经 store 的乐观显示立刻回到这里，主题目录的预览也读同一份，所以改动在保存确认前就在工作台里。
 *
 * 配色里哪些项是手改过的记在条目的 `editor.touched`（`"<明暗>:<变量>"`）：推导整套时只填没手改过的项。
 */

import {computed, onScopeDispose, shallowRef, watchEffect} from "vue";

import {derivePalette, mirrorSeed} from "nbook/ui/theme/derive-palette";
import type {PaletteSeed} from "nbook/ui/theme/derive-palette";
import {checkContrast} from "nbook/ui/theme/contrast-checks";
import type {ContrastCheck} from "nbook/ui/theme/contrast-checks";

import type {ThemeDeclaration} from "../../shared/themes";
import type {CropCss, CropRegion} from "./crop-model";
import type {UserTheme} from "../../shared/user-themes";
import type {ThemeCatalog, ThemeEntry} from "../themes";
import type {UserThemesStore} from "../user-themes-store";

export type EditorSection = "basic" | "colors" | "fonts" | "chrome" | "scene" | "contrast";
export type Appearance = "light" | "dark";

/** 三个主色对应的变量：推导整套的输入。 */
export const SEED_KEYS = {background: "--bg-main", text: "--text-main", accent: "--accent-main"} as const;
export type SeedName = keyof typeof SEED_KEYS;

export interface ThemeEditorEnvironment {
    readonly store: UserThemesStore;
    readonly catalog: ThemeCatalog;
    /** 主题包在某个明暗下的缺省配色（`ui/theme/product-themes.ts` 的 `baseColors`）。 */
    readonly baseColors: (base: string, appearance: Appearance) => Readonly<Record<string, string>>;
    readonly newId: () => string;
}

type Look = ThemeDeclaration["light"];

const touchedKey = (appearance: Appearance, name: string): string => `${appearance}:${name}`;

/** 修改拿到冻结的条目：深拷贝出可写的，改完返回。 */
const edited = (theme: UserTheme, change: (draft: UserTheme) => void): UserTheme => {
    const draft = structuredClone(theme) as UserTheme;
    change(draft);
    return draft;
};

export class ThemeEditorModel {
    readonly #env: ThemeEditorEnvironment;
    readonly section = shallowRef<EditorSection>("basic");
    readonly appearance = shallowRef<Appearance>("light");
    readonly #selectedId = shallowRef<string | null>(null);

    /** 我的主题，按库里的顺序。 */
    readonly mine = computed(() => this.#env.store.state.themes.display.themes as ReadonlyArray<UserTheme>);
    readonly selectedId = computed(() => {
        const id = this.#selectedId.value;
        if (id !== null && this.mine.value.some((theme) => theme.id === id)) return id;
        return this.mine.value[0]?.id ?? null;
    });
    readonly current = computed(() => this.mine.value.find((theme) => theme.id === this.selectedId.value) ?? null);
    /** 库读完了没有；没读完时不显示“还没有主题”。 */
    readonly ready = computed(() => this.#env.store.state.themes.ready);
    readonly failure = computed(() => this.#env.store.state.themes.failure);

    /** 当前明暗下生效的配色：主题包缺省盖上声明里写的。 */
    readonly colors = computed((): Readonly<Record<string, string>> => {
        const theme = this.current.value;
        if (theme === null) return {};
        return {...this.#env.baseColors(theme.declaration.base, this.appearance.value), ...(theme.declaration[this.appearance.value].colors ?? {})};
    });
    readonly contrast = computed((): ReadonlyArray<ContrastCheck> => checkContrast(this.colors.value));
    /** 两套明暗里不合格的项，供“对比度检查”分区汇总。 */
    readonly failures = computed((): ReadonlyArray<{readonly appearance: Appearance; readonly check: ContrastCheck}> => {
        const theme = this.current.value;
        if (theme === null) return [];
        return (["light", "dark"] as const).flatMap((appearance) => checkContrast({...this.#env.baseColors(theme.declaration.base, appearance), ...(theme.declaration[appearance].colors ?? {})})
            .filter((check) => check.ok === false)
            .map((check) => ({appearance, check})));
    });

    constructor(env: ThemeEditorEnvironment) {
        this.#env = env;
        // 编辑器开着（这个模型活着）时，工作台用选中的主题与明暗预览；没有可编的主题时不覆盖。
        watchEffect(() => {
            const id = this.selectedId.value;
            env.catalog.setPreview(id === null ? null : {id, appearance: this.appearance.value});
        });
        onScopeDispose(() => this.dispose());
    }

    dispose(): void {
        this.#env.catalog.setPreview(null);
    }

    isTouched(name: string): boolean {
        return this.current.value?.editor?.touched.includes(touchedKey(this.appearance.value, name)) ?? false;
    }

    select(id: string): void {
        this.#selectedId.value = id;
    }

    // ---- 库 ----

    /** 新建：从主题包缺省配色起步，或复制目录里任一套（插件主题的场景图在这里不带，见复制素材）。返回新条目的 id。 */
    async create(from: ThemeEntry | null = null): Promise<string> {
        const id = `user:${this.#env.newId()}`;
        const base = from?.declaration.base ?? "nbook";
        const declaration: ThemeDeclaration = from === null
            ? {title: {"zh-CN": "新主题", "en-US": "New theme"}, base, light: {colors: {...this.#env.baseColors(base, "light")}}, dark: {colors: {...this.#env.baseColors(base, "dark")}}}
            : this.#copied(from.declaration);
        await this.#env.store.actions.create({id, declaration});
        this.#selectedId.value = id;
        return id;
    }

    #copied(declaration: ThemeDeclaration): ThemeDeclaration {
        const copy = structuredClone(declaration);
        delete copy.light.scene;
        delete copy.dark.scene;
        const title = typeof copy.title === "object" && "zh-CN" in copy.title ? copy.title : {"zh-CN": "副本", "en-US": "Copy"};
        return {...copy, title: {"zh-CN": `${String((title as Record<string, string>)["zh-CN"])} 副本`, "en-US": `${String((title as Record<string, string>)["en-US"] ?? (title as Record<string, string>)["zh-CN"])} copy`}};
    }

    /** 导入：把一份声明（素材已经写好、`scene` 已换成素材文件名）加进库里，选中它。 */
    async add(declaration: ThemeDeclaration): Promise<string> {
        const id = `user:${this.#env.newId()}`;
        await this.#env.store.actions.create({id, declaration});
        this.#selectedId.value = id;
        return id;
    }

    async duplicate(): Promise<string | null> {
        const theme = this.current.value;
        if (theme === null) return null;
        return this.create({id: theme.id, plugin: "user", declaration: theme.declaration});
    }

    async remove(): Promise<void> {
        const id = this.selectedId.value;
        if (id === null) return;
        await this.#env.store.actions.remove(id);
        this.#selectedId.value = null;
    }

    // ---- 修改 ----

    #update(change: (draft: UserTheme) => void): Promise<unknown> {
        const id = this.selectedId.value;
        return id === null ? Promise.resolve() : this.#env.store.actions.update(id, (theme) => edited(theme, change));
    }

    #look(draft: UserTheme): Look {
        return draft.declaration[this.appearance.value];
    }

    setTitle(language: "zh-CN" | "en-US", value: string): Promise<unknown> {
        return this.#update((draft) => {
            const title = typeof draft.declaration.title === "object" ? draft.declaration.title as Record<string, string> : {};
            draft.declaration.title = {"zh-CN": title["zh-CN"] ?? "", "en-US": title["en-US"] ?? "", [language]: value};
        });
    }

    setBase(base: ThemeDeclaration["base"]): Promise<unknown> {
        return this.#update((draft) => {
            draft.declaration.base = base;
        });
    }

    /** 手改一个配色变量：记为手改过，再推导时不覆盖。 */
    setColor(name: string, value: string): Promise<unknown> {
        const appearance = this.appearance.value;
        return this.#update((draft) => {
            const look = this.#look(draft);
            look.colors = {...look.colors, [name]: value};
            const touched = new Set(draft.editor?.touched ?? []);
            touched.add(touchedKey(appearance, name));
            draft.editor = {touched: [...touched]};
        });
    }

    /** 改一个主色：它是推导的输入，不算手改。 */
    setSeed(seed: SeedName, value: string): Promise<unknown> {
        return this.#update((draft) => {
            const look = this.#look(draft);
            look.colors = {...look.colors, [SEED_KEYS[seed]]: value};
        });
    }

    seeds(): PaletteSeed {
        const colors = this.colors.value;
        return {background: colors[SEED_KEYS.background] ?? "", text: colors[SEED_KEYS.text] ?? "", accent: colors[SEED_KEYS.accent] ?? "", appearance: this.appearance.value};
    }

    /** 由三个主色推导整套：只填没手改过的项；主色读不懂时什么都不做并返回 false。 */
    async derive(): Promise<boolean> {
        const palette = derivePalette(this.seeds());
        if (palette === null) return false;
        const appearance = this.appearance.value;
        await this.#update((draft) => {
            const touched = new Set(draft.editor?.touched ?? []);
            const look = this.#look(draft);
            const next: Record<string, string> = {...look.colors};
            for (const [name, value] of Object.entries(palette)) {
                if (touched.has(touchedKey(appearance, name)) || Object.values(SEED_KEYS).includes(name as never)) continue;
                next[name] = value;
            }
            look.colors = next;
        });
        return true;
    }

    /** 一项还原成推导值：去掉手改标记，写入由当前主色推出的值。 */
    async resetColor(name: string): Promise<boolean> {
        const palette = derivePalette(this.seeds());
        if (palette === null || !(name in palette)) return false;
        const appearance = this.appearance.value;
        await this.#update((draft) => {
            const look = this.#look(draft);
            look.colors = {...look.colors, [name]: palette[name as keyof typeof palette]};
            draft.editor = {touched: (draft.editor?.touched ?? []).filter((entry) => entry !== touchedKey(appearance, name))};
        });
        return true;
    }

    /** 从另一套明暗派生：把那一套的主色换算成当前明暗的主色再推导整套（当前明暗里手改过的项保留）。 */
    async deriveFromOther(): Promise<boolean> {
        const theme = this.current.value;
        if (theme === null) return false;
        const other: Appearance = this.appearance.value === "light" ? "dark" : "light";
        const colors = {...this.#env.baseColors(theme.declaration.base, other), ...(theme.declaration[other].colors ?? {})};
        const mirrored = mirrorSeed({background: colors[SEED_KEYS.background] ?? "", text: colors[SEED_KEYS.text] ?? "", accent: colors[SEED_KEYS.accent] ?? "", appearance: other}, this.appearance.value);
        if (mirrored === null) return false;
        await this.#update((draft) => {
            const look = this.#look(draft);
            look.colors = {...look.colors, [SEED_KEYS.background]: mirrored.background, [SEED_KEYS.text]: mirrored.text, [SEED_KEYS.accent]: mirrored.accent};
        });
        return this.derive();
    }

    setRoleVar(name: string, value: string | undefined): Promise<unknown> {
        return this.#update((draft) => {
            const look = this.#look(draft);
            const vars: Record<string, string> = {...look.vars};
            if (value === undefined || value === "") delete vars[name];
            else vars[name] = value;
            if (Object.keys(vars).length === 0) delete look.vars;
            else look.vars = vars;
        });
    }

    setFont(which: "display" | "prose", value: string): Promise<unknown> {
        return this.#update((draft) => {
            const fonts: {display?: string; prose?: string} = {...draft.declaration.fonts};
            if (value === "") delete fonts[which];
            else fonts[which] = value;
            if (Object.keys(fonts).length === 0) delete draft.declaration.fonts;
            else draft.declaration.fonts = fonts;
        });
    }

    /** 活动栏的一个字段；还没有活动栏声明时先用当前配色补全三个必填项。传 `undefined` 的 `ornament` 去掉装饰。 */
    setActivityBar(field: "surface" | "foreground" | "active" | "ornament", value: string | undefined): Promise<unknown> {
        const colors = this.colors.value;
        return this.#update((draft) => {
            const look = this.#look(draft);
            const bar = {surface: colors["--bg-sidebar"] ?? "#222222", foreground: colors["--text-main"] ?? "#eeeeee", active: colors["--accent-main"] ?? "#cc8800", ...look.activityBar};
            if (value === undefined || value === "") {
                if (field === "ornament") delete (bar as {ornament?: string}).ornament;
            } else {
                bar[field] = value;
            }
            look.activityBar = bar;
        });
    }

    removeActivityBar(): Promise<unknown> {
        return this.#update((draft) => {
            delete this.#look(draft).activityBar;
        });
    }

    setFrameLine(value: string | undefined): Promise<unknown> {
        return this.#update((draft) => {
            const look = this.#look(draft);
            if (value === undefined || value === "") delete look.frame;
            else look.frame = {line: value};
        });
    }

    // ---- 场景 ----

    /** 当前明暗的场景图：写素材文件名；`undefined` 去掉。 */
    setScene(name: string | undefined): Promise<unknown> {
        return this.#update((draft) => {
            const look = this.#look(draft);
            if (name === undefined) delete look.scene;
            else look.scene = name;
        });
    }

    /**
     * 一个位置的取景（两种明暗共用，写在声明的 `crop` 里）：空状态写位置，别的写大小与位置；`undefined` 清掉这个位置。
     * 空状态的内容中心 `contentX` 单独改，这里保留它。
     */
    setCrop(region: CropRegion, css: CropCss | undefined): Promise<unknown> {
        return this.#update((draft) => {
            const crop: NonNullable<ThemeDeclaration["crop"]> = {...draft.declaration.crop};
            if (css === undefined) {
                delete crop[region];
            } else if (region === "empty") {
                crop.empty = {...crop.empty, ...(css.position === undefined ? {} : {position: css.position})};
            } else if (css.size !== undefined && css.position !== undefined) {
                crop[region] = {size: css.size, position: css.position};
            }
            if (Object.keys(crop).length === 0) delete draft.declaration.crop;
            else draft.declaration.crop = crop;
        });
    }

    /** 空状态里内容中心在内容区宽度的比例（0.25 到 0.5）；`undefined` 去掉。 */
    setContentX(value: number | undefined): Promise<unknown> {
        return this.#update((draft) => {
            const crop: NonNullable<ThemeDeclaration["crop"]> = {...draft.declaration.crop};
            const empty = {...crop.empty};
            if (value === undefined) delete empty.contentX;
            else empty.contentX = Math.min(0.5, Math.max(0.25, value));
            if (Object.keys(empty).length === 0) delete crop.empty;
            else crop.empty = empty;
            if (Object.keys(crop).length === 0) delete draft.declaration.crop;
            else draft.declaration.crop = crop;
        });
    }
}
