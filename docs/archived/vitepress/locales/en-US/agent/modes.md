# The Three Agent Modes

One Agent, three working modes. What separates them is **whether it can touch your manuscript**.

| Mode | What it can do |
| --- | --- |
| **Normal** | Read and write. Executes tasks normally |
| **Discuss** | Read-only. Talks with you, suggests, looks things up, never touches the manuscript |
| **Plan** | Read-only. Writes the full proposal out for you first, and executes only once you approve |

## Why It Exists

The dangerous moment with an AI is not when it cannot do something, it is when **it goes ahead and does it on its own**. You only wanted to ask whether a passage drags, and it rewrote the paragraph.

Discuss mode solves that: you tell it plainly that this round is discussion only, and it has no ability to write — not because a prompt asked it nicely to keep its hands off, but because **the tool layer never gave it that ability**.

Plan mode solves a different case: the task is large and you want to see how it intends to go about it. It writes the proposal into a plan file, you read it and approve, and only then does it start.

## How to Switch

- the three-state cycle button next to the input box
- the `Shift+Tab` shortcut
- the `/mode` command (`/plan` is an alias for it)

**The Agent can request a switch itself**, using the `switch_mode` tool. But the switch needs your approval — it cannot jump from discuss mode to normal mode on its own and start editing files.

Switching to the mode you are already in is intercepted as a no-op.

## Write Operations Under Read-only Mode

Read-only mode does not hide the write tools; it **stops them before they execute**.

Every tool has to declare explicitly at definition time whether it mutates the workspace (`mutates`). When a tool declared true is called in read-only mode, the harness suspends it and raises an approval. **Approving exempts that one call**, it does not lift the mode restriction.

What this mechanism covers includes file writes (`write` / `edit` / `apply_patch`) and the 7 plot write tools (`save_story_*`).

Two exceptions:

- **Writing plan files in plan mode is exempt.** The output of plan mode is the plan, and writing under `.agent/plan/` does not need approval every time.
- **`bash` is constrained by the prompt.** It is a trusted full shell; the system only confirms that the current project is open and the working directory is trusted, and it makes no promise about restricting file access inside a command. Read-only mode adds no new approval to bash.

## The Prompt Layer

Mode state is injected into the context through two nodes: `ModeReminder` gives the full explanation right after the mode changes and only a light hint once things settle; `ModeAvailabilityReminder` appears only in normal mode, telling the Agent that the other two modes are available.

Profile authors can use `ModeSlot` to swap in their own wording per mode.

## The Interface

The placeholder text in the input box and the session badge follow the current mode. Approval requests appear as bubbles in the conversation, and you approve or reject with a click.

::: tip Status
The three modes are implemented; full browser acceptance checks are still in progress.
:::

## Keep Reading

- [Agent Tools](/en/agent/tools): which tools mutate the workspace.
- [Node Reference](/en/profile-tsx/nodes): which layer `ModeReminder` / `ModeAvailabilityReminder` / `ModeSlot` sit in.
