/** Lab 里目录选择器的数据来源：一棵固定的目录树，不碰服务端。 */

import type {BrowseEntry} from "nbook/plugins/projects/shared/contracts";
import type {PathPickerSource} from "nbook/plugins/projects/web/components/PathPickerDialog.vue";

const HOME = "/home/writer";
const LIBRARY = `${HOME}/Documents/NeuroBook`;
/** 场景里的缺省作品目录：选择器的缺省起点，也是“作品”分区没设时显示的目录。 */
export const LAB_DEFAULT_LIBRARY = LIBRARY;

const TREE: Record<string, {readonly parent: string | null; readonly entries: BrowseEntry[]}> = {
    "/": {parent: null, entries: [{name: "home", path: "/home", kind: "directory", title: null}]},
    "/home": {parent: "/", entries: [{name: "writer", path: HOME, kind: "directory", title: null}]},
    [HOME]: {parent: "/home", entries: [{name: "Documents", path: `${HOME}/Documents`, kind: "directory", title: null}, {name: "books", path: `${HOME}/books`, kind: "directory", title: null}]},
    [`${HOME}/Documents`]: {parent: HOME, entries: [{name: "NeuroBook", path: LIBRARY, kind: "directory", title: null}]},
    [`${HOME}/books`]: {parent: HOME, entries: []},
    [LIBRARY]: {parent: `${HOME}/Documents`, entries: [
        {name: "changyexing", path: `${LIBRARY}/changyexing`, kind: "registered", title: null},
        {name: "beifang-yibei", path: `${LIBRARY}/beifang-yibei`, kind: "project", title: "北方以北"},
        {name: "drafts", path: `${LIBRARY}/drafts`, kind: "directory", title: null},
        {name: "old-notes", path: `${LIBRARY}/old-notes`, kind: "directory", title: null},
    ]},
    [`${LIBRARY}/drafts`]: {parent: LIBRARY, entries: []},
    [`${LIBRARY}/old-notes`]: {parent: LIBRARY, entries: [{name: "2024", path: `${LIBRARY}/old-notes/2024`, kind: "directory", title: null}]},
};

export const labPathPickerSource: PathPickerSource = {
    list: async (path) => {
        const key = path ?? LIBRARY;
        const node = TREE[key];
        return node === undefined ? {ok: false, message: `列不出目录：目录不存在：${key}`} : {ok: true, value: {path: key, parent: node.parent, entries: node.entries}};
    },
};
