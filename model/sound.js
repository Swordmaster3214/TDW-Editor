// A single sound within a slot. Multiple sounds in one slot form a chord,
// which maps to !combine directives on export.

export class Sound {
    constructor({ id, pitch = 0, volume = null, panning = 0 } = {}) {
        this.id = id          // TDW sound ID string, e.g. 'kick', 'ding', 'among_us'
        this.pitch = pitch    // Semitone offset from default. 0 = no change.
        this.volume = volume  // 0-100 override, or null to inherit
        this.panning = panning // Panning value: -10 (Left) to 10 (Right). 0 = Center.
    }

    clone() {
        return new Sound({ id: this.id, pitch: this.pitch, volume: this.volume, panning: this.panning })
    }

    toJSON() {
        const obj = { id: this.id, pitch: this.pitch }
        if (this.volume !== null) obj.volume = this.volume
            if (this.panning !== 0) obj.panning = this.panning
                return obj
    }

    static fromJSON(obj) {
        return new Sound(obj)
    }
}
