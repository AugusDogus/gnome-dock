// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Layout manager for glass clone layers.
 *
 * Reports zero preferred size so full-screen Clutter.Clone children cannot
 * inflate parent allocation. Children are positioned manually each frame.
 */

import {Clutter, GObject} from '../dependencies/gi.js';

export const CloneLayoutManager = GObject.registerClass({
    GTypeName: 'GnomeDockCloneLayoutManager',
}, class CloneLayoutManager extends Clutter.LayoutManager {
    vfunc_get_preferred_width(_container, _forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_container, _forWidth) {
        return [0, 0];
    }

    vfunc_allocate(container, box) {
        container.set_allocation(box);
    }
});
