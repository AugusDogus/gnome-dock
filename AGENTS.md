## Source Code Reference

Source code for dependencies is cached at `~/.opensrc/`.

Use `opensrc path` inside other commands to read source:

\`\`\`bash
rg "pattern" $(opensrc path <package>)
cat $(opensrc path <package>)/path/to/file
\`\`\`

## GNOME Shell Relog Debugging

For GNOME Shell issues that require logging out and back in, prefer journal logging with a stable prefix like `gnome-dock-debug` over HTTP debug collectors. The relogged shell session may outlive or disconnect from the collector, but `log()` entries remain available through `journalctl`.
