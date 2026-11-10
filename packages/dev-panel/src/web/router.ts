import {createRouter, createWebHistory} from "vue-router";

declare module "vue-router" {
    interface RouteMeta {
        /**
         * 页面怎么用外壳给的高度（t15）：缺省“流式”，`main` 竖向滚动；“铺满”时 `main` 不滚，页面占满高度、由它的分栏各自滚动。
         * 一页只有一个竖向滚动者，见 docs/panel.md 的“前端”。
         */
        layout?: "flow" | "fill";
        /** 专注页（t23，评审板）：进来时外壳把左栏收起、离开时恢复，不写进偏好，把宽度让给正文。 */
        focus?: boolean;
        /** 页面名：标签页标题“页面名 · nbdev”用它（带参数的 Work、Task、产物、文档、编辑、搜索页另由 host/nav.ts 的 pageTitle 拼）。 */
        title?: string;
    }
}

/** 路由与页面的对应见 docs/panel.md 的“前端”，加一个页面照那里的清单做。页面按需加载：首页先出来，其余页面点到才取。 */
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", name: "home", component: () => import("./pages/HomePage.vue"), meta: {title: "首页"}},
        {path: "/work/:workId", name: "work", component: () => import("./pages/WorkPage.vue"), props: true, meta: {title: "Work"}},
        {path: "/work/:workId/task/:taskId", name: "task", component: () => import("./pages/TaskPage.vue"), props: true, meta: {title: "Task"}},
        {path: "/artifacts", name: "artifacts", component: () => import("./pages/ArtifactsPage.vue"), meta: {title: "产物"}},
        {path: "/artifact/:workId/:taskId/:artifactId", name: "artifact", component: () => import("./pages/ArtifactPage.vue"), props: true, meta: {layout: "fill", focus: true, title: "产物"}},
        {path: "/docs", name: "docs", component: () => import("./pages/DocsPage.vue"), meta: {layout: "fill", title: "文档"}},
        {path: "/live/sessions", name: "sessions", component: () => import("./pages/SessionsPage.vue"), meta: {layout: "fill", title: "会话"}},
        {path: "/live/checkouts", name: "checkouts", component: () => import("./pages/CheckoutsPage.vue"), meta: {title: "checkout"}},
        {path: "/live/runs", name: "runs", component: () => import("./pages/RunsPage.vue"), meta: {title: "在跑"}},
        {path: "/live/github", name: "github", component: () => import("./pages/GithubPage.vue"), meta: {title: "GitHub"}},
        {path: "/search", name: "search", component: () => import("./pages/SearchPage.vue"), meta: {title: "搜索"}},
        {path: "/new", name: "new", component: () => import("./pages/NewPage.vue"), meta: {title: "新建"}},
        {path: "/edit", name: "edit", component: () => import("./pages/EditPage.vue"), meta: {title: "编辑"}},
        {path: "/:rest(.*)*", name: "missing", component: () => import("./pages/MissingPage.vue"), meta: {title: "找不到这一页"}},
    ],
});
