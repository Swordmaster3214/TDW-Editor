import { Track } from './track.js'

// The full project. Saved as .tde (JSON). Exported to .🗿 for TDW.
// Time signature is metadata for the UI -- it drives how the cursor
// groups slots into measures but doesn't affect TDW export directly.
//
// v2: top-level slots array replaced by a tracks array.
// v1 files are auto-migrated: their slots become tracks[0].

export class Project {
    constructor({
        name          = 'Untitled',
        bpm           = 120,
        timeSignature = { numerator: 4, denominator: 4 },
        tracks        = [new Track({ name: 'Track 1' })]
    } = {}) {
        this.name          = name
        this.bpm           = bpm
        this.timeSignature = timeSignature
        this.tracks        = tracks
    }

    get beatsPerMeasure() {
        return this.timeSignature.numerator
    }

    clone() {
        return new Project({
            name:          this.name,
            bpm:           this.bpm,
            timeSignature: { ...this.timeSignature },
            tracks:        this.tracks.map(t => t.clone()),
        })
    }

    toJSON() {
        return {
            version:       2,
            name:          this.name,
            bpm:           this.bpm,
            timeSignature: this.timeSignature,
            tracks:        this.tracks.map(t => t.toJSON()),
        }
    }

    static fromJSON(obj) {
        // v1 had a flat slots array at the top level -- migrate it into track 0
        if (obj.version === 1) {
            return new Project({
                name:          obj.name,
                bpm:           obj.bpm,
                timeSignature: obj.timeSignature,
                tracks: [Track.fromJSON({
                    name:  'Track 1',
                    slots: obj.slots || [],
                    muted: false,
                    solo:  false,
                })],
            })
        }

        if (obj.version !== 2) {
            throw new Error(`Unsupported .tde version: ${obj.version}`)
        }

        return new Project({
            name:          obj.name,
            bpm:           obj.bpm,
            timeSignature: obj.timeSignature,
            tracks:        (obj.tracks || []).map(Track.fromJSON),
        })
    }
}
