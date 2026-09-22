import {describe, expect, it} from "vitest";
import {
    createShellGrid,
    projectShell,
    SHELL_LEFT_PANEL_DEFAULT_WIDTH,
    SHELL_LEFT_PANEL_MIN_WIDTH,
    SHELL_PANEL_MIN_HEIGHT,
    SHELL_PANEL_COLLAPSED_HEIGHT,
    SHELL_PANEL_ID,
    SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO,
    SHELL_SIZE_DEFAULTS,
    SHELL_STATUSBAR_HEIGHT,
    SHELL_STATUSBAR_ID,
} from "nbook/app/utils/workbench/layout";
import {
    SHELL_PANEL_ALIGNMENTS,
    SHELL_PANEL_DEFAULTS,
    SHELL_PANEL_POSITIONS,
} from "nbook/app/utils/workbench/panel-state";
import {
    readShellPreferences,
    shellLayoutDefinition,
    shellRefResolver,
} from "nbook/app/utils/workbench/shell-layout";
import {GRID_LAYOUT_SCHEMA_VERSION} from "nbook/app/utils/workbench/storage-grid-host";
import {productStorageDefinitions} from "nbook/server/storage/product-definitions";
import {
    isWorkbenchPanelSize,
    isWorkbenchPanelSizeValue,
} from "nbook/shared/storage/workbench-panel-size";
import {
    WORKBENCH_PANEL_ALIGNMENTS,
    WORKBENCH_PANEL_POSITIONS,
} from "nbook/shared/storage/workbench-views";
import {
    WORKBENCH_SHELL_DEFAULT_ACTIVITY_WIDTH,
    WORKBENCH_SHELL_DEFAULT_LAYOUT,
    WORKBENCH_SHELL_DEFAULT_LAYOUT_VIEWPORT,
    WORKBENCH_SHELL_DEFAULT_PANEL_HEIGHT,
    WORKBENCH_SHELL_DEFAULT_STATUSBAR_HEIGHT,
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
 * 这些断言挡住的是真实的漂移：nb-ui 升快照版本、默认布局与纯几何的默认投影分叉、记录地址改动、
 * 产品定义清单漏注册、记录里的 panel 取值域与面板状态模块分家——任何一种都会让"真实应用里
 * 布局恢复/保存可用"不成立。
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

    it("默认布局与纯几何的默认投影逐节点一致（活动栏通高、面板在编辑区下方）", () => {
        const product = defaultProjectionSnapshot();
        expect(WORKBENCH_SHELL_DEFAULT_LAYOUT.version).toBe(product.version);
        expect(WORKBENCH_SHELL_DEFAULT_LAYOUT.root).toEqual(product.root);

        // 默认常量与外壳几何常量同源（叶宽公式与高度在 layout.ts 只声明一次）。
        expect(WORKBENCH_SHELL_DEFAULT_ACTIVITY_WIDTH).toBe(60);
        expect(WORKBENCH_SHELL_DEFAULT_TITLEBAR_HEIGHT).toBe(36);
        expect(WORKBENCH_SHELL_DEFAULT_PANEL_HEIGHT).toBe(200);
        expect(WORKBENCH_SHELL_DEFAULT_STATUSBAR_HEIGHT).toBe(22);

        // 默认拓扑：root V{titlebar, main H{activity, body H{left, panel-stack V{editor, panel}, right}}, statusbar}。
        const root = WORKBENCH_SHELL_DEFAULT_LAYOUT.root;
        expect(childIds(root)).toEqual(["titlebar", "main", SHELL_STATUSBAR_ID]);
        const main = childOf(root, "main");
        expect(childIds(main)).toEqual(["activity", "body"]);
        const body = childOf(main, "body");
        expect(childIds(body)).toEqual(["left", "panel-stack", "right"]);
        expect(childIds(childOf(body, "panel-stack"))).toEqual(["editor", SHELL_PANEL_ID]);
    });

    it("产品默认尺寸只从共享常量读（左 340 / 右 400）", () => {
        expect(WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH).toBe(340);
        expect(WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH).toBe(400);
        expect(SHELL_LEFT_PANEL_DEFAULT_WIDTH).toBe(WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH);
        expect(SHELL_RIGHT_PANEL_DEFAULT_WIDTH).toBe(WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH);
        expect(SHELL_SIZE_DEFAULTS.leftPanelWidth).toBe(WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH);
        expect(SHELL_SIZE_DEFAULTS.agentPanelWidth).toBe(WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH);
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

    it("高度叶的引用约束随收起状态：状态栏刚性 22、面板收起时刚性 32、展开时 80..600", () => {
        const expanded = shellRefResolver(() => 1440);
        const collapsed = shellRefResolver(() => 1440, () => true);

        expect(expanded(SHELL_STATUSBAR_ID)).toMatchObject({minimumSize: {height: SHELL_STATUSBAR_HEIGHT}, maximumSize: {height: SHELL_STATUSBAR_HEIGHT}});
        expect(expanded(SHELL_PANEL_ID)).toMatchObject({minimumSize: {height: SHELL_PANEL_MIN_HEIGHT}, maximumSize: {height: 600}});
        expect(collapsed(SHELL_PANEL_ID)).toMatchObject({
            minimumSize: {height: SHELL_PANEL_COLLAPSED_HEIGHT},
            maximumSize: {height: SHELL_PANEL_COLLAPSED_HEIGHT},
        });
    });

    it("偏好读取：读 Record 树上的叶意图，叶缺失时回落产品默认", () => {
        const grid = defaultRecordGrid();
        expect(readShellPreferences(grid)).toEqual({
            leftPanelWidth: SHELL_LEFT_PANEL_DEFAULT_WIDTH,
            agentPanelWidth: SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
        });

        // 叶缺失（记录里根本没有这两片叶）不是 0 偏好：回落产品默认。
        const restored = defaultRecordGrid();
        expect(restored.restore(
            {version: 2, root: {kind: "leaf", id: "editor", ref: "editor", size: {width: 900, height: 0}}},
            shellRefResolver(() => 1440),
        ).ok).toBe(true);
        expect(readShellPreferences(restored)).toEqual({
            leftPanelWidth: SHELL_LEFT_PANEL_DEFAULT_WIDTH,
            agentPanelWidth: SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
        });
    });

    it("旧 v2 快照（不同父链、没有 panel/statusbar 叶）仍按叶 id 读回四个宽度", () => {
        const grid = defaultRecordGrid();
        const restored = grid.restore(LEGACY_V2_LAYOUT, shellRefResolver(() => 1440));

        expect(restored.ok).toBe(true);
        expect(restored.dropped).toEqual([]);
        // 旧记录的 left/right 直接挂在 main 下（新默认在 body 里）：读取不依赖父链。
        expect(readShellPreferences(grid)).toEqual({leftPanelWidth: 512, agentPanelWidth: 400});
        // 旧原件里没有高度叶：树上就只剩它自己声明过的节点——恢复不会凭空补叶，也不会补写记录。
        expect(childIds(grid.root())).toEqual(["titlebar", "main"]);
    });

    it("记录里的 panel 取值域与面板状态模块同源（不能各自演进）", () => {
        expect([...WORKBENCH_PANEL_POSITIONS]).toEqual([...SHELL_PANEL_POSITIONS]);
        expect([...WORKBENCH_PANEL_ALIGNMENTS]).toEqual([...SHELL_PANEL_ALIGNMENTS]);
        expect(SHELL_PANEL_DEFAULTS).toMatchObject({position: "bottom", alignment: "center", hidden: false, collapsed: false});
    });

    it("面板尺寸记录的校验接双轴：宽度与高度同一把尺，非法轴值整条拒绝", () => {
        expect(isWorkbenchPanelSize({height: 200, width: 320})).toBe(true);
        expect(isWorkbenchPanelSize({height: 200})).toBe(true);
        expect(isWorkbenchPanelSize({})).toBe(true);
        expect(isWorkbenchPanelSize({width: 0})).toBe(false);
        expect(isWorkbenchPanelSize({width: -1})).toBe(false);
        expect(isWorkbenchPanelSize({height: Number.NaN})).toBe(false);
        expect(isWorkbenchPanelSizeValue(240)).toBe(true);
        expect(isWorkbenchPanelSizeValue(0)).toBe(false);
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

/** 纯几何的默认投影快照：默认尺寸偏好 + 默认面板状态（bottom/center、可见、展开、未最大化）。 */
function defaultProjectionSnapshot(): {version: number; root: ReadonlyLayoutNode} {
    const projection = projectShell({
        extent: WORKBENCH_SHELL_DEFAULT_LAYOUT_VIEWPORT,
        preferences: SHELL_SIZE_DEFAULTS,
        panel: {...SHELL_PANEL_DEFAULTS, maximized: false},
        hiddenParts: [],
    });
    return createShellGrid(projection).serialize() as {version: number; root: ReadonlyLayoutNode};
}

/** 按默认记录恢复出来的记录树：取代旧的 `createDefaultShellGrid(1440, 900)`。 */
function defaultRecordGrid() {
    return createShellGrid(projectShell({
        extent: WORKBENCH_SHELL_DEFAULT_LAYOUT_VIEWPORT,
        preferences: SHELL_SIZE_DEFAULTS,
        panel: {...SHELL_PANEL_DEFAULTS, maximized: false},
        hiddenParts: [],
    }));
}

/** 只读树节点的最小形状：记录里的节点（readonly children）与几何输出的快照节点都能传进来。 */
type ReadonlyLayoutNode = {
    readonly kind: string;
    readonly id: string;
    readonly children?: readonly ReadonlyLayoutNode[];
};

function childIds(node: ReadonlyLayoutNode | null): string[] {
    return node !== null && node.kind === "branch" && node.children !== undefined
        ? node.children.map((child) => child.id)
        : [];
}

function childOf(node: ReadonlyLayoutNode | null, id: string): ReadonlyLayoutNode | null {
    return node !== null && node.kind === "branch" && node.children !== undefined
        ? node.children.find((child) => child.id === id) ?? null
        : null;
}

/**
 * 本增量之前的 v2 记录：root(vertical){titlebar, main(horizontal){四个宽度叶}}。
 * 高度叶（panel/statusbar）那时还没有，且 left/right 的父链与新默认不同——
 * 恢复必须照样按叶 id 读回宽度偏好。
 */
const LEGACY_V2_LAYOUT = {
    version: 2,
    root: {
        kind: "branch",
        id: "root",
        orientation: "vertical",
        size: {width: 0, height: 0},
        children: [
            {kind: "leaf", id: "titlebar", ref: "titlebar", size: {width: 0, height: 36}},
            {
                kind: "branch",
                id: "main",
                orientation: "horizontal",
                size: {width: 0, height: 864},
                children: [
                    {kind: "leaf", id: "activity", ref: "activity", size: {width: 60, height: 0}},
                    {kind: "leaf", id: "left", ref: "left", size: {width: 512, height: 0}},
                    {kind: "leaf", id: "editor", ref: "editor", size: {width: 526, height: 0}},
                    {kind: "leaf", id: "right", ref: "right", size: {width: 400, height: 0}},
                ],
            },
        ],
    },
};
