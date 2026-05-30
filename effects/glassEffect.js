// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Frosted-glass Clutter.ShaderEffect — reference LiquidEffect API, squircle mask.
 */

import {Clutter, Gio, GLib, GObject} from '../dependencies/gi.js';

const SHADER_PATH = 'effects/glass.frag';

const DEFAULTS = {
    edgeSmoothing: 2.0,
    squircleExponent: 3.8,
};

function loadShaderSource(extensionPath) {
    try {
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([extensionPath, SHADER_PATH]));
        const [ok, bytes] = file.load_contents(null);
        if (!ok)
            throw new Error('load_contents returned false');
        return new TextDecoder().decode(bytes);
    } catch (e) {
        logError(e, 'gnome-dock: failed to load glass shader');
        return '';
    }
}

function floatValue(value) {
    const gval = new GObject.Value();
    gval.init(GObject.TYPE_FLOAT);
    gval.set_float(value);
    return gval;
}

function hexToRgb(hex) {
    if (!hex?.startsWith('#') || hex.length !== 7)
        return [0.08, 0.08, 0.09];
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
    ];
}

export const GlassEffect = GObject.registerClass({
    GTypeName: 'GnomeDockGlassEffect',
}, class GlassEffect extends Clutter.ShaderEffect {
    _init(params = {}) {
        const extensionPath = params.extensionPath;
        const settings = params.settings;
        delete params.extensionPath;
        delete params.settings;

        super._init(params);

        this._extensionPath = extensionPath;
        this._settings = settings;
        this._settingsIds = [];
        this._padding = 20;

        const src = loadShaderSource(this._extensionPath);
        if (src)
            this.set_shader_source(src);

        this._setFloat('resolution_x', 0);
        this._setFloat('resolution_y', 0);
        this._setFloat('corner_radius', 22);
        this._setFloat('padding', this._padding);
        this._setFloat('isDock', 0);
        this._setFloat('edge_smoothing', DEFAULTS.edgeSmoothing);
        this._setFloat('squircle_exponent', DEFAULTS.squircleExponent);
        this._setFloat('tint_strength', 0.35);
        this._setFloat('tint_r', 0.08);
        this._setFloat('tint_g', 0.08);
        this._setFloat('tint_b', 0.09);

        if (this._settings)
            this._bindSettings();
    }

    _setFloat(name, value) {
        this.set_uniform_value(name, floatValue(value));
    }

    _bindSettings() {
        const s = this._settings;

        const bindDouble = (key, uniform) => {
            const apply = () => this._setFloat(uniform, s.get_double(key));
            apply();
            this._settingsIds.push(s.connect(`changed::${key}`, apply));
        };

        bindDouble('gd-glass-tint-strength', 'tint_strength');

        const applyTint = () => {
            const [r, g, b] = hexToRgb(s.get_string('gd-glass-tint-color'));
            this._setFloat('tint_r', r);
            this._setFloat('tint_g', g);
            this._setFloat('tint_b', b);
        };
        applyTint();
        this._settingsIds.push(s.connect('changed::gd-glass-tint-color', applyTint));

        const applySmoothing = () => {
            const sm = s.get_double('gd-glass-corner-smoothing');
            this._setFloat('squircle_exponent', 2.0 + sm * 3.0);
        };
        applySmoothing();
        this._settingsIds.push(s.connect('changed::gd-glass-corner-smoothing', applySmoothing));
    }

    cleanup() {
        if (!this._settings)
            return;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
    }

    destroySettings() {
        this.cleanup();
    }

    setIsDock(isDock) {
        this._setFloat('isDock', isDock ? 1 : 0);
    }

    setPadding(pad) {
        this._padding = pad;
        this._setFloat('padding', pad);
    }

    setTintColor(r, g, b) {
        this._setFloat('tint_r', r);
        this._setFloat('tint_g', g);
        this._setFloat('tint_b', b);
    }

    setTintStrength(strength) {
        this._setFloat('tint_strength', strength);
    }

    setCornerRadius(radius) {
        this._setFloat('corner_radius', radius);
    }

    setAnimationScale(_scale) {
        // No-op for frosted glass; kept for reference API compatibility.
    }

    setResolution(width, height) {
        this._setFloat('resolution_x', width);
        this._setFloat('resolution_y', height);
    }
});
