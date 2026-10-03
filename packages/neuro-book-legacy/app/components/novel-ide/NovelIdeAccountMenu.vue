<script setup lang="ts">
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";

const props = withDefaults(defineProps<{
    currentUser: AuthUserDto | null;
    rootClass?: string;
    menuClass?: string;
}>(), {
    rootClass: "relative w-8 shrink-0",
    menuClass: "right-0 top-full mt-2 w-40",
});

const emit = defineEmits<{
    (event: "open-profile"): void;
    (event: "open-admin"): void;
    (event: "logout"): void;
}>();

const {t} = useI18n();

const menuItems = computed<DropdownItem[]>(() => {
    const items: DropdownItem[] = [{
        label: t("ide.header.profile"),
        value: "profile",
        iconClass: "i-lucide-user-round",
    }];
    if (props.currentUser?.role === "admin") {
        items.push({
            label: t("ide.header.openAdmin"),
            value: "admin",
            iconClass: "i-lucide-shield",
        });
    }
    items.push({
        label: t("ide.header.localLogout"),
        value: "logout",
        iconClass: "i-lucide-log-out",
    });
    return items;
});

/** 当前本地登录用户的头像文字。 */
const userInitial = computed(() => {
    const name = props.currentUser?.displayName || props.currentUser?.username || "U";
    return name.trim().slice(0, 1).toLocaleUpperCase();
});

/** 将账户菜单动作交给页面宿主执行。 */
function selectMenuItem(value: string): void {
    if (value === "profile") {
        emit("open-profile");
        return;
    }
    if (value === "admin") {
        emit("open-admin");
        return;
    }
    if (value === "logout") {
        emit("logout");
    }
}
</script>

<template>
    <!-- 本地账户菜单：个人中心、管理员后台与本地退出的唯一入口实现。 -->
    <div class="w-8 shrink-0">
        <Dropdown :items="menuItems" :root-class="props.rootClass" :menu-class="props.menuClass" @select="selectMenuItem">
            <button class="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.header.accountMenu')">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[11px] font-semibold text-[var(--accent-text)]">{{ userInitial }}</span>
            </button>
        </Dropdown>
    </div>
</template>
