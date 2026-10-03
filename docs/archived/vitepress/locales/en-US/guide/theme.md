# Themes and Colors

Writing a novel means staring at a screen for hours. Color is not a decorative question.

The **Frontend** section of the settings page switches themes, and it also lets you build your own.

## 8 Built-in Themes

| Theme | Character |
| --- | --- |
| `light` | Standard light |
| `dark` | Standard dark |
| `sepia` | Warm paper, the easiest on the eyes over a long session |
| `catppuccin` | Soft and low-saturation |
| `dracula` | High-contrast dark |
| `monokai` | Classic dark |
| `one-dark-pro` | Editor-style dark |
| `tokyo-night` | Cool-toned dark |

The theme snapshot is applied as the page boots, so you never get a white flash before the colors land.

## Custom Themes

The theme editor on the settings page can build a complete palette of your own.

A full theme is **36 variables**, but you **do not fill them in one by one**: the editor marks a subset of them as the **core palette**, and once those are set you can regenerate the rest in one click. If you want to fine-tune, the advanced section exposes all 36 individually.

A live preview sits beside the editor, so every color you change shows up immediately.

Supported operations:

- **Copy** any built-in theme and edit the copy
- **Import / export JSON**, for sharing or backup
- Edit and delete your custom themes

The color picker comes with a palette and supports the system eyedropper, so you can pull a color from anywhere on screen.

Custom themes live in the global config and travel with your State Root.

## Notes for Designers

If you are touching code or writing components, there are two hard rules:

- **Colors always consume theme variables.** No Tailwind palette classes (`bg-gray-*` and friends), no `dark:` variants. The light/dark difference is carried by the active theme variables, and a hardcoded color will break at least 7 of the 8 themes.
- **Status semantics have a fixed mapping**: draft / pending review / unsaved use warning, done / synced use success, error / deleted / conflict use danger, running / referenced / explanatory use info, selected / current item / primary action use accent.

A few places are **deliberate exceptions** and are not migrated to status colors: the category palette for plot and reference chips (those are category identity colors), profile template node colors, the prose color picker, and code editor syntax highlighting.

Before adding a component-level variable, confirm that none of the existing background / text / border / accent / status / editor variables can express it, then register it in the theme spec and in all 8 built-in themes.

::: tip Status
Theme system v2.1 and the custom theme editor are implemented; full browser acceptance checks are still in progress.
:::

## Keep Reading

- [Settings](/en/guide/settings)
- [Theme System Reference](https://github.com/notnotype/neuro-book/blob/master/docs/specs/theme/system.md)
