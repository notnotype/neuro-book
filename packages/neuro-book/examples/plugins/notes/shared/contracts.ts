import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 调用方拿到的笔记服务；没有“哪个插件”的参数，身份由内核填写。 */
export interface NotesService {
    add(text: string): void;
    list(): ReadonlyArray<string>;
}

export const notesKey: ServiceKey<NotesService> = defineServiceKey<NotesService>("example.notes/notes");
