// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * GNOME Dock — eased cursor-proximity icon response.
 *
 * Scaling is applied to the inner icon actor (BaseIcon) rather than the
 * DashItemContainer that the dock's BoxLayout positions, so the dock's width
 * and height stay stable while the icon graphic visibly responds. Icon
 * centers and extents are cached from allocation changes; pointer-motion
 * handling only runs cheap math and writes scale_x/scale_y/translation_y.
 */

import {Clutter, GObject} from './dependencies/gi.js';

const FALLOFF_RADIUS = 110;
const MAX_SCALE_BOOST = 0.22;
const MAX_LIFT_PX = 3;
const SETTLE_DURATION = 180;

const easeOutCubic = t => {
    const inv = 1 - t;
    return 1 - inv * inv * inv;
};

export const ProximityEffect = GObject.registerClass(
class ProximityEffect extends GObject.Object {
    _init(box, options = {}) {
        super._init();

        this._box = box;
        this._radius = options.radius ?? FALLOFF_RADIUS;
        this._maxBoost = options.maxBoost ?? MAX_SCALE_BOOST;
        this._maxLift = options.maxLift ?? MAX_LIFT_PX;
        this._horizontal = options.horizontal ?? true;
        this._enabled = false;
        this._tracked = new Map();
        this._motionId = 0;
        this._leaveId = 0;
        this._childrenChangedIds = [];
        this._destroyedId = 0;
    }

    enable() {
        if (this._enabled)
            return;
        this._enabled = true;

        this._box.reactive = true;

        this._motionId = this._box.connect(
            'motion-event', this._onMotion.bind(this));
        this._leaveId = this._box.connect(
            'leave-event', this._reset.bind(this));
        this._destroyedId = this._box.connect(
            'destroy', () => this.disable());

        this._childrenChangedIds.push(
            this._box.connect('child-added',
                (_box, child) => this._track(child)));
        this._childrenChangedIds.push(
            this._box.connect('child-removed',
                (_box, child) => this._untrack(child)));

        for (const child of this._box.get_children())
            this._track(child);
    }

    disable() {
        if (!this._enabled)
            return;
        this._enabled = false;

        if (this._motionId) {
            this._box.disconnect(this._motionId);
            this._motionId = 0;
        }
        if (this._leaveId) {
            this._box.disconnect(this._leaveId);
            this._leaveId = 0;
        }
        for (const id of this._childrenChangedIds)
            this._box.disconnect(id);
        this._childrenChangedIds = [];
        if (this._destroyedId) {
            this._box.disconnect(this._destroyedId);
            this._destroyedId = 0;
        }

        for (const child of [...this._tracked.keys()])
            this._untrack(child);
        this._tracked.clear();
    }

    _track(child) {
        if (!child || this._tracked.has(child))
            return;
        const target = this._resolveTarget(child);
        if (!target)
            return;

        target.set_pivot_point(0.5, this._horizontal ? 1.0 : 0.5);

        const entry = {
            target,
            allocationId: child.connect('notify::allocation',
                () => this._invalidate(child)),
            destroyedId: child.connect('destroy',
                () => this._untrack(child)),
            center: 0,
            extent: 0,
            valid: false,
        };
        this._tracked.set(child, entry);
        this._invalidate(child);
    }

    _untrack(child) {
        const entry = this._tracked.get(child);
        if (!entry)
            return;
        if (entry.allocationId)
            child.disconnect(entry.allocationId);
        if (entry.destroyedId)
            child.disconnect(entry.destroyedId);
        this._settle(entry.target, false);
        this._tracked.delete(child);
    }

    _resolveTarget(child) {
        // Prefer the inner icon graphic so layout-positioned wrappers stay the
        // same size. Fall back to the child itself for separators or anything
        // that doesn't have an inner icon.
        const button = child.child ?? child.first_child;
        if (button?.icon)
            return button.icon;
        return button ?? child;
    }

    _invalidate(child) {
        const entry = this._tracked.get(child);
        if (!entry)
            return;
        entry.valid = false;
    }

    _measure(child, entry) {
        if (entry.valid)
            return true;
        const allocation = child.get_allocation_box();
        if (!allocation)
            return false;

        if (this._horizontal) {
            entry.center = (allocation.x1 + allocation.x2) / 2;
            entry.extent = (allocation.x2 - allocation.x1);
        } else {
            entry.center = (allocation.y1 + allocation.y2) / 2;
            entry.extent = (allocation.y2 - allocation.y1);
        }
        entry.valid = entry.extent > 0;
        return entry.valid;
    }

    _onMotion(_actor, event) {
        const [stageX, stageY] = event.get_coords();
        const [okBox, boxX, boxY] = this._box.transform_stage_point(stageX, stageY);
        if (!okBox)
            return Clutter.EVENT_PROPAGATE;

        const cursor = this._horizontal ? boxX : boxY;

        for (const [child, entry] of this._tracked) {
            if (!this._measure(child, entry))
                continue;

            const distance = Math.abs(cursor - entry.center);
            if (distance >= this._radius) {
                this._settle(entry.target, false);
                continue;
            }

            const t = easeOutCubic(1 - distance / this._radius);
            const scale = 1 + t * this._maxBoost;
            const lift = -t * this._maxLift;
            entry.target.scale_x = scale;
            entry.target.scale_y = scale;
            if (this._horizontal)
                entry.target.translation_y = lift;
            else
                entry.target.translation_x = lift;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _reset() {
        for (const entry of this._tracked.values())
            this._settle(entry.target);
        return Clutter.EVENT_PROPAGATE;
    }

    _settle(target, animate = true) {
        if (!target)
            return;
        if (target.scale_x === 1 && target.scale_y === 1 &&
            target.translation_x === 0 && target.translation_y === 0)
            return;

        if (!animate) {
            target.scale_x = 1;
            target.scale_y = 1;
            target.translation_x = 0;
            target.translation_y = 0;
            return;
        }

        target.remove_all_transitions();
        target.ease({
            scale_x: 1,
            scale_y: 1,
            translation_x: 0,
            translation_y: 0,
            duration: SETTLE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }
});
