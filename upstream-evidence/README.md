# Evidence for two fixes to the redesign stack

Before/after captures and diffs for two rendering defects found on
`pingdotgg/t3code` `maria/redesign/6-workspace-panes` at `c4e5dfd0`, while clicking through the
mocked preview built from that branch. Chrome Beta 159, macOS, dark theme. Browser zoom is emulated as
`deviceScaleFactor = 2 x zoom` (a Retina laptop).

The captures show her branch's own UI code running on planted data. The only stylesheet that is not
hers is the preview's notice pill, which matches none of these selectors.

| File | What it is |
|---|---|
| `ghost-hover.diff` | `surface-ghost-hover` paints its gradient over the border box (+1/-1) |
| `ghost-buttons-before-after.png` | hovered ghost buttons at 100% and 200%, and the top and bottom edge of "More" at 400% |
| `ghost-buttons-all-controls.png` | the same edge crops for all four controls |
| `tab-strip.diff` | fill 1px under the joined tab's foot; middle piece 8px wide (+14/-2) |
| `tab-strip-before-after.png` | two tabs, eight zoom levels |
| `tab-strip-single-tab.png` | one tab, eight zoom levels |

Both diffs apply cleanly to `c4e5dfd0`, separately and together.
