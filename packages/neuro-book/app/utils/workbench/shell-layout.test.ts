import {describe, expect, it} from "vitest";
import {
    createDefaultShellGrid,
    SHELL_LEFT_PANEL_DEFAULT_WIDTH,
    SHELL_LEFT_PANEL_MIN_WIDTH,
    SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO,
} from "nbook/app/utils/workbench/layout";
import {
    readShellPreferences,
    shellGridSnapshot,
    shellLayoutDefinition,
    shellRefResolver,
} from "nbook/app/utils/workbench/shell-layout";
import {GRID_LAYOUT_SCHEMA_VERSION} from "nbook/app/utils/workbench/storage-grid-host";
import {productStorageDefinitions} from "nbook/server/storage/product-definitions";
import {
    WORKBENCH_SHELL_DEFAULT_ACTIVITY_WIDTH,
    WORKBENCH_SHELL_DEFAULT_LAYOUT,
    WORKBENCH_SHELL_DEFAULT_TITLEBAR_HEIGHT,
    WORKBENCH_SHELL_LAYOUT_KEY,
    WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION,
} from "nbook/shared/storage/workbench-shell-layout";
import {
    WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
    WORKBENCH_LAYOUT_OWNER,
    WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
} from "nbook/shared/storage/workbench-state";

/**
 * 主工作台外壳布局记录的接线合同。
 *
 * 这些断言挡住的是真实的漂移：nb-ui 升快照版本、默认布局与 `createDefaultShellGrid` 分叉、
 * 记录地址改动、产品定义清单漏注册——任何一种都会让"真实应用里布局恢复/保存可用"不成立。
 */
describe("外壳布局记录：定义桥接与注册可达", () => {
    it("载荷版本与 t44 宿主接受的快照版本是同一份合同", () => {
        expect(WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION).toBe(GRID_LAYOUT_SCHEMA_VERSION);
        expect(shellLayoutDefinition.schemaVersion).toBe(GRID_LAYOUT_SCHEMA_VERSION);
    });

    it("记录地址：workbench.layout / layout / project-local 单例", () => {
        expect(shellLayoutDefinition).toMatchObject({
            owner: WORKBENCH_LAYOUT_OWNER,
            key: WORKBENCH_SHELL_LAYOUT_KEY,
            scope: "project",
            locality: "local",
            records: "single",
        });
    });

    it("默认布局与 createDefaultShellGrid 的默认拓扑逐节点一致", () => {
        const product = createDefaultShellGrid(1440, 900).serialize();
        expect(WORKBENCH_SHELL_DEFAULT_LAYOUT.version).toBe(product.version);
        expect(WORKBENCH_SHELL_DEFAULT_LAYOUT.root).toEqual(product.root);
        // 默认常量与外壳几何常量同源（叶宽公式与标题栏高度在 layout.ts 只声明一次）。
        expect(WORKBENCH_SHELL_DEFAULT_ACTIVITY_WIDTH).toBe(60);
        expect(WORKBENCH_SHELL_DEFAULT_TITLEBAR_HEIGHT).toBe(36);
    });

    it("产品默认尺寸只从共享常量读（左 340 / 右 400）", () => {
        expect(WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH).toBe(340);
        expect(WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH).toBe(400);
        expect(SHELL_LEFT_PANEL_DEFAULT_WIDTH).toBe(WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH);
        expect(SHELL_RIGHT_PANEL_DEFAULT_WIDTH).toBe(WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH);
    });

    it("引用解析只认登记的叶，并按当前视口给约束", () => {
        const wide = shellRefResolver(() => 1440);
        expect(wide("left")).toMatchObject({ref: "left", minimumSize: {width: SHELL_LEFT_PANEL_MIN_WIDTH}});
        expect(wide("unknown-leaf")).toBeNull();

        // 右栏上限随视口变化，按调用时读取：窄视口下上限落在兜底值 360。
        const narrow = shellRefResolver(() => 800);
        expect(narrow("right")?.maximumSize?.width).toBe(360);
        const wideRight = wide("right")?.maximumSize?.width ?? 0;
        expect(wideRight).toBe(Math.floor(1440 * SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO));
    });

    it("偏好读取：读树上左右的意图，叶缺失时回落产品默认", () => {
        const grid = createDefaultShellGrid(1440, 900);
        expect(readShellPreferences(grid)).toEqual({
            leftPanelWidth: SHELL_LEFT_PANEL_DEFAULT_WIDTH,
            agentPanelWidth: SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
        });

        const restored = createDefaultShellGrid(1440, 900);
        restored.restore(shellGridSnapshot(1440, {activity: 60, left: 512, editor: 526, right: 400, titlebar: 36, main: 864}, ["right"]), shellRefResolver(() => 1440));
        expect(readShellPreferences(restored).leftPanelWidth).toBe(512);
        expect(readShellPreferences(restored).agentPanelWidth).toBe(SHELL_RIGHT_PANEL_DEFAULT_WIDTH);
    });

    it("产品定义清单里注册了这条记录（服务端唯一注册入口）", () => {
        const registered = productStorageDefinitions();
        expect(registered.some((definition) => definition.owner === WORKBENCH_LAYOUT_OWNER
            && definition.key === WORKBENCH_SHELL_LAYOUT_KEY
            && definition.scope === "project")).toBe(true);
        // 同一 owner 的 user/local 记录与这条 project/local 记录各自存在。
        expect(registered.some((definition) => definition.owner === WORKBENCH_LAYOUT_OWNER
            && definition.scope === "user")).toBe(true);
    });
});
