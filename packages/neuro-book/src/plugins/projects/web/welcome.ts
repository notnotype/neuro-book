/**
 * 欢迎页的宿主（docs/specs/workbench/bookshelf.md 的“欢迎页”）：把作品信息、统计、快捷入口与编辑器给的最近打开交给
 * `WelcomePage`，把它的动作换成文件操作、命令与整页导航。每次挂上（标签成为活动标签）重新取一次作品信息与项目根的列出：
 * 欢迎页不常驻，取的是那一刻的样子。
 */

import {defineComponent, h, onMounted, shallowRef} from "vue";
import type {Component, PropType} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {EditorPageContext} from "nbook/plugins/editor/web/pages";
import type {FilesService} from "nbook/plugins/files/shared/contracts";
import {diagnosticText} from "nbook/shared/localized-text";
import type {TextResolver} from "nbook/shared/localized-text";

import {BACK_TO_SHELF_COMMAND} from "../shared/contracts";
import type {projectsRemoteContract, ShelfStats} from "../shared/contracts";
import {projectsText} from "../shared/text";

export const WELCOME_PAGE_ID = "nbook.projects.welcome";

/** 快捷入口：项目根下名字以这些词开头的文件与文件夹。 */
const QUICK_PREFIXES = ["大纲", "设定"];

const NO_FILES = "files-unavailable";

export interface WelcomeHostOptions {
    readonly component: Component;
    /** 窗口绑定的作品；没有绑定项目时为 null。 */
    readonly project: {readonly id: string; readonly title: string} | null;
    readonly remote: Pick<RemoteClient<typeof projectsRemoteContract>, "shelf">;
    /** 没有文件服务时为 null：没有快捷入口，“新建章节”说明原因。 */
    readonly files: Pick<FilesService, "list" | "create"> | null;
    readonly commands: Pick<CommandService, "execute">;
    /** 新章节的文件名与失败原因按它给出（当前显示语言）。 */
    readonly text: TextResolver;
    readonly now: () => number;
    /** 命令面板的快捷键（已按平台写好）；没有时为 null。 */
    readonly shortcut: () => string | null;
    readonly report: (message: string) => void;
}

/** `name.md`、`name 2.md`……里第一个项目根还没有的名字。 */
export function freeChapterName(base: string, taken: ReadonlySet<string>): string {
    for (let index = 1; ; index += 1) {
        const name = index === 1 ? `${base}.md` : `${base} ${String(index)}.md`;
        if (!taken.has(name)) return name;
    }
}

/** 快捷入口：项目根下名字以“大纲”“设定”开头的文件与文件夹，按这两个词的先后、再按名字排。 */
export function quickEntries(entries: ReadonlyArray<{readonly name: string; readonly kind: string}>): Array<{readonly address: string; readonly name: string; readonly kind: "file" | "folder"}> {
    const rank = (name: string): number => QUICK_PREFIXES.findIndex((prefix) => name.startsWith(prefix));
    return entries
        .filter((entry) => (entry.kind === "file" || entry.kind === "directory") && rank(entry.name) >= 0)
        .sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((entry) => ({address: `project://${entry.name}`, name: entry.name, kind: entry.kind === "directory" ? "folder" as const : "file" as const}));
}

/**
 * 新建章节：在项目根按已有名字避让建一个空的 Markdown 文件，再以正式标签打开。返回要写在按钮下的原因，成功为 null；
 * 文件建好了但打不开（编辑器不在或拒绝）也要说，文件已经在资源管理器里了。
 */
export async function createChapter(files: Pick<FilesService, "list" | "create">, commands: Pick<CommandService, "execute">, text: TextResolver): Promise<string | null> {
    const listing = await files.list("project://");
    const taken = new Set(listing.ok ? listing.value.entries.map((entry) => entry.name) : []);
    const name = freeChapterName(text.t(projectsText("welcome.chapterName")), taken);
    const address = `project://${name}`;
    const created = await files.create(address, "file");
    if (!created.ok) return text.t(projectsText("welcome.createFailed", {reason: created.code}));
    const opened = await commands.execute("nbook.editor.open", {address, mode: "permanent"}, {source: "user"});
    return opened.ok ? null : text.t(projectsText("welcome.openFailed", {name, reason: text.t(opened.reason)}));
}

export function createWelcomeHost(options: WelcomeHostOptions): Component {
    return defineComponent({
        name: "WelcomeHost",
        props: {context: {type: Object as PropType<EditorPageContext>, required: true}},
        setup: (props) => {
            const description = shallowRef<string | null>(null);
            const stats = shallowRef<ShelfStats | null>(null);
            const quick = shallowRef<ReadonlyArray<{readonly address: string; readonly name: string; readonly kind: "file" | "folder"}>>([]);
            const creating = shallowRef(false);
            const problem = shallowRef<string | null>(null);
            const now = shallowRef(new Date(options.now()).toISOString());
            /** 作品信息与项目根的列出还在取：根上标 aria-busy，免得把“还没有简介”这类缺省当成结果（截图工具也据此等）。 */
            const loading = shallowRef(options.project !== null);

            const execute = (command: string, args: Record<string, unknown>): void => {
                void options.commands.execute(command, args, {source: "user"}).then((result) => {
                    if (!result.ok) options.report(`${command} failed: ${diagnosticText(result.reason)}`);
                });
            };

            onMounted(async () => {
                const project = options.project;
                if (project === null) return;
                const files = options.files;
                const [shelf, listing] = await Promise.all([options.remote.shelf({}), files === null ? null : files.list("project://")]);
                loading.value = false;
                now.value = new Date(options.now()).toISOString();
                if (shelf.ok) {
                    const item = shelf.value.find((candidate) => candidate.id === project.id);
                    description.value = item?.description ?? null;
                    stats.value = item?.stats ?? null;
                } else {
                    options.report(`The welcome page could not read the project info: ${shelf.code}`);
                }
                if (listing === null) return;
                if (listing.ok) {
                    quick.value = quickEntries(listing.value.entries);
                } else {
                    options.report(`The welcome page could not list the project root: ${listing.code}`);
                }
            });

            /** 新建章节（`createChapter`）；进行中按钮忙，失败原因写在按钮下。 */
            const newChapter = async (): Promise<void> => {
                if (creating.value) return;
                const files = options.files;
                if (files === null) {
                    problem.value = options.text.t(projectsText("welcome.createFailed", {reason: NO_FILES}));
                    return;
                }
                creating.value = true;
                problem.value = null;
                try {
                    problem.value = await createChapter(files, options.commands, options.text);
                    if (problem.value !== null) options.report(problem.value);
                } finally {
                    creating.value = false;
                }
            };

            return () => h(options.component, {
                title: options.project?.title ?? null,
                description: description.value,
                stats: stats.value,
                now: now.value,
                quick: quick.value,
                recent: props.context.recent,
                creating: creating.value,
                problem: problem.value,
                shortcut: options.shortcut(),
                "aria-busy": loading.value ? "true" : undefined,
                "onNew-chapter": () => void newChapter(),
                onOpen: (address: string) => execute("nbook.editor.open", {address, mode: "permanent"}),
                onReveal: (address: string) => execute("nbook.files.reveal", {address, expand: true}),
                onShelf: () => execute(BACK_TO_SHELF_COMMAND, {}),
            });
        },
    });
}
