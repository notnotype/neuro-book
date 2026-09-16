<script setup lang="ts">
/**
 * WorkbenchViewHost 的 Lab 场景：容器声明 → 视图解析 → 懒实例化 → 失败可见。
 *
 * 宿主只认两处注入（注册表与 factory 解析器，都是可省且文档化的测试缝隙）。这里两处都注入，
 * 因为产品目录里唯一的叶（`nbook.view.files` → `WorkspaceFilePanel`）要 Pinia store、workspace API
 * 与对话框才起得来——Lab 不给它搭这套台子。stub **只**替换这一个叶，其余 factoryKey 仍交回产品
 * 白名单（`view-factories.ts`）求值，所以「未知键」那条诊断是产品给的原话，不是 fixture 编的。
 *
 * 三个场景只差宿主收到的 `context`（其余注入完全相同）：
 *   - default：Project 开着 → `nbook.files` 可见、经 stub 渲染，内容区按它的 `fill` 呈现；
 *   - hidden：Project 没开 → 没有可见视图，空态给出 `when` 的求值原因，合同退回默认 `scroll`；
 *   - unknown-factory：`lab.ghost` 可见但 factoryKey 不在白名单里 → 失败在容器内可见，不静默空白。
 *
 * 没有网络、没有持久化、不读 store：环境事实只有这一份内存 context。
 */
import {computed, defineComponent, h, type Component} from "vue";
import WorkbenchViewHost from "nbook/app/components/workbench/WorkbenchViewHost.vue";
import {
    createWorkbenchRegistry,
    type DescriptorResult,
    type ViewDescriptor,
    type WorkbenchCatalog,
    type WorkbenchContext,
    type WorkbenchRegistry,
} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER} from "nbook/app/utils/workbench/containers";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import {resolveWorkbenchViewFactory} from "nbook/app/utils/workbench/view-factories";
import {SHELL_CONTAINER_GUTTER_PX, SHELL_LEFT_PANEL_DEFAULT_WIDTH} from "nbook/app/utils/workbench/layout";

const props = defineProps<{scene: string; data?: unknown}>();

/** 容器标题取产品译文的**已解析**值（`ide.workbench.container.tools`）：解析归宿主，fixture 扮演宿主。 */
const CONTAINER_TITLE = "工具";

/** 第三条路径的载体：声明本身合法，只有 `factoryKey` 落在白名单之外。 */
const LAB_GHOST_VIEW: ViewDescriptor = {
    id: "lab.ghost",
    titleKey: "ide.toolPanel.outline",
    icon: "i-lucide-unplug",
    container: SHELL_LEFT_CONTAINER.id,
    layout: "scroll",
    when: {requires: ["user-assets"]},
    order: 20,
    weight: 1,
    canToggleVisibility: false,
    canMoveView: false,
    factoryKey: "lab.view.ghost",
    stateScope: "user",
};

/** 视图声明是产品的那一份原样（`SHELL_FILES_VIEW`）加一个失败路径用的 `lab.ghost`：fixture 不复制 descriptor。 */
const LAB_CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER],
    views: [SHELL_FILES_VIEW, LAB_GHOST_VIEW],
};

function buildRegistry(catalog: WorkbenchCatalog): WorkbenchRegistry {
    const created = createWorkbenchRegistry(catalog);
    if (!created.ok) {
        throw new Error(`Lab 的 Workbench 声明不合法：${created.reason}`);
    }
    return created.value;
}

/** 注册表只建一次：换场景是换 context，不是换声明。 */
const LAB_REGISTRY = buildRegistry(LAB_CATALOG);

/** stub 的行数固定：它只用来观察「谁拥有留白与滚动」，不需要旋钮。 */
const STUB_ROWS = Array.from({length: 24}, (_, index) => index + 1);

/**
 * 最小 stub 叶：自己按 `fill` 合同给留白、接滚动——产品里这一档是 `WorkspaceFilePanel`。
 * 不用 `template` 字符串：运行时编译不在构建里。
 */
const StubFilesView = defineComponent({
    name: "LabStubFilesView",
    setup() {
        return () => h("div", {class: "flex h-full min-h-0 flex-col", "data-lab-stub-view": "files"}, [
            h(
                "p",
                {class: "flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-3)] text-[var(--text-xs)] text-[var(--text-secondary)]"},
                [
                    h("span", {class: "i-lucide-files h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]", "aria-hidden": "true"}),
                    "stub 叶：它由 fixture 的解析器给出，不是产品组件",
                ],
            ),
            h(
                "ul",
                {class: "flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto p-[var(--panel-p)]"},
                STUB_ROWS.map((row) => h("li", {key: row, class: "text-[var(--text-sm)] text-[var(--text-secondary)]"}, `示例条目 ${row}`)),
            ),
        ]);
    },
});

/** stub 只用在 store 依赖重的那个叶上；其余键交回产品白名单，未登记键的诊断因此是产品原话。 */
const LAB_VIEW_FACTORIES: Record<string, Component> = {"nbook.view.files": StubFilesView};

function resolveLabViewFactory(factoryKey: string): DescriptorResult<Component> {
    const stub = LAB_VIEW_FACTORIES[factoryKey];
    return stub === undefined ? resolveWorkbenchViewFactory(factoryKey) : {ok: true, value: stub};
}

/** 场景只换这一份内存事实：`when` 的求值输入全在这里，没有 store、没有 Storage。 */
function contextOf(scene: string): WorkbenchContext {
    const project = scene === "default";
    const userAssets = scene === "unknown-factory";
    return {
        project,
        selection: false,
        "user-assets": userAssets,
        desktop: false,
        authorities: {project, session: false, job: false, files: project},
        projectRoot: project ? "/lab/示例项目" : null,
    };
}

const context = computed(() => contextOf(props.scene));

const SCENE_NOTES: Record<string, string> = {
    default: "Project 开着：容器里只有 nbook.files 一个可见视图（lab.ghost 不满足 when，因此没有实例），内容区合同取它的 fill。",
    hidden: "两个视图都不满足 when：没有可见视图、没有实例，空态把各自的原因列出来（去重后用「；」连接），内容区退回默认 scroll。",
    "unknown-factory": "lab.ghost 可见，但它的 factoryKey 不在白名单里：失败在容器内可见（视图锚点还在），不静默空白。",
};

const stageNote = computed(() => SCENE_NOTES[props.scene] ?? "");

/** 叶：外壳加的那层内边距（卡片是它的内接盒），基准宽度给产品的 340。 */
const leafStyle: Record<string, string> = {
    flex: `0 1 ${SHELL_LEFT_PANEL_DEFAULT_WIDTH}px`,
    padding: `${SHELL_CONTAINER_GUTTER_PX}px`,
};
</script>

<template>
    <div class="flex h-[520px] min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-main)]">
        <!-- 这段是 fixture 自己的话，不是宿主的一部分：宿主只渲染容器与视图，说明归 Lab。 -->
        <p class="shrink-0 px-[var(--space-6)] py-[var(--space-3)] text-[var(--text-xs)] text-[var(--text-muted)]">{{ stageNote }}</p>
        <div class="flex min-h-0 w-full flex-1 items-stretch">
            <div class="flex min-h-0 min-w-0 flex-col" :style="leafStyle" data-fixture-leaf="left">
                <WorkbenchViewHost
                    data-lab-subject
                    :container="SHELL_LEFT_CONTAINER"
                    :container-title="CONTAINER_TITLE"
                    :context="context"
                    :registry="LAB_REGISTRY"
                    :view-factory-resolver="resolveLabViewFactory"
                />
            </div>
            <!-- 中间叶：产品里的编辑器，空的——它的存在只为了让卡片落在左叶的位置上。 -->
            <div class="min-h-0 min-w-0 flex-1" data-fixture-leaf="editor"></div>
        </div>
    </div>
</template>
