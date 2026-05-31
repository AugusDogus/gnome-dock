// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Liquid-glass Clutter.ShaderEffect — reference LiquidEffect API, squircle mask.
 *
 * The corner geometry is the Figma/Lisse squircle (cubic shoulder + circular
 * arc + cubic shoulder). `getPathParamsForCorner` below is a verbatim port of
 * Lisse's corner math; the shader (effects/glass.frag) traces the same curve as
 * a signed-distance field.
 */

import {Clutter, Gio, GLib, GObject} from '../dependencies/gi.js';

const SHADER_PATH = 'effects/glass.frag';

const DEFAULTS = {
    edgeSmoothing: 2.0,
    cornerRadius: 22,
    cornerSmoothing: 0.6,
    saturation: 1.08,
    displacementScale: 45.0,
    ior: 1.5,
    chromaStrength: 0.006,
};

/* ------------------------------------------------------------------------- *
 * Lisse corner math — verbatim port of @lisse/core corner-params.ts.
 *
 * Copyright (c) Jace (https://github.com/JaceThings/Lisse) — MIT License.
 * Based on Figma's squircle blog post and MartinRGB's approximation:
 *   https://www.figma.com/blog/desperately-seeking-squircles/
 *   https://github.com/MartinRGB/Figma_Squircles_Approximation
 * ------------------------------------------------------------------------- */

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function getPathParamsForCorner({
    cornerRadius,
    cornerSmoothing,
    preserveSmoothing,
    roundingAndSmoothingBudget,
}) {
    if (cornerRadius <= 0)
        return {a: 0, b: 0, c: 0, d: 0, p: 0, arcSectionLength: 0, cornerRadius: 0};

    let p = (1 + cornerSmoothing) * cornerRadius;

    if (!preserveSmoothing) {
        const maxCornerSmoothing = roundingAndSmoothingBudget / cornerRadius - 1;
        cornerSmoothing = Math.min(cornerSmoothing, maxCornerSmoothing);
        p = Math.min(p, roundingAndSmoothingBudget);
    }

    const arcMeasure = 90 * (1 - cornerSmoothing);
    const arcSectionLength =
        Math.sin(toRadians(arcMeasure / 2)) * cornerRadius * Math.sqrt(2);

    const angleAlpha = (90 - arcMeasure) / 2;
    const p3ToP4Distance = cornerRadius * Math.tan(toRadians(angleAlpha / 2));

    const angleBeta = 45 * cornerSmoothing;
    const c = p3ToP4Distance * Math.cos(toRadians(angleBeta));
    const d = c * Math.tan(toRadians(angleBeta));

    let b = (p - arcSectionLength - c - d) / 3;
    let a = 2 * b;

    if (preserveSmoothing && p > roundingAndSmoothingBudget) {
        const p1ToP3MaxDistance =
            roundingAndSmoothingBudget - d - arcSectionLength - c;

        const minA = p1ToP3MaxDistance / 6;
        const maxB = p1ToP3MaxDistance - minA;

        b = Math.min(b, maxB);
        a = p1ToP3MaxDistance - b;
        p = Math.min(p, roundingAndSmoothingBudget);
    }

    return {a, b, c, d, p, arcSectionLength, cornerRadius};
}

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
        this._isDock = false;
        this._resW = 0;
        this._resH = 0;
        this._cornerRadius = DEFAULTS.cornerRadius;
        this._smoothing = DEFAULTS.cornerSmoothing;

        const src = loadShaderSource(this._extensionPath);
        if (src)
            this.set_shader_source(src);

        this._setFloat('resolution_x', 0);
        this._setFloat('resolution_y', 0);
        this._setFloat('padding', this._padding);
        this._setFloat('isDock', 0);
        this._setFloat('edge_smoothing', DEFAULTS.edgeSmoothing);

        this._setFloat('dark_tint', 0);
        this._setFloat('saturation', DEFAULTS.saturation);

        // Refraction + lighting defaults are material constants, not user
        // preferences. These are intentionally close to the sane defaults from
        // liquid-dom / ybouane/liquidglass: strong edge lensing, IOR around real
        // glass, hairline specular, and no user-exposed neon-rim controls.
        this._setFloat('corner_radius', this._cornerRadius);
        this._setFloat('displacement_scale', DEFAULTS.displacementScale);
        this._setFloat('ior', DEFAULTS.ior);
        this._setFloat('chroma_strength', DEFAULTS.chromaStrength);

        this._applyCornerParams();

        if (this._settings)
            this._bindSettings();
    }

    _setFloat(name, value) {
        this.set_uniform_value(name, floatValue(value));
    }

    // Recompute the Lisse corner parameters for the current radius / smoothing,
    // clamped by the corner budget (half the shorter box side) so opposite
    // corners never overlap on a short pill.
    _applyCornerParams() {
        const feather = Math.max(DEFAULTS.edgeSmoothing, 0.75);
        let budget = Number.POSITIVE_INFINITY;
        if (this._resW > 0 && this._resH > 0) {
            const inset = this._isDock
                ? this._padding * 2 + feather * 2
                : this._padding * 2;
            const halfW = Math.max((this._resW - inset) * 0.5, 1);
            const halfH = Math.max((this._resH - inset) * 0.5, 1);
            budget = Math.min(halfW, halfH);
        }

        const radius = Number.isFinite(budget)
            ? Math.min(this._cornerRadius, budget)
            : this._cornerRadius;

        const {a, b, c, d, p, arcSectionLength, cornerRadius} =
            getPathParamsForCorner({
                cornerRadius: radius,
                cornerSmoothing: this._smoothing,
                preserveSmoothing: false,
                roundingAndSmoothingBudget: budget,
            });

        this._setFloat('radius', cornerRadius);
        this._setFloat('p_ext', p);
        this._setFloat('lpa', a);
        this._setFloat('lpb', b);
        this._setFloat('lpc', c);
        this._setFloat('lpd', d);
        this._setFloat('asl', arcSectionLength);

        // The refraction height field uses a plain rounded rect; match its
        // radius to the (budget-clamped) Lisse radius so it tracks the
        // silhouette.
        this._setFloat('corner_radius', cornerRadius);
    }

    _bindSettings() {
        const s = this._settings;

        const applyDarkTint = () => {
            this._setFloat('dark_tint',
                s.get_boolean('gd-glass-dark-tint') ? 1 : 0);
        };
        applyDarkTint();
        this._settingsIds.push(
            s.connect('changed::gd-glass-dark-tint', applyDarkTint));
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
        this._isDock = !!isDock;
        this._setFloat('isDock', isDock ? 1 : 0);
        this._applyCornerParams();
    }

    setPadding(pad) {
        this._padding = pad;
        this._setFloat('padding', pad);
        this._applyCornerParams();
    }

    setCornerRadius(radius) {
        this._cornerRadius = radius;
        this._applyCornerParams();
    }

    setAnimationScale(scale) {
        // Scale the refraction distance with the dock's show/hide animation so
        // the lensing grows in with the surface.
        this._setFloat('displacement_scale', DEFAULTS.displacementScale * scale);
        this._setFloat('chroma_strength', DEFAULTS.chromaStrength * scale);
    }

    setResolution(width, height) {
        this._resW = width;
        this._resH = height;
        this._setFloat('resolution_x', width);
        this._setFloat('resolution_y', height);
        this._applyCornerParams();
    }
});
