/**
 * 主工作台外壳的布局记录接线：把共享定义接到 t44 宿主，并提供外壳需要的地形工具。
 *
 * 三件事：
 * - **定义桥接**：`defineWorkbenchShellLayoutState()` 的实例（`shared/storage/workbench-shell-layout.ts`）
 *   就是宿主消费的定义；这里只做一次结构转换（共享模块的叶/分支类型是快照形状的结构孪生，
 *   不 import nb-ui 的类型），并把「载荷版本 = nb-ui 快照版本」核一遍。
 * - **引用解析**：记录里的叶 ref 是稳定 id（`activity`/`left`/`editor`/`right`/`titlebar`），约束取
 *   当前视口下的外壳约束——恢复的越界意图只夹取呈现，不回写原件；未知 ref 只过滤呈现。
 * - **偏好读取**：外壳的左右栏偏好就是树上这两个叶的**意图**。手势结束、放弃与恢复都会改写或还原它，
 *   因此「当前显示」只有这一处来源，不再需要第二份内存镜像。
 */
import type {Grid, GridNode, GridRefResolver, GridSnapshot} from "@notnotype/nb-ui/components";
import {
    GRID_LAYOUT_SCHEMA_VERSION,
    type GridLayoutRecord,
} from "nbook/app/utils/workbench/storage-grid-host";
import {
    createShellGrid,
    SHELL_LEAF_IDS,
    SHELL_LEFT_PANEL_DEFAULT_WIDTH,
    SHELL_MAIN_ID,
    SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    SHELL_TITLEBAR_ID,
    shellLeafLimits,
    type ShellLeafId,
} from "nbook/app/utils/workbench/layout";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {
    defineWorkbenchShellLayoutState,
    WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION,
} from "nbook/shared/storage/workbench-shell-layout";

/** 记录里可能出现的全部叶 ref：四个宽度叶 + 标题栏叶（不参与横向分配，但进快照）。 */
const SHELL_RECORD_LEAF_IDS: readonly string[] = [...SHELL_LEAF_IDS, SHELL_TITLEBAR_ID];

/**
 * 宿主消费的定义实例。
 *
 * 结构转换只抹平两侧对同一份 JSON 的类型表述；运行期行为由宿主的构造期守卫（owner/schemaVersion/records）
 * 与 `shell-layout.test.ts` 的读写往返锁定。
 */
export const shellLayoutDefinition = defineWorkbenchShellLayoutState() as unknown as DefinedStorageState<GridLayoutRecord>;

// 版本合同的编译期 + 启动期双核：nb-ui 升版时这里先失败，而不是留给宿主一句难懂的 TypeError。
const shellLayoutSchemaVersion: typeof WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION = GRID_LAYOUT_SCHEMA_VERSION;
if (shellLayoutDefinition.schemaVersion !== shellLayoutSchemaVersion) {
    throw new Error(
        `外壳布局记录的载荷版本 ${String(shellLayoutDefinition.schemaVersion)} 与宿主接受的快照版本 ${String(shellLayoutSchemaVersion)} 不一致`,
    );
}

/**
 * 记录里的叶引用 → 当前约束。
 *
 * 未知 ref 返回 null（宿主只过滤呈现、保留原件）；已知叶返回当前视口下的 min/max，
 * 让恢复的越界意图停在夹取边界而不是被拒绝。标题栏是高度叶，横向只声明上界。
 *
 * 视口宽按调用时读取（右栏上限随视口变化）：宿主可能持有本解析器跨越多次恢复。
 */
export function shellRefResolver(viewportWidth: () => number): GridRefResolver<string> {
    return (ref) => {
        if (!SHELL_RECORD_LEAF_IDS.includes(ref)) {
            return null;
        }
        if (ref === SHELL_TITLEBAR_ID) {
            return {
                ref,
                minimumSize: {width: 0, height: 0},
                maximumSize: {width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER},
            };
        }
        const limits = shellLeafLimits(ref as ShellLeafId, viewportWidth());
        return {
            ref,
            minimumSize: {width: limits.minimumSize, height: 0},
            maximumSize: {width: limits.maximumSize, height: Number.MAX_SAFE_INTEGER},
        };
    };
}

/**
 * 按给定叶尺寸重建外壳树并取快照：外壳把产品模型（固定栏读偏好、编辑器吸收余量、隐藏叶不占宽度）
 * 收敛回宿主持有的同一棵树时用。复用 `createShellGrid` 的建树口径，避免第二套拓扑。
 */
export function shellGridSnapshot(
    viewportWidth: number,
    sizes: Readonly<Record<string, number>>,
    hidden: readonly string[],
): GridSnapshot {
    return createShellGrid(viewportWidth, sizes, hidden).serialize();
}

/** 树上某叶的宽度意图；树里没有该叶时为 null（隐藏叶不占宽度，不是 0 偏好）。 */
function leafWidth(root: GridNode<string> | null, id: string): number | null {
    if (root === null || root.kind === "leaf") {
        return null;
    }
    const main = root.children.find((child) => child.id === SHELL_MAIN_ID);
    if (!main || main.kind !== "branch") {
        return null;
    }
    const leaf = main.children.find((child) => child.id === id);
    return leaf ? leaf.size.width : null;
}

/** 外壳当前的左右栏偏好（树上意图）；叶缺失或值非法时回落产品默认。 */
export function readShellPreferences(grid: Grid<string>): {leftPanelWidth: number; agentPanelWidth: number} {
    const root = grid.root();
    const left = leafWidth(root, "left");
    const right = leafWidth(root, "right");
    return {
        leftPanelWidth: left !== null && Number.isFinite(left) && left > 0 ? left : SHELL_LEFT_PANEL_DEFAULT_WIDTH,
        agentPanelWidth: right !== null && Number.isFinite(right) && right > 0 ? right : SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    };
}
