// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * GNOME Dock — preferences window.
 *
 * Liquid glass preferences.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function makeIntSlider(settings, key, title, subtitle, {lower = 0, upper = 100} = {}) {
    const row = new Adw.ActionRow({title, subtitle});
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: 1,
        page_increment: 10,
        value: settings.get_int(key),
    });
    const scale = new Gtk.Scale({
        adjustment,
        orientation: Gtk.Orientation.HORIZONTAL,
        draw_value: true,
        value_pos: Gtk.PositionType.RIGHT,
        digits: 0,
        hexpand: true,
        width_request: 280,
        valign: Gtk.Align.CENTER,
    });
    adjustment.connect('value-changed', () => {
        settings.set_int(key, Math.round(adjustment.value));
    });
    settings.connect(`changed::${key}`, () => {
        const v = settings.get_int(key);
        if (Math.round(adjustment.value) !== v)
            adjustment.value = v;
    });
    row.add_suffix(scale);
    return row;
}

function makeSwitch(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle});
    const toggle = new Gtk.Switch({
        active: settings.get_boolean(key),
        valign: Gtk.Align.CENTER,
    });
    toggle.connect('notify::active', () => {
        settings.set_boolean(key, toggle.active);
    });
    settings.connect(`changed::${key}`, () => {
        const v = settings.get_boolean(key);
        if (toggle.active !== v)
            toggle.active = v;
    });
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    return row;
}

function makeHiddenAppsExpander(settings, key) {
    const expander = new Adw.ExpanderRow({
        title: 'Hidden apps',
    });

    let rows = [];
    const rebuild = () => {
        rows.forEach(row => expander.remove(row));
        rows = [];

        const ids = settings.get_strv(key);
        expander.subtitle = ids.length
            ? `${ids.length} app${ids.length === 1 ? '' : 's'} hidden from the dock.`
            : 'Right-click a dock icon and choose “Hide from Dock” to add one.';
        expander.enable_expansion = ids.length > 0;

        for (const id of ids) {
            const info = Gio.DesktopAppInfo.new(id);
            const row = new Adw.ActionRow({
                title: info ? info.get_display_name() : id,
                subtitle: info ? id : 'Not installed',
            });

            const gicon = info?.get_icon();
            if (gicon) {
                row.add_prefix(new Gtk.Image({
                    gicon,
                    pixel_size: 24,
                }));
            }

            const button = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: 'Unhide',
                valign: Gtk.Align.CENTER,
            });
            button.add_css_class('flat');
            button.connect('clicked', () => {
                const current = settings.get_strv(key);
                const index = current.indexOf(id);
                if (index !== -1) {
                    current.splice(index, 1);
                    settings.set_strv(key, current);
                }
            });
            row.add_suffix(button);

            expander.add_row(row);
            rows.push(row);
        }
    };

    rebuild();
    settings.connect(`changed::${key}`, rebuild);
    return expander;
}

export default class GnomeDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Glass',
            icon_name: 'preferences-desktop-display-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Liquid glass',
            description: 'The optical material is intentionally fixed; only the shape and clear/dark material mode are configurable.',
        });
        group.add(makeIntSlider(settings, 'gd-glass-corner-radius',
            'Corner radius', 'Pill corner radius in logical pixels.',
            {lower: 8, upper: 48}));
        group.add(makeSwitch(settings, 'gd-glass-dark-tint',
            'Dark tint', 'Use a smoky dark glass material instead of clear glass.'));
        page.add(group);

        const dockGroup = new Adw.PreferencesGroup({
            title: 'Dock',
            description: 'Apps hidden via an icon\u2019s right-click \u201cHide from Dock\u201d action stay hidden until revealed here.',
        });
        dockGroup.add(makeSwitch(settings, 'show-hidden-apps',
            'Show hidden apps',
            'Temporarily reveal hidden apps so they can be unhidden from the dock.'));
        dockGroup.add(makeHiddenAppsExpander(settings, 'hidden-apps'));
        page.add(dockGroup);

        window.add(page);
        window.set_default_size(520, 360);
    }
}
