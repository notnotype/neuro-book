/**
 * 费用显示区段的草稿与写回规则。
 *
 * 币种一半进配置（`ui.costCurrency`）、一半留在本地展示状态（汇率缓存）；这里只管配置那一半。
 * 读用 `effective`（继承后的实际值），写必须**整段回写 `ui`**：后端 `saveGlobalConfig`
 * 按整段替换，只写 `{costCurrency}` 会把 `themeId` 与 `appearance` 一起抹掉。
 */
import type {CostDisplayCurrency} from "nbook/app/utils/cost-format";
import type {ConfigEditorSnapshotDto, GlobalConfigDto, GlobalConfigUpdateDto} from "nbook/shared/dto/config.dto";

/** 更新 DTO 里的 ui 段形状（字段必填，缺省由后端 zod 的字段默认值补齐）。 */
type UiConfigUpdate = NonNullable<GlobalConfigUpdateDto["ui"]>;

/**
 * 从 ui 段读费用显示币种；只有显式配成 CNY 才算 CNY。
 */
export function readCostCurrency(ui: GlobalConfigDto["ui"]): CostDisplayCurrency {
    if (ui && typeof ui === "object" && !Array.isArray(ui) && "costCurrency" in ui && ui.costCurrency === "CNY") {
        return "CNY";
    }
    return "USD";
}

/**
 * 构造 Global Config 写回体：保留 `ui` 段里其它字段，只替换币种。
 *
 * 旧面板在这里会给缺失的主题字段补 `"sepia"` 与 `[]`，等于替用户选主题；
 * 新实现原样透传，缺省交给后端 `UiConfigDtoSchema` 的字段默认值（责任在 schema）。
 */
export function buildCostPayload(baseUi: GlobalConfigDto["ui"], currency: CostDisplayCurrency): GlobalConfigUpdateDto {
    return {
        ui: {
            ...baseUi,
            costCurrency: currency,
        } as UiConfigUpdate,
    };
}
