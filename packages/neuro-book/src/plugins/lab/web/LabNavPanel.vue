<script setup lang="ts">
/**
 * Lab 左栏：按目录分组的组件树与检索（docs/specs/ui/component-lab.md 的“输入与前置条件”最后一段）。展开状态与检索词
 * 归这一栏；选中的组件由 LabShell 持有，地址栏换组件时这里把树展开到它。
 */
import {computed, ref, watch} from "vue";
import {FormInput as NbFormInput, Tree as NbTree} from "@notnotype/nb-ui/components";

import CollapsibleSidePanel from "./components/CollapsibleSidePanel.vue";
import {findLabComponent, labComponentLabel, labComponents, matchesLabQuery} from "./component-index";
import type {LabComponentKind} from "./component-index";

const props = defineProps<{
    /** 选中的组件名。 */
    selected: string;
    /** 选中的组件正在加载：它那一行显示转圈。 */
    loading: boolean;
    collapsed: boolean;
    width: number;
}>();

const emit = defineEmits<{
    select: [name: string];
    "update:collapsed": [collapsed: boolean];
}>();

// 每一级目录都是可折叠的分组：novel-ide / novel-ide/settings / … / model/components
const ALL_GROUP_IDS = [...new Set(labComponents.flatMap((entry) =>
    entry.groupPath.map((_, index) => `group:${entry.groupPath.slice(0, index + 1).join("/")}`)))];

const treeQuery = ref("");
const expandedGroups = ref<string[]>([...ALL_GROUP_IDS]);

function ensureSelectedComponentExpanded(name: string): void {
    if (!name) return;
    const comp = findLabComponent(name);
    if (!comp || !comp.groupPath.length) return;
    const neededGroups: string[] = [];
    for (let i = 0; i < comp.groupPath.length; i++) {
        neededGroups.push(`group:${comp.groupPath.slice(0, i + 1).join("/")}`);
    }
    const set = new Set([...expandedGroups.value, ...neededGroups]);
    expandedGroups.value = Array.from(set);
}

const matchedComponents = computed(() => {
    const query = treeQuery.value.trim();
    if (query === "") {
        return labComponents;
    }
    // 搜组件名、文档显示名与部件别名：导航要的是「我知道它长什么样，带我过去」，
    // 所以搜正文仍然不做（那会把「凡是提到 Tree 的组件」全捞出来）。
    return labComponents.filter((entry) => matchesLabQuery(entry, query));
});

type LabTreeNode = {id: string; title: string; iconClass?: string; children?: LabTreeNode[]};

/**
 * 图形按组件分类给，不按「能不能挂载」给：分类回答「这是什么」，锁只回答「这里能不能跑」——
 * 后者仍然覆盖前者，因为它是一条约束，不是类型。
 *
 * 颜色跟图形一起给：一百多行里靠文字找组件时，色相是唯一不用读字就能扫出来的线索。
 *
 * 这里只认四根**能用的色相轴**（青 `--status-info`、绿 `--status-success`、
 * 橙 `--status-warning`、红 `--status-danger`）加主题强调蓝，其余四档用 `color-mix` 在它们之间
 * 取中间色相。之所以不直接拿 `--accent-text` 当第三档：它和 `--accent-main`、`--status-info`
 * 都是蓝的（#0060df / #007aff / #0a7ea4，色相 214° / 211° / 195°），三档只差十几度，
 * 在 14px 图标上等于一个颜色。下表括号里是两套配色下的实际色相，相邻档至少差 45°。
 *
 * 全部由主题 token 派生，不写死 hex；换配色时跟着走。
 */
const KIND_ICONS: Record<LabComponentKind, string> = {
    view: "i-lucide-layout-panel-top text-[var(--status-info)]",
    // 蓝 + 红（1:3）= 玫红，与「面板」的紫分开约 70°
    dialog: "i-lucide-app-window text-[color-mix(in_srgb,var(--accent-main)_25%,var(--status-danger))]",
    // 绿 + 橙 = 黄绿，落在「字段」的橙与「列表」的绿之间
    section: "i-lucide-list-tree text-[color-mix(in_srgb,var(--status-success)_55%,var(--status-warning))]",
    field: "i-lucide-sliders-horizontal text-[var(--status-warning)]",
    list: "i-lucide-list text-[var(--status-success)]",
    // 蓝 + 红（约 1:1）= 紫
    panel: "i-lucide-panel-left text-[color-mix(in_srgb,var(--accent-main)_45%,var(--status-danger))]",
    // 青 → 绿 = 青绿（约 168°），落在 info 的 195° 与 success 的 130° 之间
    agent: "i-lucide-message-square text-[color-mix(in_srgb,var(--status-info)_45%,var(--status-success))]",
    // 蓝 → 红（偏蓝）= 蓝紫（约 236°），正好落在「视图青 195°」与「面板紫 264°」中间的空档
    editor: "i-lucide-file-code text-[color-mix(in_srgb,var(--accent-main)_55%,var(--status-danger))]",
    // 色相环剩下的空档都在 25° 以内，挤不下第四族；这一族靠形状（面板轮廓）分，颜色与零件同档
    workbench: "i-lucide-panels-top-left text-[var(--text-secondary)]",
    part: "i-lucide-box text-[var(--text-secondary)]",
};

/**
 * 集成入口（被别的条目写成「验证入口」的那个组件）单独一个图形，取主题强调蓝。
 *
 * 它的特殊之处不在名字里：`WorkbenchShellLayout` 自己标签为空、耦合度为 0，按命名规则
 * 会兜底成 `part`，于是和一百个普通零件长成同一个方盒子。它真正的身份在关系里——
 * 容器宿主链上那几个零件都写着「验证入口: WorkbenchShellLayout」。所以这里用的是索引
 * 派生出来的 `integrationEntry`，不是一张手写名单；将来第二条宿主链出现时自动生效。
 *
 * `lab-tree-entry-icon` 由本文件样式区接管（树组件给每个图标压了七成透明，工具类压不过它的静态类）：
 * 它是全树唯一「从这里进整链」的入口，色相又和 `view` 的青色只差十几度，靠实心与更粗的描边拉开。
 */
const INTEGRATION_ICON = "i-lucide-layers lab-tree-entry-icon text-[var(--accent-main)]";

/**
 * 按目录路径建多级树：每一级目录是一个分组节点，叶子是组件本身。
 * 搜索直接在入口列表上过滤，因此没有命中的分支根本不会出现——不需要事后剪枝。
 */
function buildComponentTree(entries: typeof labComponents): LabTreeNode[] {
    const roots: LabTreeNode[] = [];
    const nodesByPath = new Map<string, LabTreeNode>();
    for (const entry of entries) {
        let level = roots;
        let path = "";
        for (const segment of entry.groupPath) {
            path = path === "" ? segment : `${path}/${segment}`;
            const id = `group:${path}`;
            let node = nodesByPath.get(id);
            if (!node) {
                // 目录行也给图标：不给的话，组名会从叶子的图标列起排，两级标题对不齐
                node = {id, title: segment, iconClass: "i-lucide-folder text-[var(--text-muted)]", children: []};
                nodesByPath.set(id, node);
                level.push(node);
            }
            level = node.children!;
        }
        level.push({
            id: entry.name,
            // canonical 名在前、显示名在后（两者相同不重复）：导航 id 与偏好键仍是 canonical 名。
            title: labComponentLabel(entry),
            // 正在加载中的组件实时反馈旋转动画；集成入口用它自己的图形；挂不上的标锁；其余按分类
            iconClass: (props.loading && props.selected === entry.name)
                ? "i-lucide-loader-2 animate-spin motion-reduce:animate-none text-[var(--accent-text)]"
                : !entry.mountable
                    ? "i-lucide-lock text-[var(--text-muted)]"
                    : (entry.integrationEntry ? INTEGRATION_ICON : KIND_ICONS[entry.kind]),
        });
    }
    const sortLevel = (nodes: LabTreeNode[]): void => {
        // 目录在前、组件在后，各自按名字排；同层混排会让「第几级」读不出来
        nodes.sort((a, b) => Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.title.localeCompare(b.title));
        for (const node of nodes) {
            if (node.children) {
                sortLevel(node.children);
            }
        }
    };
    sortLevel(roots);
    return roots;
}

const treeItems = computed(() => buildComponentTree(matchedComponents.value));

// 搜索时把目录全摊开：搜出来的东西藏在一个收起的目录里，等于没搜到。
watch(treeQuery, (query) => {
    if (query.trim() !== "") {
        expandedGroups.value = [...ALL_GROUP_IDS];
    }
});

watch(() => props.selected, ensureSelectedComponentExpanded, {immediate: true});

/** 分组节点只负责展开收起，不切换组件。 */
function select(id: string): void {
    if (!id.startsWith("group:")) emit("select", id);
}
</script>

<template>
    <CollapsibleSidePanel
        :collapsed="collapsed"
        title="组件"
        side="left"
        class="lab-panel shrink-0"
        :style="collapsed ? undefined : {width: `${width}px`, flex: `0 0 ${width}px`}"
        @update:collapsed="emit('update:collapsed', $event)"
    >
        <template #search>
            <NbFormInput
                v-model="treeQuery"
                size="sm"
                type="search"
                placeholder="搜组件名或部件名称"
                icon-class="i-lucide-search"
                clearable
                aria-label="搜组件名或部件名称"
                class="w-full"
            />
        </template>

        <template #actions>
            <span class="lab-note shrink-0 tabular-nums">
                {{ matchedComponents.length }} / {{ labComponents.length }}
            </span>
        </template>

        <!-- 侧栏本身就是那块面，树在里面是裸列表。用默认的 card 会得到
             「一张卡片浮在侧栏里」：卡片自带的面色、描边与阴影和侧栏的重复一遍。 -->
        <NbTree
            v-model:expanded="expandedGroups"
            :items="treeItems"
            :model-value="selected"
            surface="plain"
            @select="select($event.id)"
        />
        <p v-if="matchedComponents.length === 0" class="lab-search-empty lab-note">
            没有名字含「{{ treeQuery }}」的组件：可以按组件名、中文部件名或别名搜
        </p>
    </CollapsibleSidePanel>
</template>
