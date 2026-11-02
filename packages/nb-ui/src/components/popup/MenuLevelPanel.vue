<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import PopupViewport from "./PopupViewport.vue";

/**
 * 手工级联菜单的一级面板（内部零件），DropdownMenu、Menubar 与右键菜单共用。位置与尺寸由宿主经 `useMenuCascade` 量好
 * 后给出（`measureCascadePanel` 已把高度截到第 9 项中间、夹进窗口）；面板里是这一级自己的滚动视口与滑块。
 *
 * 这一级一滚动就发 `scroll`，宿主收起它展开的更深层级：父项可能已经滚出视口，子菜单不能还挂在原处。
 * 面板本身可以接收焦点（`tabindex="-1"`）：指针离开项时焦点停在面板上，高亮随之清掉，键盘仍在这一级。
 */
defineProps<{
    panelStyle: Record<string, string | number>;
    switching: boolean;
    /** 这一级展开自哪一项；换了父项时视口回到顶部 */
    contentKey?: unknown;
} & /* @vue-ignore */ Omit<HTMLAttributes, "onScroll">>();

const emit = defineEmits<{
    (e: "scroll"): void;
}>();
</script>

<template>
    <div
        role="menu"
        tabindex="-1"
        class="nb-ui-popover-surface nb-ui-menu-surface nb-menu-level pointer-events-auto fixed flex flex-col overflow-hidden outline-none"
        :data-switching="switching"
        :style="panelStyle"
    >
        <PopupViewport :content-key="contentKey" class="nb-menu-level-viewport flex-1" @scroll="emit('scroll')">
            <div class="nb-menu-level-content">
                <slot />
            </div>
        </PopupViewport>
    </div>
</template>
