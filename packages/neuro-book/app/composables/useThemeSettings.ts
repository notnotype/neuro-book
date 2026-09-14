import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import type {UserColorwayInput} from "nbook/app/utils/theme/theme-session";
import type {UserColorwayConfig} from "nbook/shared/theme/user-colorway";
import type {ConfigEditorSnapshotDto, GlobalConfigUpdateDto, UserColorwayDto} from "nbook/shared/dto/config.dto";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";

type ThemeAxesPatch = {
    themeId?: ProductThemeId;
    appearance?: ProductAppearance;
    /** 显式选中的配色 id；`null` = 回到主题自带配色 */
    colorwayId?: string | null;
};

type ThemeUiSnapshot = {
    themeId: ProductThemeId;
    appearance: ProductAppearance;
    /** 空串 = 跟随主题（见 snapshotUi 里的说明） */
    colorwayId: string;
    userColorways: UserColorwayConfig[];
};

/**
 * 主题两轴 + 配色轴的写入口：先本地应用（乐观），再写 Global Config；失败回滚并提示。
 *
 * 写回体 = 当前快照的 ui 段 + 本次改动，`costCurrency` 必须带上：服务端 zod 的
 * `.default("USD")` 会把缺字段补成 USD，直接提交 `{themeId, appearance}` 会把币种重置掉。
 * `ui.userColorways` 是**整库替换**（服务端 registry 里 merge 也是 replace），所以本地状态
 * 即提交内容，不做增量 patch——两套配色库合并逻辑分居两端才是真正会漂移的那种设计。
 */
export function useThemeSettings() {
    const configApi = useConfigApi();
    const notification = useNotification();
    const theme = useProductTheme();
    const {t} = useI18n();
    let saveRevision = 0;

    function snapshotUi(): ThemeUiSnapshot {
        const effectiveColorwayId = theme.colorwayId.value;
        const themeDefaultId = theme.activeTheme.value?.manifest.defaultColorway?.[theme.appearance.value];
        return {
            themeId: theme.themeId.value,
            appearance: theme.appearance.value,
            // 落到主题自带的那套默认配色时写空串（= 跟随主题），而不是把它的 id 抄进配置：
            // 抄进去之后换主题还得靠客户端兜底，而「跟随主题」本来就是用户当时的选择。
            colorwayId: effectiveColorwayId === undefined || effectiveColorwayId === themeDefaultId ? "" : effectiveColorwayId,
            // 展开一层：选项里带着派生的 preview 字段，那不是配置的一部分
            userColorways: theme.userColorways.value.map((colorway) => ({
                id: colorway.id,
                label: colorway.label,
                appearance: colorway.appearance,
                vars: {...colorway.vars},
            })),
        };
    }

    /** 以服务端归一化后的取值为准：那里才是「老值一律重置默认」的裁决点。 */
    function applyPersistedUi(ui: ConfigEditorSnapshotDto["global"]["ui"] | undefined): void {
        theme.applyStoredAxes({themeId: ui?.themeId, appearance: ui?.appearance});
        theme.applyStoredColorways({colorwayId: ui?.colorwayId, userColorways: ui?.userColorways});
    }

    /**
     * 本地先改（`mutate` 返回 false 表示这次改动没有落地，直接放弃写盘），再整段写回 Global Config。
     *
     * 返回是否落盘成功；失败时本地状态恢复到调用前。
     */
    async function persistUi(mutate: () => boolean | void): Promise<boolean> {
        const previous = snapshotUi();
        const revision = ++saveRevision;
        if (mutate() === false) {
            return false;
        }

        try {
            const snapshot = await configApi.editorSnapshot();
            const base = snapshot.global ?? {};
            const current = snapshotUi();
            const saved: ConfigEditorSnapshotDto = await configApi.saveGlobal({
                ui: {
                    ...(base.ui ?? {}),
                    themeId: current.themeId,
                    appearance: current.appearance,
                    colorwayId: current.colorwayId,
                    userColorways: current.userColorways satisfies UserColorwayDto[],
                    costCurrency: base.ui?.costCurrency ?? "USD",
                },
            } satisfies GlobalConfigUpdateDto);
            if (revision !== saveRevision) {
                return true;
            }
            applyPersistedUi(saved.global.ui);
            return true;
        } catch (error) {
            if (revision === saveRevision) {
                theme.applyStoredAxes({themeId: previous.themeId, appearance: previous.appearance});
                theme.applyStoredColorways({colorwayId: previous.colorwayId, userColorways: previous.userColorways});
            }
            notification.error(resolveApiErrorMessage(error, t("settings.frontend.themeSaveFailedMessage")), {
                title: t("settings.frontend.themeSaveFailed"),
            });
            return false;
        }
    }

    /** 保存两轴（可含配色轴）。返回是否落盘成功。 */
    async function saveAxes(patch: ThemeAxesPatch): Promise<boolean> {
        return persistUi(() => theme.setAxes(patch));
    }

    /** 选中一套配色（`null` = 主题自带配色）。 */
    async function saveColorway(id: string | null): Promise<boolean> {
        return persistUi(() => theme.setColorway(id));
    }

    /** 新建 / 覆盖一套用户配色（含重命名）。返回它的 id；不合法时返回 null。 */
    async function saveUserColorway(input: UserColorwayInput): Promise<string | null> {
        let savedId: string | null = null;
        const applied = await persistUi(() => {
            savedId = theme.saveUserColorway(input);
            return savedId !== null;
        });
        return applied ? savedId : null;
    }

    /** 删除一套用户配色；删的是当前生效那套时回到主题自带配色。 */
    async function deleteUserColorway(id: string): Promise<boolean> {
        return persistUi(() => theme.deleteUserColorway(id));
    }

    return {saveAxes, saveColorway, saveUserColorway, deleteUserColorway};
}
