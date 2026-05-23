import { Slot }        from './slot.js'
import { ControlSlot } from './controlslot.js'

// Dispatch JSON to the right class. ControlSlot objects carry type:'control';
// everything else is a regular Slot. This fixes the latent bug where
// ControlSlot JSON was silently passed to Slot.fromJSON and lost its type.
function slotFromJSON(obj) {
    return obj.type === 'control' ? ControlSlot.fromJSON(obj) : Slot.fromJSON(obj)
}

// One lane of the sequencer. Tracks are independent: each has its own
// slot list plus mute/solo flags used during playback and export.
export class Track {
    constructor({ name = 'Track 1', slots = [], muted = false, solo = false } = {}) {
        this.name  = name
        this.slots = slots  // (Slot | ControlSlot)[]
        this.muted = muted
        this.solo  = solo
    }

    clone() {
        return new Track({
            name:  this.name,
            slots: this.slots.map(s => s.clone()),
                         muted: this.muted,
                         solo:  this.solo,
        })
    }

    toJSON() {
        return {
            name:  this.name,
            slots: this.slots.map(s => s.toJSON()),
            muted: this.muted,
            solo:  this.solo,
        }
    }

    static fromJSON(obj) {
        return new Track({
            name:  obj.name  ?? 'Track',
            slots: (obj.slots || []).map(slotFromJSON),
                         muted: obj.muted ?? false,
                         solo:  obj.solo  ?? false,
        })
    }
}
