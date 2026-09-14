import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import type {ConfigEditorSnapshotDto, GlobalConfigUpdateDto} from "nbook/shared/dto/config.dto";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";

type ThemeAxesPatch = {
    themeId?: ProductThemeId;
    appearance?: ProductAppearance;
};

/**
 * 主题两轴的写入口：先本地应用（乐观），再写 Global Config；失败回滚并提示。
 *
 * 写回体 = 当前快照的 ui 段 + 本次改动，`costCurrency` 必须带上：服务端 zod 的
 * `.default("USD")` 会把缺字段补成 USD，直接提交 `{themeId, appearance}` 会把币种重置掉。
 */
export function useThemeSettings() {
    const configApi = useConfigApi();
    const notification = useNotification();
    const theme = useProductTheme();
    const {t} = useI18n();
    let saveRevision = 0;

    /**
     * 保存两轴。返回是否落盘成功；失败时本地状态恢复到调用前。
     */
    async function saveAxes(patch: ThemeAxesPatch): Promise<boolean> {
        const previous = {themeId: theme.themeId.value, appearance: theme.appearance.value};
        const revision = ++saveRevision;

        theme.setAxes(patch);

        try {
            const snapshot = await configApi.editorSnapshot();
            const base = snapshot.global ?? {};
            const saved: ConfigEditorSnapshotDto = await configApi.saveGlobal({
                ui: {
                    ...(base.ui ?? {}),
                    themeId: theme.themeId.value,
                    appearance: theme.appearance.value,
                    costCurrency: base.ui?.costCurrency ?? "USD",
                },
            } satisfies GlobalConfigUpdateDto);
            if (revision !== saveRevision) {
                return true;
            }
            // 以服务端归一化后的取值为准：那里才是「老值一律重置默认」的裁决点。
            theme.applyStoredAxes({themeId: saved.global.ui?.themeId, appearance: saved.global.ui?.appearance});
            return true;
        } catch (error) {
            if (revision === saveRevision) {
                theme.setAxes(previous);
            }
            notification.error(resolveApiErrorMessage(error, t("settings.frontend.themeSaveFailedMessage")), {
                title: t("settings.frontend.themeSaveFailed"),
            });
            return false;
        }
    }

    return {saveAxes};
}
