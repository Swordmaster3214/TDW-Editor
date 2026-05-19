import { Slot } from './slot.js'

// The full project. Saved as .tde (JSON). Exported to .🗿 for TDW.
// Time signature is metadata for the UI -- it doesn't affect TDW export
// directly, but it drives how the cursor groups slots into measures.

export class Project {
    constructor({
        name          = 'Untitled',
        bpm           = 120,
        timeSignature = { numerator: 4, denominator: 4 },
        slots         = []
    } = {}) {
        this.name          = name
        this.bpm           = bpm           // Base BPM (quarter note = one beat)
        this.timeSignature = timeSignature // { numerator, denominator }
        this.slots         = slots         // Slot[]
    }

    // How many beats fit in one measure
    get beatsPerMeasure() {
        return this.timeSignature.numerator
    }

    clone() {
        return new Project({
            name:          this.name,
            bpm:           this.bpm,
            timeSignature: { ...this.timeSignature },
            slots:         this.slots.map(s => s.clone())
        })
    }

    toJSON() {
        return {
            version:       1,
            name:          this.name,
            bpm:           this.bpm,
            timeSignature: this.timeSignature,
            slots:         this.slots.map(s => s.toJSON())
        }
    }

    static fromJSON(obj) {
        if (obj.version !== 1) {
            throw new Error(`Unsupported .tde version: ${obj.version}`)
        }
        return new Project({
            name:          obj.name,
            bpm:           obj.bpm,
            timeSignature: obj.timeSignature,
            slots:         (obj.slots || []).map(Slot.fromJSON)
        })
    }
}
