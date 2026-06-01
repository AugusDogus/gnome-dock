// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * GNOME Dock — preferences window.
 *
 * Liquid glass preferences.
 */

import Adw from 'gi://Adw';
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
        page.add(dockGroup);

        window.add(page);
        window.set_default_size(520, 360);
    }
}
