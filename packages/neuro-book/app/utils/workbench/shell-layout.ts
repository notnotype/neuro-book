/**
 * 主工作台外壳的布局记录接线：把共享定义接到 t44 宿主，并提供外壳需要的地形工具。
 *
 * 三件事：
 * - **定义桥接**：`defineWorkbenchShellLayoutState()` 的实例（`shared/storage/workbench-shell-layout.ts`）
 *   就是宿主消费的定义；这里只做一次结构转换（共享模块的叶/分支类型是快照形状的结构孪生，
 *   不 import nb-ui 的类型），并把「载荷版本 = nb-ui 快照版本」核一遍。
 * - **引用解析**：记录里的叶 ref 是稳定 id（`activity`/`left`/`editor`/`right`/`titlebar`），约束取
 *   当前视口下的外壳约束——恢复的越界意图只夹取呈现，不回写原件；未知 ref 只过滤呈现。
 * - **偏好读取**：外壳的左右栏偏好就是树上这两个叶的**意图**（按叶 id 查找，不依赖父链，
 *   兼容旧 v2 记录的任意深度）。呈现树由纯布局组件按 `projectShell` 的投影重建，本模块不再
 *   把产品模型序列化成第二份快照；这里读到的意图只作恢复底本与保存基线。
 */
import type {Grid, GridRefResolver} from "@notnotype/nb-ui/layout";
import {
    GRID_LAYOUT_SCHEMA_VERSION,
    type GridLayoutRecord,
} from "nbook/app/utils/workbench/storage-grid-host";
import {
    SHELL_LEAF_IDS,
    SHELL_LEFT_PANEL_DEFAULT_WIDTH,
    SHELL_PANEL_ID,
    SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    SHELL_STATUSBAR_HEIGHT,
    SHELL_STATUSBAR_ID,
    SHELL_TITLEBAR_HEIGHT,
    SHELL_TITLEBAR_ID,
    shellLeafLimits,
    shellPanelHeightLimits,
    type ShellLeafId,
} from "nbook/app/utils/workbench/layout";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {
    defineWorkbenchShellLayoutState,
    WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION,
} from "nbook/shared/storage/workbench-shell-layout";

/** 记录里可能出现的全部叶 ref：四个宽度叶 + 三条高度叶（高度叶不进横向分配，但仍是记录节点）。 */
const SHELL_RECORD_LEAF_IDS: readonly string[] = [...SHELL_LEAF_IDS, SHELL_TITLEBAR_ID, SHELL_PANEL_ID, SHELL_STATUSBAR_ID];

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
 * 让恢复的越界意图停在夹取边界而不是被拒绝。三条高度叶（titlebar / panel / statusbar）
 * 横向只声明上界，高度按各自当前状态给出：标题栏与状态栏刚性，底部面板随收起在
 * 「刚性 32」与「80..600」之间切换（口径与 `createShellGrid` 同源）。
 *
 * 视口宽与收起状态都按调用时读取：宿主可能持有本解析器跨越多次恢复与多次收起切换。
 */
export function shellRefResolver(viewportWidth: () => number, panelCollapsed: () => boolean = () => false): GridRefResolver<string> {
    return (ref) => {
        if (!SHELL_RECORD_LEAF_IDS.includes(ref)) {
            return null;
        }
        if (ref === SHELL_TITLEBAR_ID || ref === SHELL_STATUSBAR_ID) {
            const height = ref === SHELL_TITLEBAR_ID ? SHELL_TITLEBAR_HEIGHT : SHELL_STATUSBAR_HEIGHT;
            return {
                ref,
                minimumSize: {width: 0, height},
                maximumSize: {width: Number.MAX_SAFE_INTEGER, height},
            };
        }
        if (ref === SHELL_PANEL_ID) {
            const limits = shellPanelHeightLimits(panelCollapsed());
            return {
                ref,
                minimumSize: {width: 0, height: limits.minimumSize},
                maximumSize: {width: Number.MAX_SAFE_INTEGER, height: limits.maximumSize},
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

/** 外壳当前的左右栏偏好（树上意图）；叶缺失或值非法时回落产品默认。 */
export function readShellPreferences(grid: Grid<string>): {leftPanelWidth: number; agentPanelWidth: number} {
    // 按叶 id 查找，不依赖父链：旧 v2 记录里 left/right 可能落在任意深度的分支里。
    const left = grid.find("left")?.size.width;
    const right = grid.find("right")?.size.width;
    return {
        leftPanelWidth: left !== undefined && Number.isFinite(left) && left > 0 ? left : SHELL_LEFT_PANEL_DEFAULT_WIDTH,
        agentPanelWidth: right !== undefined && Number.isFinite(right) && right > 0 ? right : SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
    };
}
