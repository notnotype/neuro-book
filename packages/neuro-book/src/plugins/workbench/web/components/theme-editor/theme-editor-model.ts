/**
 * 主题编辑器的模型（docs/specs/theme/editor.md）：一次编辑会话的状态与所有修改。界面只读它、调它的动作，自己不存声明的副本——
 * 声明在 Storage 的“我的主题”记录里，修改经 store 的乐观显示立刻回到这里，主题目录的预览也读同一份，所以改动在保存确认前就在工作台里。
 *
 * 配色里哪些项是手改过的记在条目的 `editor.touched`（`"<明暗>:<变量>"`）：推导整套时只填没手改过的项。
 */

import {computed, onScopeDispose, shallowRef, watchEffect} from "vue";
import type {ShallowRef} from "vue";

import {createEditorState} from "./editor-state";
import type {Appearance, EditorSection, ThemeEditorState} from "./editor-state";

import {derivePalette, mirrorSeed} from "nbook/ui/theme/derive-palette";
import type {PaletteSeed} from "nbook/ui/theme/derive-palette";
import {checkContrast} from "nbook/ui/theme/contrast-checks";
import type {ContrastCheck} from "nbook/ui/theme/contrast-checks";

import type {ThemeDeclaration} from "../../../shared/themes";
import {userThemeProblem, validUserThemes} from "../../../shared/user-themes";
import {keepUserAssets} from "./assets";
import type {CropCss, CropRegion} from "./crop-model";
import type {UserTheme} from "../../../shared/user-themes";
import type {CommitResult} from "nbook/shared/store/store";
import type {ThemeCatalog, ThemeEntry} from "../../themes";
import type {UserThemesStore} from "../../user-themes-store";

/** 标题为空被拒绝时 `rejected` 的值；界面据此显示专门的文案。 */
export const TITLE_EMPTY = "title-empty";
/** 保存确定失败（超限、值不合法、读写出错）时 `rejected` 的前缀，后面跟失败码；这次改动已经撤回。 */
export const SAVE_FAILED = "save-failed:";


/** 三个主色对应的变量：推导整套的输入。 */
export const SEED_KEYS = {background: "--bg-main", text: "--text-main", accent: "--accent-main"} as const;
export type SeedName = keyof typeof SEED_KEYS;

export interface ThemeEditorEnvironment {
    readonly store: UserThemesStore;
    readonly catalog: ThemeCatalog;
    /** 主题包在某个明暗下的缺省配色（`ui/theme/product-themes.ts` 的 `baseColors`）。 */
    readonly baseColors: (base: string, appearance: Appearance) => Readonly<Record<string, string>>;
    readonly newId: () => string;
    /** 打开编辑器时正在用的明暗（`system` 已按系统换成亮或暗）：初始预览取它，不让暗色界面一打开就跳成亮色。 */
    readonly currentAppearance: () => Appearance;
}

export {createEditorState} from "./editor-state";
export type {Appearance, EditorSection, ThemeEditorState} from "./editor-state";

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
    readonly section: ShallowRef<EditorSection>;
    readonly appearance: ShallowRef<Appearance>;
    readonly #selectedId: ShallowRef<string | null>;
    /** 最近一次被拒绝或没能保存的修改的原因；下一次成功的修改清掉。界面据此显示“没有写入”。 */
    readonly rejected = shallowRef<string | null>(null);
    /** 预览哪种 Agent 状态的场景：`null` 跟随真实状态。只在模型里，不进会话保留的状态：每次打开编辑器都是跟随（docs/specs/theme/editor.md 输出 19）。 */
    readonly previewWorking = shallowRef<boolean | null>(null);

    /** 我的主题，按库里的顺序；记录里不合格的条目不在这里（它们留在记录里，只是不进列表也不进编辑器）。 */
    readonly mine = computed(() => validUserThemes(this.#env.store.state.themes.display.themes));
    readonly selectedId = computed(() => {
        const id = this.#selectedId.value;
        if (id !== null && this.mine.value.some((theme) => theme.id === id)) return id;
        return this.mine.value[0]?.id ?? null;
    });
    readonly current = computed(() => this.mine.value.find((theme) => theme.id === this.selectedId.value) ?? null);
    /** 当前已发布的场景提供者的贡献 id（响应式：发布与撤回会更新）。 */
    readonly sceneProviders = computed(() => this.#env.catalog.sceneProviders);
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
    /** 两套明暗各自的全部检查结果，供“对比度检查”分区逐项画样张。 */
    readonly contrastByAppearance = computed((): Readonly<Record<Appearance, ReadonlyArray<ContrastCheck>>> => {
        const theme = this.current.value;
        if (theme === null) return {light: [], dark: []};
        const checksFor = (appearance: Appearance): ReadonlyArray<ContrastCheck> => checkContrast({...this.#env.baseColors(theme.declaration.base, appearance), ...(theme.declaration[appearance].colors ?? {})});
        return {light: checksFor("light"), dark: checksFor("dark")};
    });
    /** 两套明暗里不合格的项，供角标、导出提示与分区的汇总。 */
    readonly failures = computed((): ReadonlyArray<{readonly appearance: Appearance; readonly check: ContrastCheck}> =>
        (["light", "dark"] as const).flatMap((appearance) => this.contrastByAppearance.value[appearance].filter((check) => check.ok === false).map((check) => ({appearance, check}))));

    constructor(env: ThemeEditorEnvironment, state: ThemeEditorState = createEditorState(env.currentAppearance())) {
        this.#env = env;
        this.section = state.section;
        this.appearance = state.appearance;
        this.#selectedId = state.selectedId;
        // 编辑器开着（这个模型活着）时，工作台用选中的主题与明暗预览；没有可编的主题时不覆盖。
        watchEffect(() => {
            const id = this.selectedId.value;
            const working = this.previewWorking.value;
            env.catalog.setPreview(id === null ? null : {id, appearance: this.appearance.value, ...(working === null ? {} : {working})});
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

    // ---- 提交的结果 ----

    /** 一次提交的结果：确定失败就撤回这次改动（含排在它后面的），原因记进 `rejected`；返回有没有成功。 */
    #settle(result: CommitResult): boolean {
        if (result === "failed" || result === "protected" || result === "unknown") {
            const code = this.#env.store.actions.discardFailed();
            this.rejected.value = `${SAVE_FAILED}${code ?? result}`;
            return false;
        }
        return true;
    }

    // ---- 库 ----

    /**
     * 新建：从主题包缺省配色起步，或复制目录里任一套。复制时标题加“副本”（`fromTitle` 是界面上现在显示的标题：插件主题的标题常是
     * 文字引用，解不出两种语言）；`copied` 是插件主题的素材已经复制成我的素材、路径已换成素材文件名的声明，给了就用它代替 `from`
     * 的声明。返回新条目的 id，没写成功时为 null。
     */
    async create(from: ThemeEntry | null = null, fromTitle?: string, copied?: ThemeDeclaration): Promise<string | null> {
        const id = `user:${this.#env.newId()}`;
        const base = from?.declaration.base ?? "nbook";
        const declaration: ThemeDeclaration = from === null
            ? {title: {"zh-CN": "新主题", "en-US": "New theme"}, base, light: {colors: {...this.#env.baseColors(base, "light")}}, dark: {colors: {...this.#env.baseColors(base, "dark")}}}
            : this.#copied(copied ?? from.declaration, fromTitle);
        if (!this.#settle(await this.#env.store.actions.create({id, declaration}))) return null;
        this.rejected.value = null;
        this.#selectedId.value = id;
        return id;
    }

    /**
     * 复制出的声明：标题加“副本”。素材只留“我的素材”写法的引用（文件名是内容摘要，用户主题的可以直接共用）；插件主题里的包内相对路径
     * 在用户层解析不了，要先由传输层复制成我的素材再传进来，没复制的就不带。
     */
    #copied(declaration: ThemeDeclaration, shown?: string): ThemeDeclaration {
        const copy = keepUserAssets(declaration);
        const title = copy.title as unknown;
        const both = typeof title === "object" && title !== null && "zh-CN" in title && "en-US" in title ? title as Record<string, string> : null;
        const zh = both?.["zh-CN"] ?? shown ?? (typeof title === "string" ? title : "");
        const en = both?.["en-US"] ?? shown ?? (typeof title === "string" ? title : "");
        return {...copy, title: {"zh-CN": zh === "" ? "副本" : `${zh} 副本`, "en-US": en === "" ? "Copy" : `${en} copy`}};
    }

    /** 导入：把几份声明（素材已经写好、`scene` 已换成素材文件名）一次加进库里，选中第一套。一个提交点：要么都进要么都不进。 */
    async addMany(declarations: ReadonlyArray<ThemeDeclaration>): Promise<boolean> {
        const added = declarations.map((declaration) => ({id: `user:${this.#env.newId()}`, declaration}));
        if (!this.#settle(await this.#env.store.actions.createMany(added))) return false;
        this.rejected.value = null;
        this.#selectedId.value = added[0]?.id ?? this.#selectedId.value;
        return true;
    }

    async duplicate(): Promise<string | null> {
        const theme = this.current.value;
        if (theme === null) return null;
        return this.create({id: theme.id, plugin: "user", declaration: theme.declaration});
    }

    async remove(): Promise<void> {
        const id = this.selectedId.value;
        if (id === null) return;
        if (!this.#settle(await this.#env.store.actions.remove(id))) return;
        this.#selectedId.value = null;
    }

    // ---- 修改 ----

    /**
     * 所有修改的入口：先在副本上改、过一遍“我的主题”的校验，不合格不写（原因记在 `rejected`）；写了再看提交结果，确定失败就撤回。
     * 目标主题与明暗都在动作发起时定下（`target`、`appearance` 参数，缺省取此刻的），提交排队、重放、跨 await 时都不再读界面上
     * 可变的“当前”：否则亮色下的修改在排队时切到暗色，会写进暗色并留下相反的手改标记。
     * 返回这次改动有没有真的写进去（被拒绝、目标已不在、提交失败都是 false，原因在 `rejected`）：上传素材后写声明的调用方据此决定显示成功还是保持原样。
     */
    async #update(change: (draft: UserTheme, appearance: Appearance) => void, target: string | null = this.selectedId.value, appearance: Appearance = this.appearance.value): Promise<boolean> {
        if (target === null) return false;
        const current = this.mine.value.find((theme) => theme.id === target);
        if (current === undefined) return false;
        const problem = this.#problemOf(edited(current, (draft) => change(draft, appearance)));
        this.rejected.value = problem;
        if (problem !== null) return false;
        const result = await this.#env.store.actions.update(target, (theme) => edited(theme, (draft) => change(draft, appearance)));
        return this.#settle(result);
    }

    #problemOf(theme: UserTheme): string | null {
        const title = theme.declaration.title;
        const names = typeof title === "object" && title !== null ? Object.values(title as Record<string, unknown>) : [title];
        if (names.every((name) => typeof name !== "string" || name.trim() === "")) return TITLE_EMPTY;
        return userThemeProblem(theme);
    }

    setTitle(language: "zh-CN" | "en-US", value: string): Promise<unknown> {
        return this.#update((draft) => {
            const title = draft.declaration.title as unknown;
            const known = typeof title === "object" && title !== null ? title as Record<string, string> : {};
            // 标题是字符串时它对两种语言都显示：改一种语言，另一种保留原来的字。
            const base = typeof title === "string" ? title : "";
            draft.declaration.title = {"zh-CN": known["zh-CN"] ?? base, "en-US": known["en-US"] ?? base, [language]: value};
        });
    }

    setBase(base: ThemeDeclaration["base"]): Promise<unknown> {
        return this.#update((draft) => {
            draft.declaration.base = base;
        });
    }

    /** 手改一个配色变量：记为手改过，再推导时不覆盖。 */
    setColor(name: string, value: string): Promise<unknown> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            look.colors = {...look.colors, [name]: value};
            const touched = new Set(draft.editor?.touched ?? []);
            touched.add(touchedKey(appearance, name));
            draft.editor = {touched: [...touched]};
        });
    }

    /** 改一个主色：它是推导的输入，不算手改。 */
    setSeed(seed: SeedName, value: string): Promise<unknown> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            look.colors = {...look.colors, [SEED_KEYS[seed]]: value};
        });
    }

    seeds(): PaletteSeed {
        const colors = this.colors.value;
        return {background: colors[SEED_KEYS.background] ?? "", text: colors[SEED_KEYS.text] ?? "", accent: colors[SEED_KEYS.accent] ?? "", appearance: this.appearance.value};
    }

    /** 由三个主色推导整套：除了手改过的项都填（主色里的文字色不够对比度时推导会调它，也要写回）；主色读不懂时什么都不做并返回 false。 */
    async derive(): Promise<boolean> {
        const palette = derivePalette(this.seeds());
        if (palette === null) return false;
        await this.#update((draft, appearance) => {
            const touched = new Set(draft.editor?.touched ?? []);
            const look = draft.declaration[appearance];
            const next: Record<string, string> = {...look.colors};
            for (const [name, value] of Object.entries(palette)) {
                if (touched.has(touchedKey(appearance, name))) continue;
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
        await this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            look.colors = {...look.colors, [name]: palette[name as keyof typeof palette]};
            draft.editor = {touched: (draft.editor?.touched ?? []).filter((entry) => entry !== touchedKey(appearance, name))};
        });
        return true;
    }

    /** 从另一套明暗派生：把那一套的主色换算成当前明暗的主色再推导整套（当前明暗里手改过的项保留）。 */
    async deriveFromOther(): Promise<boolean> {
        const theme = this.current.value;
        if (theme === null) return false;
        const appearance = this.appearance.value;
        const other: Appearance = appearance === "light" ? "dark" : "light";
        const colors = {...this.#env.baseColors(theme.declaration.base, other), ...(theme.declaration[other].colors ?? {})};
        const mirrored = mirrorSeed({background: colors[SEED_KEYS.background] ?? "", text: colors[SEED_KEYS.text] ?? "", accent: colors[SEED_KEYS.accent] ?? "", appearance: other}, appearance);
        if (mirrored === null) return false;
        await this.#update((draft, at) => {
            const look = draft.declaration[at];
            look.colors = {...look.colors, [SEED_KEYS.background]: mirrored.background, [SEED_KEYS.text]: mirrored.text, [SEED_KEYS.accent]: mirrored.accent};
        });
        return this.derive();
    }

    setRoleVar(name: string, value: string | undefined): Promise<unknown> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
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
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
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
        return this.#update((draft, appearance) => {
            delete draft.declaration[appearance].activityBar;
        });
    }

    setFrameLine(value: string | undefined): Promise<unknown> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            if (value === undefined || value === "") delete look.frame;
            else look.frame = {line: value};
        });
    }

    // ---- 场景 ----

    /** 一个明暗的场景图：写素材文件名；`undefined` 去掉。`target` 是发起时定下的主题与明暗（上传要几秒，期间用户可能切走）。 */
    setScene(name: string | undefined, target: {readonly id: string; readonly appearance: Appearance} | null = null): Promise<boolean> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            if (name === undefined) delete look.scene;
            else look.scene = name;
        }, target?.id ?? this.selectedId.value, target?.appearance ?? this.appearance.value);
    }

    /** 一个明暗的工作态场景（位图素材文件名）；`undefined` 去掉。目标在发起时定下，同 `setScene`。 */
    setWorkingScene(name: string | undefined, target: {readonly id: string; readonly appearance: Appearance} | null = null): Promise<boolean> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            if (name === undefined) delete look.workingScene;
            else look.workingScene = name;
        }, target?.id ?? this.selectedId.value, target?.appearance ?? this.appearance.value);
    }

    /** 场景提供者（`workbench.theme-scenes` 的贡献 id）；`undefined` 去掉。两种明暗共用，写在声明顶层。 */
    setSceneProvider(id: string | undefined): Promise<unknown> {
        return this.#update((draft) => {
            if (id === undefined || id === "") delete draft.declaration.sceneProvider;
            else draft.declaration.sceneProvider = id;
        });
    }

    // ---- 图标 ----

    /**
     * 一个图标的覆盖：写图标素材文件名；对已有的名字就是替换。`target` 是发起时定下的主题与明暗（上传要几秒，期间用户可能切走），
     * 图标名由调用方在同一时刻规范化后传入（首尾空白去掉）。图标名不合规则由 `userThemeProblem` 拒绝。
     */
    setIcon(iconName: string, assetName: string, target: {readonly id: string; readonly appearance: Appearance} | null = null): Promise<boolean> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            look.icons = {...look.icons, [iconName]: assetName};
        }, target?.id ?? this.selectedId.value, target?.appearance ?? this.appearance.value);
    }

    removeIcon(iconName: string, target: {readonly id: string; readonly appearance: Appearance} | null = null): Promise<unknown> {
        return this.#update((draft, appearance) => {
            const look = draft.declaration[appearance];
            const icons = {...look.icons};
            delete icons[iconName];
            if (Object.keys(icons).length === 0) delete look.icons;
            else look.icons = icons;
        }, target?.id ?? this.selectedId.value, target?.appearance ?? this.appearance.value);
    }

    /** 把当前明暗的图标整份复制到另一套明暗，覆盖它原有的。当前明暗没有图标时清空另一套。 */
    copyIconsToOther(): Promise<unknown> {
        return this.#update((draft, appearance) => {
            const other: Appearance = appearance === "light" ? "dark" : "light";
            const icons = draft.declaration[appearance].icons;
            if (icons === undefined) delete draft.declaration[other].icons;
            else draft.declaration[other].icons = {...icons};
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
