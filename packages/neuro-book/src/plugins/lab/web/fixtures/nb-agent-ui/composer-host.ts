/**
 * Lab 里扮演 Agent 输入框的宿主：处理输入框发出的 action 并改写场景的 ctx。对话视图与输入框的夹具共用。
 *
 * - 发送：空闲时追加一条用户消息；运行中的补充说明、排队消息进 `composer.queued`。都记入输入历史，并给出新版本的空草稿。
 * - 附件：先“上传中”，约 0.9 秒后就绪，目标是会话附件地址 `session://attachments/名称`，图片用本地对象地址作缩略图与原图；
 *   打开“下次上传失败”时下一次上传以失败结束，重试后成功。
 * - 模式、模型、思考档位、停止、几个命令（plan、mode、model、clear）直接改 ctx；其余命令只记进事件日志。
 * - 触发菜单：`@` 与 `$` 用与 PromptEditor 夹具相同的数据，`$` 首次打开时先“正在加载”。
 */
import {computed, onBeforeUnmount, ref} from "vue";
import type {
    AgentConversationContext,
    AgentViewAction,
    ComposerAttachmentView,
    ComposerView,
    MessageView,
    TriggerMenu,
    TriggerMenuContext,
} from "@notnotype/nb-agent-ui";
import {acceptSubmission, applyComposerAction, nextMode} from "@notnotype/nb-agent-ui";
import {labAttachmentUrls} from "./data";
import {referenceMenu, skillMenu} from "../prompt-scene/menu";

type HostOptions = {
    ctx: () => AgentConversationContext;
    write: (patch: Partial<AgentConversationContext>) => void;
};

export function useLabComposerHost(options: HostOptions) {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    /** 上传完成的附件目标 → 本地对象地址；卸载时一并释放。 */
    const uploaded = new Map<string, string>();
    const skillsLoaded = ref(false);
    const failNextUpload = ref(false);

    function later(ms: number, run: () => void): void {
        const timer = setTimeout(() => {
            timers.delete(timer);
            run();
        }, ms);
        timers.add(timer);
    }

    onBeforeUnmount(() => {
        timers.forEach((timer) => clearTimeout(timer));
        uploaded.forEach((url) => URL.revokeObjectURL(url));
    });

    function composer(): ComposerView {
        return options.ctx().composer;
    }

    function writeComposer(patch: Partial<ComposerView>): void {
        options.write({composer: {...composer(), ...patch}});
    }

    function setAttachment(localId: string, next: ComposerAttachmentView | null): void {
        const rest = composer().attachments.filter((item) => item.localId !== localId);
        writeComposer({attachments: next === null ? rest : [...rest, next]});
    }

    /** 名称在会话内唯一；重名时补一个序号。 */
    function uniqueTarget(name: string): string {
        const safe = name.replace(/[\s()]+/gu, "-") || "attachment";
        let target = `session://attachments/${safe}`;
        for (let index = 2; uploaded.has(target) || labAttachmentUrls[target] !== undefined; index += 1) {
            target = `session://attachments/${index}-${safe}`;
        }
        return target;
    }

    /** 文件只在内存里；重试时要用到它。 */
    const files = new Map<string, File>();

    function upload(localId: string): void {
        setAttachment(localId, {localId, state: "uploading"});
        const fail = failNextUpload.value;
        failNextUpload.value = false;
        later(900, () => {
            if (!composer().attachments.some((item) => item.localId === localId)) {
                return;
            }
            const file = files.get(localId);
            if (fail || !file) {
                setAttachment(localId, {localId, state: "failed", error: "模拟：网络中断"});
                return;
            }
            const target = uniqueTarget(file.name);
            uploaded.set(target, URL.createObjectURL(file));
            setAttachment(localId, {localId, state: "ready", target});
        });
    }

    function submit(text: string, delivery: "prompt" | "steer" | "followup"): void {
        const current = options.ctx();
        const accepted = acceptSubmission(current.composer, text);
        if (delivery === "prompt") {
            const message: MessageView = {
                kind: "user", id: `lab-user-${current.messages.length}`, timestamp: current.now,
                intent: "normal", blocks: [{kind: "text", text}], contentOmitted: false,
            };
            options.write({messages: [...current.messages, message], composer: accepted});
            return;
        }
        options.write({composer: {...accepted, queued: [...current.composer.queued, {id: `lab-queued-${Date.now()}`, text, delivery}]}});
    }

    function runCommand(name: string, argsText: string): void {
        const current = composer();
        const accepted = acceptSubmission(current, `/${name} ${argsText}`);
        const done: Partial<ComposerView> = {draft: accepted.draft, recall: accepted.recall};
        if (name === "plan" && current.modes.some((mode) => mode.key === "plan")) {
            writeComposer({...done, mode: "plan"});
        }
        else if (name === "mode") {
            const requested = current.modes.find((mode) => mode.key === argsText || mode.label === argsText);
            writeComposer({...done, mode: requested?.key ?? nextMode(current.modes, current.mode) ?? current.mode});
        }
        else if (name === "model") {
            const requested = current.models.find((model) => model.key === argsText || model.label === argsText);
            writeComposer({...done, modelKey: requested?.key ?? current.modelKey});
        }
        else if (name === "clear") {
            options.write({messages: [], composer: {...current, ...done}});
        }
        else {
            writeComposer(done);
        }
    }

    /** 处理输入框的 action；不是输入框的 action 返回 false，由夹具自己处理。 */
    function handle(action: AgentViewAction): boolean {
        const applied = applyComposerAction(composer(), action);
        if (applied !== null) {
            options.write({composer: applied});
            return true;
        }
        switch (action.type) {
            case "composer.submit":
                submit(action.text, action.delivery);
                return true;
            case "composer.stop":
                options.write({run: {status: "idle", phase: ""}});
                return true;
            case "composer.attachmentAdded":
                files.set(action.localId, action.file);
                upload(action.localId);
                return true;
            case "composer.attachmentRetry":
                upload(action.localId);
                return true;
            case "composer.attachmentRemoved":
                files.delete(action.localId);
                setAttachment(action.localId, null);
                return true;
            case "command.run":
                runCommand(action.name, action.argsText);
                return true;
            case "menu.opened":
                if (action.trigger === "$" && !skillsLoaded.value) {
                    later(700, () => {
                        skillsLoaded.value = true;
                    });
                }
                return true;
            default:
                return false;
        }
    }

    /** 数据到达时换一个新函数，编辑器据此按当前查询重新取菜单。 */
    const resolveTriggerMenu = computed(() => {
        const loaded = skillsLoaded.value;
        return (context: TriggerMenuContext): TriggerMenu => {
            if (context.trigger === "@") {
                return referenceMenu(context.query);
            }
            if (context.trigger === "$") {
                return skillMenu(loaded, context.query);
            }
            return {items: [], emptyText: "命令只能写在正文开头"};
        };
    });

    function resolveAttachmentUrl(locator: string): string | null {
        return uploaded.get(locator) ?? labAttachmentUrls[locator] ?? null;
    }

    return {handle, resolveTriggerMenu, resolveAttachmentUrl, failNextUpload, skillsLoaded};
}
