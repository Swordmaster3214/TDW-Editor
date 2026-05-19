import { Fraction } from './fraction.js'
import { Sound } from './sound.js'

// One step in the sequence. The cursor sits between slots.
// Empty sounds array = rest. Multiple sounds = chord (via !combine on export).
// Duration is a Fraction of one beat -- this encodes both subdivision level
// and tuplet grouping in one field.

export class Slot {
    constructor({ sounds = [], duration = Fraction.QUARTER } = {}) {
        this.sounds   = sounds    // Sound[]
        this.duration = duration  // Fraction
    }

    get isRest() {
        return this.sounds.length === 0
    }

    clone() {
        return new Slot({
            sounds:   this.sounds.map(s => s.clone()),
                        duration: new Fraction(this.duration.numerator, this.duration.denominator)
        })
    }

    toJSON() {
        return {
            sounds:   this.sounds.map(s => s.toJSON()),
            duration: this.duration.toJSON()
        }
    }

    static fromJSON(obj) {
        return new Slot({
            sounds:   (obj.sounds || []).map(Sound.fromJSON),
                        duration: Fraction.fromJSON(obj.duration)
        })
    }
}
