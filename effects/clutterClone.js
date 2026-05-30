// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Unpickable Clutter.Clone — passes through Looking Glass hit tests.
 * Adapted from liquid-glass (MIT), Ryosuke Watanabe.
 */

import {Clutter, GObject} from '../dependencies/gi.js';

export const UnpickableClone = GObject.registerClass({
    GTypeName: 'GnomeDockUnpickableClone',
}, class UnpickableClone extends Clutter.Clone {
    vfunc_pick(_pickContext) {
        // No-op: skip hit testing on clone actors.
    }
});
