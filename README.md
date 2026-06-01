<div align="center">
    <br/>
    <p>
        <img src="media/logo.svg"
            title="GNOME Dock" alt="GNOME Dock logo" width="120" />
        <h1>GNOME Dock</h1>
    </p>
    <p width="120">
        A standalone GNOME Shell dock tuned for a floating bottom-dock workflow and frosted-glass squircle visuals.
    </p>
    <video width="1460" height="1016" title="GNOME Dock" src="https://github.com/user-attachments/assets/5add573c-6b99-4a71-91e4-a586fc996ecd"></video>
</div>

## Features

- Floating bottom dock with frosted-glass squircle visuals
- **Hide apps from the dock**: right-click any dock icon and choose _Hide from Dock_ to keep it out of the dash. Hidden apps are managed from the extension preferences, where a _Show hidden apps_ toggle reveals them in-dock and a collapsible _Hidden apps_ list lets you unhide them by name. The [Vicinae](https://github.com/vicinaehq/vicinae) launcher overlay is hidden by default and is always ignored by intellihide.

## Tech Stack

- [GNOME Shell](https://gitlab.gnome.org/GNOME/gnome-shell) extension platform
- [GJS](https://gjs.guide/) for extension logic
- GNOME Shell UI libraries: `Clutter`, `St`, `Meta`, and `Shell`
- GLSL fragment shaders for the frosted-glass squircle mask
- SASS (`sassc`, `dart-sass`, or `ruby-sass`) for stylesheet compilation
- GNU Make for build, packaging, and installation
- gettext for translations

## Project Structure

The project is organized as a GNOME Shell extension with a custom glass rendering pipeline:

```bash
gnome-dock/
├── extension.js          # Extension entrypoint
├── docking.js            # Dock lifecycle and top-level integration
├── dash.js               # Dash layout and container behavior
├── appIcons.js           # App icon behavior, menus, and labels
├── prefs.js              # Preferences UI
├── AGENTS.md             # Repo guidance for coding agents and debugging workflow
├── _stylesheet.scss      # Main stylesheet source
├── effects/
│   ├── glassDock.js      # Glass background actor and clone pipeline
│   ├── glassEffect.js    # Shader effect wrapper and Lisse corner parameters
│   ├── glass.frag        # Frosted-glass squircle fragment shader
│   └── clutterClone.js   # Clone helpers used by the glass pipeline
├── schemas/
│   └── org.gnome.shell.extensions.gnome-dock.gschema.xml
├── media/                # Logos and other extension assets
├── po/                   # Translations
└── dependencies/         # Shell and GI import shims
```

## Getting Started

### Prerequisites

- GNOME Shell `45` through `50`
- `make`
- `glib-compile-schemas`
- `gettext` (`msgfmt`)
- A SASS implementation: `sassc`, `dart-sass` (`sass`), or `ruby-sass`

### 1. Clone the Repository

```bash
git clone https://github.com/AugusDogus/gnome-dock.git
cd gnome-dock
```

### 2. Choose a SASS Implementation (Optional)

By default the build will try to use `sassc`. If you want to force another implementation:

```bash
export SASS=dart
# or...
export SASS=ruby
```

### 3. Build and Install

```bash
make install-local
```

This installs the extension into:

```bash
~/.local/share/gnome-shell/extensions/gnome-dock@augie.dev
```

### 4. Reload GNOME Shell

- On Xorg: <kbd>Alt</kbd> + <kbd>F2</kbd>, then `r`, then <kbd>Enter</kbd>
- On Wayland: log out and log back in if needed

Then enable the extension using _GNOME Extensions_ or `gnome-extensions`.

## Available Commands

```bash
make extension      # Build compiled assets
make install-local  # Install the extension to ~/.local/share/gnome-shell/extensions
make install        # Alias for install-local
make zip-file       # Build a distributable zip archive
make clean          # Remove generated build artifacts
make mergepo        # Merge translation updates
```

Bugs should be reported at [github.com/AugusDogus/gnome-dock/issues](https://github.com/AugusDogus/gnome-dock/issues).

## Credits

GNOME Dock descends from [Dash to Dock](https://github.com/micheleg/dash-to-dock) by Michele Gaio and contributors. Much of the original dock infrastructure originates from that project, and this fork would not exist without their work.

The dock's squircle corner math is derived from [Lisse](https://github.com/JaceThings/Lisse) by Jace.

## License

GNOME Dock is distributed under the terms of the GNU General Public License, version 2 or later. See the `COPYING` file for details.
