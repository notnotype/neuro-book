/**
 * w00058 t01（注册方案进资源管理器）第 1 轮静态稿：八个根的整体样子，当前会话的标记与只读标记的候选，会话少、临时文件为空
 * 两种情形。评审板在那个 Task 的 artifacts/review。
 */
import {defineLabFixture} from "../../fixtures/define";
import type ExplorerRootsDraft from "./ExplorerRootsDraft.vue";

type Props = InstanceType<typeof ExplorerRootsDraft>["$props"];
const scene = (id: string, label: string, props: Props) => ({id, label, input: {props}});

export const fixtures = [
    defineLabFixture<typeof ExplorerRootsDraft>({
        component: "ExplorerRootsDraft",
        scenes: [
            scene("overview", "整体：跟随到当前会话", {scene: "overview"}),
            scene("marker-dot", "当前会话：行尾圆点", {scene: "overview", marker: "dot"}),
            scene("marker-icon", "当前会话：会话图标染强调色", {scene: "overview", marker: "icon"}),
            scene("marker-badge", "当前会话：名字后写“当前”", {scene: "overview", marker: "badge"}),
            scene("marker-dot-blur", "当前会话：行尾圆点，树没有焦点", {scene: "overview", marker: "dot", focused: false}),
            scene("profiles", "Profile 笔记与临时文件里的当前项", {scene: "profiles"}),
            scene("readonly-lock", "只读：行尾锁", {scene: "readonly", readonlyMark: "lock"}),
            scene("readonly-text", "只读：名字后写“只读”", {scene: "readonly", readonlyMark: "text"}),
            scene("sessions-few", "会话只有几个", {scene: "sessions-few"}),
            scene("temps-empty", "临时文件为空", {scene: "temps-empty"}),
        ],
        load: async () => (await import("./ExplorerRootsDraftFixture.vue")).default as never,
    }),
];
