// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * GNOME Dock — preferences window.
 *
 * Frosted glass tuning sliders for live iteration before hardcoding defaults.
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

function makeDoubleSlider(settings, key, title, subtitle, {lower, upper, step = 0.01, digits = 2} = {}) {
    const row = new Adw.ActionRow({title, subtitle});
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 10,
        value: settings.get_double(key),
    });
    const scale = new Gtk.Scale({
        adjustment,
        orientation: Gtk.Orientation.HORIZONTAL,
        draw_value: true,
        value_pos: Gtk.PositionType.RIGHT,
        digits,
        hexpand: true,
        width_request: 280,
        valign: Gtk.Align.CENTER,
    });
    adjustment.connect('value-changed', () => {
        settings.set_double(key, adjustment.value);
    });
    settings.connect(`changed::${key}`, () => {
        const v = settings.get_double(key);
        if (Math.abs(adjustment.value - v) > step * 0.5)
            adjustment.value = v;
    });
    row.add_suffix(scale);
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
            title: 'Frosted glass',
            description: 'Blur, tint, and edge treatment — tune live, then we bake in what you like.',
        });
        group.add(makeIntSlider(settings, 'gd-glass-blur',
            'Blur', 'Background blur strength (0–100).'));
        group.add(makeDoubleSlider(settings, 'gd-glass-tint-strength',
            'Tint strength', 'Dark overlay on the glass (0–1).',
            {lower: 0, upper: 1, step: 0.01, digits: 2}));
        group.add(makeDoubleSlider(settings, 'gd-glass-saturation',
            'Saturation', 'Backdrop color boost (1.0 = unchanged).',
            {lower: 0, upper: 2, step: 0.05, digits: 2}));
        group.add(makeDoubleSlider(settings, 'gd-glass-highlight-strength',
            'Edge highlight', 'Inner rim glow — pops on dark backgrounds (0–1).',
            {lower: 0, upper: 1, step: 0.01, digits: 2}));
        group.add(makeDoubleSlider(settings, 'gd-glass-shadow-strength',
            'Drop shadow', 'Outer halo — pops on light backgrounds (0–1).',
            {lower: 0, upper: 1, step: 0.01, digits: 2}));
        group.add(makeIntSlider(settings, 'gd-glass-corner-radius',
            'Corner radius', 'Pill corner radius in logical pixels.',
            {lower: 8, upper: 48}));
        group.add(makeDoubleSlider(settings, 'gd-glass-corner-smoothing',
            'Squircle smoothing', '0 = circular, 1 = Lisse-like.',
            {lower: 0, upper: 1, step: 0.05, digits: 2}));

        page.add(group);
        window.add(page);
        window.set_default_size(520, 320);
    }
}
