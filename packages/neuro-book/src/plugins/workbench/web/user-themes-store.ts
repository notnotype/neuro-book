/**
 * “我的主题”的 store（docs/specs/theme/editor.md）：Storage 用户记录 `user-themes` 在本窗口的投影。编辑器改它，主题目录读它的显示值，
 * 所以改动在保存确认前就已经在预览里（显示是乐观的）。另一个窗口保存的结果由 `adoptConfirmed` 采纳。
 *
 * 记录里的条目当“任意值”存：不合格的条目留在记录里原样保存，改别的主题时不丢它（见 `shared/user-themes.ts`）。
 */

import type {DeepReadonly} from "@vue/reactivity";

import {defineStore} from "nbook/shared/store/store";
import type {CommitResult} from "nbook/shared/store/store";

import {USER_THEMES_RECORD, userThemeProblem} from "../shared/user-themes";
import type {UserTheme, UserThemes} from "../shared/user-themes";

/** 修改拿到的是冻结的值、要返回可写的新值：先深拷贝一份再改。 */
const copyOf = (value: DeepReadonly<UserThemes>): UserThemes => structuredClone(value) as UserThemes;

const idOf = (entry: unknown): string | null => (typeof entry === "object" && entry !== null && typeof (entry as {id?: unknown}).id === "string" ? (entry as {id: string}).id : null);

export const userThemesStore = defineStore("user-themes", ({persist}) => {
    const themes = persist(USER_THEMES_RECORD, {initial: {themes: []}});
    return {
        state: {themes},
        actions: {
            /** 加一套；id 已存在时不加（调用方现生成 uuid，撞上只会是重放）。 */
            create: (theme: UserTheme): Promise<CommitResult> => themes.commit((value) => (value.themes.some((candidate) => idOf(candidate) === theme.id) ? copyOf(value) : {themes: [...copyOf(value).themes, theme]})),
            /** 一次加几套：一个提交点，要么都进要么都不进（导入用，免得写到一半留下半个包）。 */
            createMany: (added: ReadonlyArray<UserTheme>): Promise<CommitResult> => themes.commit((value) => {
                const copy = copyOf(value);
                const known = new Set(copy.themes.map(idOf));
                return {themes: [...copy.themes, ...added.filter((theme) => !known.has(theme.id))]};
            }),
            /** 改一套；没有这个 id、或这条本来就不合格时不动。 */
            update: (id: string, change: (theme: UserTheme) => UserTheme): Promise<CommitResult> => themes.commit((value) => ({
                themes: copyOf(value).themes.map((entry) => (idOf(entry) === id && userThemeProblem(entry) === null ? change(entry as UserTheme) : entry)),
            })),
            remove: (id: string): Promise<CommitResult> => themes.commit((value) => ({themes: copyOf(value).themes.filter((entry) => idOf(entry) !== id)})),
            /** 别的窗口保存了新值：没有本窗口排队的修改时采纳它，否则等本窗口的写完再说（排队清空时再调一次，见入口里的 watch）。 */
            adoptConfirmed: (): void => {
                if (themes.queue === 0) themes.adopt();
            },
            /**
             * 保存确定失败（超限、值不合法、读写出错）：队首与它后面排着的修改一起丢掉，显示回到已确认的值，免得这一套“看起来改了”、
             * 之后的修改又全被暂停的队首堵住。返回失败码（没有失败时为 null）。
             */
            discardFailed: (): string | null => {
                const {save} = themes;
                if (save.state !== "failed" && save.state !== "unknown") return null;
                themes.discardAll();
                return save.code;
            },
        },
    };
});

export type UserThemesStore = ReturnType<typeof userThemesStore.create>;
