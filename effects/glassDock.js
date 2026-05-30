// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Frosted glass dock — near-verbatim port of liquid-glass DashManager pipeline.
 * Geometry/clone lifecycle follows the reference; shader is frosted squircle only.
 */

import {Clutter, GLib, Meta, Shell, St} from '../dependencies/gi.js';
import {Main} from '../dependencies/shell/ui.js';

import {UnpickableClone} from './clutterClone.js';
import {GlassEffect} from './glassEffect.js';

const MAX_BLUR_RADIUS = 60;
const SHADER_PADDING = 20;

function hexToColorArray(hex) {
    if (!hex?.startsWith('#') || hex.length !== 7)
        return [0.08, 0.08, 0.09];
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
    ];
}

export class GlassDock {
    constructor({extensionPath, dash, dockContainer, settings}) {
        this._extensionPath = extensionPath;
        this._targetActor = dash;
        this._dash = dash;
        this._dockContainer = dockContainer;
        this._settings = settings;

        this._bgActor = null;
        this._clipBox = null;
        this._blurEffect = null;
        this._effect = null;

        this._glassExpand = 0;

        this._bgClone = null;
        this._windowClonesContainer = null;
        this._overviewCloneContainer = null;
        this._windowClones = new Map();
        this._overviewClone = null;
        this._appDisplayClone = null;
        this._searchClone = null;

        this._settingsSignals = [];
        this._objectSignals = [];
        this._frameSyncId = 0;
        this._stackRetryId = 0;
        this._active = false;
        this._stacked = false;
        this._sliderConnected = false;

        this._lastAbsX = undefined;
        this._lastAbsY = undefined;
        this._lastTW = undefined;
        this._lastTH = undefined;
        this._stableDeltaW = undefined;
        this._stableDeltaH = undefined;
        this._lastBgW = undefined;
        this._lastBgH = undefined;
        this._lastBgX = undefined;
        this._lastBgY = undefined;
        this._lastBaseW = undefined;
        this._lastBaseH = undefined;
        this._prevFrameBaseW = undefined;
        this._stableGlassH = undefined;
        this._stableGlassAbsY = undefined;

        this._marginValue = 0;
        this._dashBackgroundHidden = false;
    }

    isActive() {
        return this._active;
    }

    setup() {
        if (this._active)
            return;
        this._active = true;

        log('gnome-dock: frosted glass pipeline starting');

        this._bindSettings();
        this._applyEffect();
    }

    _bindSettings() {
        const connectSetting = (key, callback) => {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, callback.bind(this)));
        };

        connectSetting('gd-glass-blur', () => this._applyBlurRadius());
        connectSetting('gd-glass-tint-color', () => this._applyTintSettings());
        connectSetting('gd-glass-tint-strength', () => this._applyTintSettings());
        connectSetting('gd-glass-corner-radius', () => {
            this._lastBgW = undefined;
        });
    }

    _applyEffect() {
        this._targetActor.set_pivot_point(0.5, 0.5);

        this._bgActor = new Clutter.Actor({
            name: 'gnomeDockGlassBackground',
            clip_to_allocation: false,
            reactive: false,
        });
        this._bgActor.set_size(1, 1);
        this._bgActor.set_pivot_point(0, 0);

        this._clipBox = new Clutter.Actor({
            name: 'gnomeDockGlassClipBox',
            clip_to_allocation: true,
            reactive: false,
        });
        this._clipBox.set_size(1, 1);
        this._bgActor.add_child(this._clipBox);

        const blurStrength = this._settings.get_int('gd-glass-blur') / 100;
        this._blurEffect = new Shell.BlurEffect({
            radius: Math.round(blurStrength * MAX_BLUR_RADIUS),
            mode: Shell.BlurMode.ACTOR,
        });
        this._clipBox.add_effect(this._blurEffect);

        this._effect = new GlassEffect({
            extensionPath: this._extensionPath,
            settings: this._settings,
        });
        this._effect.setPadding(SHADER_PADDING);
        this._applyTintSettings();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._effect.setCornerRadius(
            this._settings.get_int('gd-glass-corner-radius') * scale);
        this._effect.setIsDock(true);
        this._bgActor.add_effect(this._effect);

        this._bgActor.show();

        this._watch(global.display, 'window-created', (_d, metaWindow) => {
            this._trackWindow(metaWindow.get_compositor_private());
        });
        this._watch(global.display, 'restacked', () => {
            if (this._frameSyncId !== 0)
                this._syncGeometry();
        });

        global.get_window_actors().forEach(wa => this._trackWindow(wa));
    }

    _trackWindow(_wa) {
        // Window add/remove handled in _syncGeometry like the reference.
    }

    _applyBlurRadius() {
        if (!this._blurEffect)
            return;
        const t = this._settings.get_int('gd-glass-blur') / 100;
        this._blurEffect.radius = Math.round(t * MAX_BLUR_RADIUS);
    }

    _applyTintSettings() {
        if (!this._effect)
            return;
        const hex = this._settings.get_string('gd-glass-tint-color');
        this._effect.setTintColor(...hexToColorArray(hex));
        this._effect.setTintStrength(this._settings.get_double('gd-glass-tint-strength'));
    }

    onDockChromeTracked() {
        if (!this._active)
            return;
        this._ensureStacked();
        this.updateVisibility();
    }

    onDockReady() {
        if (!this._active)
            return;
        this._ensureStacked();
        this._connectSlider();
        this.updateVisibility();
    }

    updateVisibility() {
        if (!this._active)
            return;

        if (!this._ensureStacked()) {
            if (this._stackRetryId === 0) {
                this._stackRetryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._stackRetryId = 0;
                    this.onDockReady();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        if (this._isDockShown()) {
            this._bgActor.show();
            this._startFrameSync();
        } else {
            this._stopFrameSync();
            this._bgActor.hide();
        }
    }

    _watch(object, signal, callback) {
        this._objectSignals.push([object, object.connect(signal, callback)]);
    }

    _getActorGeometrySize(actor) {
        if (!actor)
            return [0, 0];

        try {
            const box = actor.get_allocation_box();
            if (box)
                return [box.x2 - box.x1, box.y2 - box.y1];
        } catch {}

        return actor.get_size();
    }

    _ensureStacked() {
        const dockRoot = this._dockContainer;
        if (!dockRoot?.get_parent())
            return false;

        if (dockRoot.get_parent() !== Main.layoutManager.uiGroup)
            return false;

        if (!this._stacked) {
            if (this._bgActor.get_parent())
                this._bgActor.get_parent().remove_child(this._bgActor);
            Main.layoutManager.uiGroup.insert_child_below(this._bgActor, dockRoot);
            this._stacked = true;
        } else {
            Main.layoutManager.uiGroup.set_child_above_sibling(dockRoot, this._bgActor);
        }

        return true;
    }

    _connectSlider() {
        if (this._sliderConnected)
            return;
        let parent = this._dash.get_parent();
        while (parent) {
            if ('slide_x' in parent) {
                this._sliderConnected = true;
                this._watch(parent, 'notify::slide-x', () => this.updateVisibility());
                break;
            }
            parent = parent.get_parent();
        }
    }

    _isDockShown() {
        if (!this._stacked || !this._dash.mapped || !this._dash.visible)
            return false;

        if (this._dockContainer.opacity === 0 || this._dash.opacity === 0)
            return false;

        let parent = this._dash.get_parent();
        while (parent) {
            if ('slide_x' in parent) {
                if (this._settings.get_boolean('dock-fixed'))
                    return true;
                return parent.slide_x > 0.02;
            }
            parent = parent.get_parent();
        }
        return true;
    }

    _buildClones() {
        if (!this._bgActor)
            return;

        if (this._bgClone) {
            this._bgClone.destroy();
            this._bgClone = null;
        }
        if (this._windowClonesContainer) {
            this._windowClonesContainer.destroy();
            this._windowClonesContainer = null;
        }
        if (this._overviewCloneContainer) {
            this._overviewCloneContainer.destroy();
            this._overviewCloneContainer = null;
        }

        this._bgClone = new UnpickableClone({
            source: Main.layoutManager._backgroundGroup,
        });
        this._clipBox.add_child(this._bgClone);

        this._windowClonesContainer = new Clutter.Actor();
        this._clipBox.add_child(this._windowClonesContainer);

        this._overviewCloneContainer = new Clutter.Actor();
        this._clipBox.add_child(this._overviewCloneContainer);

        this._windowClones.clear();
        this._overviewClone = null;
        this._appDisplayClone = null;
        this._searchClone = null;

        for (const w of global.get_window_actors()) {
            const metaWindow = w.get_meta_window();
            if (!metaWindow || metaWindow.minimized || !w.visible)
                continue;

            const clone = new UnpickableClone({source: w});
            clone.set_position(w.x, w.y);
            this._windowClonesContainer.add_child(clone);
            this._windowClones.set(w, clone);
        }

    }

    _startFrameSync() {
        if (this._frameSyncId !== 0)
            return;

        this._buildClones();

        const later = global.compositor.get_laters();
        const tick = () => {
            this._frameSyncId = 0;
            if (!this._active || !this._bgActor || !this._targetActor.mapped)
                return GLib.SOURCE_REMOVE;

            this._syncGeometry();

            if (this._isDockShown())
                this._frameSyncId = later.add(Meta.LaterType.BEFORE_REDRAW, tick);
            return GLib.SOURCE_REMOVE;
        };

        this._frameSyncId = later.add(Meta.LaterType.BEFORE_REDRAW, tick);
    }

    _stopFrameSync() {
        if (this._frameSyncId !== 0) {
            global.compositor.get_laters().remove(this._frameSyncId);
            this._frameSyncId = 0;
        }
    }

    _findReferenceActor(actor) {
        if (!actor || typeof actor.get_children !== 'function')
            return null;

        if (actor.toString().includes('IndicatorDrawingArea'))
            return actor;

        for (const child of actor.get_children()) {
            const found = this._findReferenceActor(child);
            if (found)
                return found;
        }

        return null;
    }

    _syncGeometry() {
        if (!this._bgActor || !this._targetActor || !this._targetActor.mapped)
            return;

        this._ensureStacked();

        let heldStableHeight = false;

        let sourceActor = this._targetActor;
        for (const child of this._targetActor.get_children()) {
            if (child.has_style_class_name('dash-background')) {
                child.opacity = 0;
                this._dashBackgroundHidden = true;
                sourceActor = child;
            }
        }

        let [baseW, baseH] = this._getActorGeometrySize(sourceActor);
        let [absX, absY] = sourceActor.get_transformed_position();
        if (Number.isNaN(absX) || Number.isNaN(absY))
            return;

        if (sourceActor !== this._targetActor) {
            const [tX, tY] = this._targetActor.get_transformed_position();
            const [tW, tH] = this._getActorGeometrySize(this._targetActor);

            if (absX < tX) {
                baseW -= (tX - absX);
                absX = tX;
            }
            if (absY < tY) {
                baseH -= (tY - absY);
                absY = tY;
            }
            if (absX + baseW > tX + tW)
                baseW = (tX + tW) - absX;
            if (absY + baseH > tY + tH)
                baseH = (tY + tH) - absY;
        }

        let monitorIndex = Main.layoutManager.findIndexForActor(this._targetActor);
        if (monitorIndex < 0)
            monitorIndex = Main.layoutManager.primaryIndex;
        const monitor = Main.layoutManager.monitors[monitorIndex] ||
            Main.layoutManager.primaryMonitor;

        let distLeftCenter = 0;
        let distRightCenter = 0;
        let distTopCenter = 0;
        let distBottomCenter = 0;
        let minCenterDist = -1;

        if (monitor) {
            const dockCenterX = absX + (baseW / 2);
            const dockCenterY = absY + (baseH / 2);

            distLeftCenter = dockCenterX - monitor.x;
            distRightCenter = (monitor.x + monitor.width) - dockCenterX;
            distTopCenter = dockCenterY - monitor.y;
            distBottomCenter = (monitor.y + monitor.height) - dockCenterY;

            minCenterDist = Math.min(
                distLeftCenter, distRightCenter, distTopCenter, distBottomCenter);
        }

        const isHorizontalDock = (minCenterDist === distTopCenter ||
            minCenterDist === distBottomCenter);
        const widthDelta = this._prevFrameBaseW === undefined
            ? null
            : baseW - this._prevFrameBaseW;
        const widthChanged = widthDelta !== null && Math.abs(widthDelta) > 0.5;
        const widthAnimating = this._prevFrameBaseW !== undefined &&
            Math.abs(baseW - this._prevFrameBaseW) > 2;
        const [, targetH] = this._getActorGeometrySize(this._targetActor);
        const thinSourceDuringHorizontalTransition = isHorizontalDock &&
            targetH > 0 && baseH < targetH * 0.5;
        const protectHorizontalHeight = isHorizontalDock &&
            this._stableGlassH !== undefined &&
            (widthChanged || thinSourceDuringHorizontalTransition);

        if (protectHorizontalHeight) {
            baseH = this._stableGlassH;
            if (this._stableGlassAbsY !== undefined)
                absY = this._stableGlassAbsY;
            heldStableHeight = true;
        } else {
            if (this._lastBaseW !== undefined && this._lastBaseH !== undefined) {
                if (isHorizontalDock) {
                    if (Math.abs(Math.abs(baseH - this._lastBaseH) - this._marginValue) <= 1)
                        baseH = this._lastBaseH;
                } else {
                    if (Math.abs(Math.abs(baseW - this._lastBaseW) - this._marginValue) <= 1)
                        baseW = this._lastBaseW;
                }
            }

            const refActor = this._findReferenceActor(this._targetActor);
            if (refActor) {
                const [refW, refH] = refActor.get_size();
                let [refX, refY] = refActor.get_transformed_position();

                if (!Number.isNaN(refX) && !Number.isNaN(refY) && refW > 0 && refH > 0) {
                    let topGap = refY - absY;
                    let bottomGap = (absY + baseH) - (refY + refH);

                    if (topGap < 0 || bottomGap < 0) {
                        const trueRefY = refY - refH;
                        topGap = trueRefY - absY;
                        bottomGap = (absY + baseH) - (trueRefY + refH);
                    }

                    let leftGap = refX - absX;
                    let rightGap = (absX + baseW) - (refX + refW);

                    if (leftGap < 0 || rightGap < 0) {
                        const trueRefX = refX - refW;
                        leftGap = trueRefX - absX;
                        rightGap = (absX + baseW) - (trueRefX + refW);
                    }

                    if (isHorizontalDock) {
                        const diff = Math.abs(bottomGap - topGap);
                        if (diff > 0 && diff < baseH / 2) {
                            if (bottomGap > topGap)
                                baseH -= diff;
                            else {
                                absY += diff;
                                baseH -= diff;
                            }
                        }
                    } else {
                        const diff = Math.abs(rightGap - leftGap);
                        if (diff > 0 && diff < baseW / 2) {
                            if (minCenterDist === distLeftCenter) {
                                if (rightGap > leftGap)
                                    baseW -= diff;
                            } else {
                                if (rightGap > leftGap)
                                    baseW -= diff;
                                else {
                                    absX += diff;
                                    baseW -= diff;
                                }
                            }
                        }
                    }
                }
            }

            if (isHorizontalDock && (targetH === 0 || baseH >= targetH * 0.5)) {
                this._stableGlassH = baseH;
                this._stableGlassAbsY = absY;
            }
        }

        this._lastBaseW = baseW;
        this._lastBaseH = baseH;
        this._prevFrameBaseW = baseW;

        const marginValue = this._marginValue;
        if (monitor && marginValue > 0) {
            this._lastAbsX = absX;
            this._lastAbsY = absY;

            const [tW, tH] = this._getActorGeometrySize(this._targetActor);
            if (this._stableDeltaW === undefined || this._lastTW !== tW) {
                this._stableDeltaW = baseW - tW;
                this._lastTW = tW;
            }
            if (this._stableDeltaH === undefined || this._lastTH !== tH) {
                this._stableDeltaH = baseH - tH;
                this._lastTH = tH;
            }

            const stableBaseW = tW + this._stableDeltaW;
            const stableBaseH = tH + this._stableDeltaH;
            if (minCenterDist === distBottomCenter) {
                const expectedBottom = monitor.y + monitor.height - marginValue;
                if (absY + baseH > expectedBottom) {
                    const overflow = (absY + baseH) - expectedBottom;
                    baseH -= overflow;
                }
                if (baseH > stableBaseH)
                    baseH = stableBaseH;
            } else if (minCenterDist === distTopCenter) {
                const expectedTop = monitor.y + marginValue;
                if (absY < expectedTop) {
                    const diff = expectedTop - absY;
                    absY = expectedTop;
                    baseH -= diff;
                }
                if (baseH > stableBaseH)
                    baseH = stableBaseH;
            } else if (minCenterDist === distRightCenter) {
                const expectedRight = monitor.x + monitor.width - marginValue;
                if (absX + baseW > expectedRight) {
                    const overflow = (absX + baseW) - expectedRight;
                    baseW -= overflow;
                }
                if (baseW > stableBaseW)
                    baseW = stableBaseW;
            } else {
                const expectedLeft = monitor.x + marginValue;
                if (absX < expectedLeft) {
                    const diff = expectedLeft - absX;
                    absX = expectedLeft;
                    baseW -= diff;
                }
                if (baseW > stableBaseW)
                    baseW = stableBaseW;
            }
        }

        const w = Math.max(1, baseW);
        const h = Math.max(1, baseH);

        if (baseW <= 9 || baseH <= 9) {
            this._bgActor.hide();
            return;
        }
        this._bgActor.show();

        let visibleW = baseW;
        let visibleH = baseH;
        if (monitor) {
            if (absX < monitor.x)
                visibleW -= (monitor.x - absX);
            if (absY < monitor.y)
                visibleH -= (monitor.y - absY);
            if (absX + baseW > monitor.x + monitor.width)
                visibleW -= ((absX + baseW) - (monitor.x + monitor.width));
            if (absY + baseH > monitor.y + monitor.height)
                visibleH -= ((absY + baseH) - (monitor.y + monitor.height));
        }

        if (visibleW <= 5 || visibleH <= 5)
            this._bgActor.opacity = 0;
        else
            this._bgActor.opacity = this._targetActor.opacity;

        const shaderPadding = SHADER_PADDING;
        const bgW = Math.max(1, w + (shaderPadding * 2) + (this._glassExpand * 2));
        const bgH = Math.max(1, h + (shaderPadding * 2) + (this._glassExpand * 2));
        const bgX = absX - shaderPadding - this._glassExpand;
        const bgY = absY - shaderPadding - this._glassExpand;

        if (this._lastBgW !== bgW || this._lastBgH !== bgH ||
            this._lastBgX !== bgX || this._lastBgY !== bgY) {
            this._bgActor.set_size(bgW, bgH);
            this._bgActor.set_position(bgX, bgY);

            this._clipBox.set_size(bgW, bgH);
            this._clipBox.set_position(0, 0);

            this._effect.setResolution(bgW, bgH);

            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            this._effect.setCornerRadius(
                this._settings.get_int('gd-glass-corner-radius') * scale);

            this._lastBgW = bgW;
            this._lastBgH = bgH;
            this._lastBgX = bgX;
            this._lastBgY = bgY;
        }

        if (!this._bgClone || !this._windowClonesContainer)
            return;

        this._bgClone.set_position(-bgX, -bgY);
        this._windowClonesContainer.set_position(-bgX, -bgY);

        if (this._overviewCloneContainer)
            this._overviewCloneContainer.set_position(-bgX, -bgY);

        const isOverview = Main.overview.visible ||
            Main.overview.animationInProgress;

        const windows = global.get_window_actors();
        const activeWindows = new Set();
        let zIndex = 0;

        if (!isOverview) {
            if (this._overviewClone) {
                this._overviewClone.destroy();
                this._overviewClone = null;
            }
            if (this._appDisplayClone) {
                this._appDisplayClone.destroy();
                this._appDisplayClone = null;
            }
            if (this._searchClone) {
                this._searchClone.destroy();
                this._searchClone = null;
            }

            this._bgClone.show();

            for (const wActor of windows) {
                const metaWindow = wActor.get_meta_window();
                if (!metaWindow || metaWindow.minimized || !wActor.visible)
                    continue;

                activeWindows.add(wActor);

                let clone = this._windowClones.get(wActor);
                if (!clone) {
                    clone = new UnpickableClone({source: wActor});
                    this._windowClonesContainer.add_child(clone);
                    this._windowClones.set(wActor, clone);
                }

                clone.set_position(wActor.x, wActor.y);
                clone.set_size(wActor.width, wActor.height);
                clone.set_scale(wActor.scale_x, wActor.scale_y);
                clone.translation_x = wActor.translation_x;
                clone.translation_y = wActor.translation_y;
                clone.set_pivot_point(
                    wActor.pivot_point?.x ?? 0,
                    wActor.pivot_point?.y ?? 0);

                this._windowClonesContainer.set_child_at_index(clone, zIndex++);
            }
        } else {
            this._bgClone.show();

            const controls = Main.overview._overview?._controls;

            if (controls) {
                if (controls._workspacesDisplay) {
                    if (!this._overviewClone) {
                        this._overviewClone = new UnpickableClone({
                            source: controls._workspacesDisplay,
                        });
                        this._overviewCloneContainer.add_child(this._overviewClone);
                    }
                    this._syncActorProperties(
                        controls._workspacesDisplay, this._overviewClone);
                }

                if (controls._appDisplay) {
                    if (!this._appDisplayClone) {
                        this._appDisplayClone = new UnpickableClone({
                            source: controls._appDisplay,
                        });
                        this._overviewCloneContainer.add_child(this._appDisplayClone);
                    }
                    this._syncActorProperties(
                        controls._appDisplay, this._appDisplayClone);
                }

                if (controls._searchController?.actor) {
                    if (!this._searchClone) {
                        this._searchClone = new UnpickableClone({
                            source: controls._searchController.actor,
                        });
                        this._overviewCloneContainer.add_child(this._searchClone);
                    }
                    this._syncActorProperties(
                        controls._searchController.actor, this._searchClone);
                }
            }
        }

        for (const [wActor, clone] of this._windowClones) {
            if (!activeWindows.has(wActor)) {
                clone.destroy();
                this._windowClones.delete(wActor);
            }
        }

    }

    _syncActorProperties(source, clone) {
        if (!source || !clone)
            return;

        const [srcX, srcY] = source.get_transformed_position();
        const [w, h] = source.get_size();

        if (Number.isNaN(srcX) || Number.isNaN(srcY) ||
            Number.isNaN(w) || Number.isNaN(h) || w <= 0 || h <= 0) {
            clone.visible = false;
            return;
        }

        clone.set_position(srcX, srcY);
        clone.set_size(w, h);
        clone.set_scale(source.scale_x, source.scale_y);
        clone.set_pivot_point(
            source.pivot_point?.x ?? 0,
            source.pivot_point?.y ?? 0);
        clone.translation_x = 0;
        clone.translation_y = 0;
        clone.opacity = source.opacity;
        clone.visible = source.visible && source.mapped;
    }

    applySettings() {
        this._applyBlurRadius();
        this._applyTintSettings();
        this._lastBgW = undefined;
        if (this._active)
            this.updateVisibility();
    }

    _restoreDashBackground() {
        if (!this._dashBackgroundHidden)
            return;
        for (const child of this._targetActor.get_children()) {
            if (child.has_style_class_name('dash-background'))
                child.opacity = 255;
        }
        this._dashBackgroundHidden = false;
    }

    destroy() {
        this._active = false;
        this._stopFrameSync();

        if (this._stackRetryId !== 0) {
            GLib.source_remove(this._stackRetryId);
            this._stackRetryId = 0;
        }

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        for (const [object, id] of this._objectSignals) {
            try {
                object.disconnect(id);
            } catch (_e) {
                // object may already be destroyed
            }
        }
        this._objectSignals = [];

        this._restoreDashBackground();

        this._effect?.cleanup();
        this._effect = null;

        if (this._bgActor) {
            this._bgActor.destroy();
            this._bgActor = null;
        }

        this._clipBox = null;
        this._blurEffect = null;
        this._bgClone = null;
        this._windowClonesContainer = null;
        this._overviewCloneContainer = null;
        this._windowClones.clear();
        this._overviewClone = null;
        this._appDisplayClone = null;
        this._searchClone = null;
        this._stacked = false;
    }
}
