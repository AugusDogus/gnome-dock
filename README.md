# GNOME Dock

GNOME Dock is a standalone GNOME Shell dock descended from [Dash to Dock](https://github.com/micheleg/dash-to-dock), with a focus on a floating bottom-dock workflow and custom frosted-glass squircle visuals.

It moves the dash out of the overview and turns it into a dock for easier application launching and faster switching between windows and desktops without leaving the desktop view.

## Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version.

### Build Dependencies

To compile the stylesheet you'll need an implementation of SASS. GNOME Dock supports `dart-sass` (`sass`), `sassc`, and `ruby-sass`. Every distro should have at least one of these implementations; we recommend using `dart-sass` (`sass`) or `sassc` over `ruby-sass`, as `ruby-sass` is deprecated.

By default, the build will attempt to use `sassc`. To change this behavior set the `SASS` environment variable to either `dart` or `ruby`.

```bash
export SASS=dart
# or...
export SASS=ruby
```

### Building

Clone the repository and use the included Makefile to install the extension into your home directory.

```bash
git clone https://github.com/AugusDogus/gnome-dock.git
make -C gnome-dock install
```

A Shell reload is required: <kbd>Alt</kbd> + <kbd>F2</kbd> <kbd>r</kbd> <kbd>Enter</kbd> under Xorg, or under Wayland you may have to log out and log back in. The extension then has to be enabled with _GNOME Extensions_ or with _dconf_.

If `msgfmt` is not available on your system, you will see an error message like the following:

```bash
make: msgfmt: No such file or directory
```

In this case install the `gettext` package from your distribution's repository.

## Bug Reporting

Bugs should be reported to the GitHub bug tracker [https://github.com/AugusDogus/gnome-dock/issues](https://github.com/AugusDogus/gnome-dock/issues).

## Credits

GNOME Dock descends from [Dash to Dock](https://github.com/micheleg/dash-to-dock) by Michele Gaio and contributors. Much of the original dock infrastructure originates from that project, and this fork would not exist without their work.

The dock's squircle corner math is derived from [Lisse](https://github.com/JaceThings/Lisse) by Jace.

## License

GNOME Dock is distributed under the terms of the GNU General Public License, version 2 or later. See the COPYING file for details.
