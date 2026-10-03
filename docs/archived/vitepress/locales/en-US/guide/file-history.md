# Change Inbox and File History

Letting an AI edit your manuscript only works if **you can see what it changed and take it back**.

The **Changes** button in the top bar is that entry point.

## What It Records

Every file write goes into the ledger, whoever did it:

- your saves in the editor
- the Agent's `write` / `edit` / `apply_patch`
- external tools writing to disk directly (reconciled after the fact by the file watcher)

The ledger is an **append-only** event stream over content-addressed snapshots — records are never rewritten, and identical content is never stored twice.

## The Inbox

A change card sits above the Agent input box, collapsed by default; expand it to see which files this round touched. For a deeper review, open the full history dialog.

For each change you can:

- **Accept**: acknowledge the change and clear it from your queue
- **Revert**: restore the file to its state before the change

The accepted position is recorded **per user and per path**, while the session cursor is recorded per session — so when several people or several sessions work at once, each one's "what have I already seen" stays independent.

Reverting and restoring are first-class events in their own right, so they reappear in the notification channel.

## What the Agent Sees

Every turn the Agent receives a **file change notice**: a Git-style English summary telling it which files changed since the last turn, and who changed them.

How detailed that notice is depends on the profile: leader gets the full version, writer gets a condensed one, Inline AI gets none. A single-file diff has a length cap (512 lines by default); past that it reports the fact without pasting the content.

Two kinds of paths are **reported as fact only, with no content**: sensitive paths and deleted paths. They are never promised in the inbox, and their text is not read out on the server either.

## Where the Data Lives

One separate history database per project:

```text
<project>/.nbook/history.sqlite
```

Retention is tiered and sparse — recent history is kept in full, older history keeps the last version of each day. The parameters are configurable.

::: danger Read this before you share
`history.sqlite` holds **full-text snapshots, including content you have already deleted**. A project download bundle contains a snapshot of it, and the frontend warns you about this.

To send your work to someone, send the Markdown files under `manuscript/`. It never enters the shareable log bundle — that one is allowlisted and contains only logs. See [Privacy Boundaries](/en/operations#privacy-boundaries).
:::

## Not Built Yet

The single-file timeline view and the full interface for recovering deletions are not finished; the inbox is the main entry point today. The underlying event stream already supports both views.

## Keep Reading

- [The Three Agent Modes](/en/agent/modes): how read-only mode blocks writes at the source.
- [Running, Data and Privacy](/en/operations)
