import { ref } from 'vue';

/**
 * 通用收起/展开 composable。
 * @param initialCollapsed - 初始是否收起，默认 true
 */
export const useCollapsible = (initialCollapsed = true) => {
    const isCollapsed = ref(initialCollapsed);
    
    const toggle = () => {
        isCollapsed.value = !isCollapsed.value;
    };
    
    const expand = () => {
        isCollapsed.value = false;
    };
    
    const collapse = () => {
        isCollapsed.value = true;
    };
    
    return {
        isCollapsed,
        toggle,
        expand,
        collapse,
    };
};
