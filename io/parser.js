import { Project }     from '../model/project.js'
import { Track }       from '../model/track.js'
import { Slot }        from '../model/slot.js'
import { Sound }       from '../model/sound.js'
import { Fraction }    from '../model/fraction.js'
import { ControlSlot, ACTION_BY_NAME } from '../model/controlslot.js'

// Imports a flat TDW sequence string into a Project with a single Track.
//
// Shallow by design -- we don't try to reverse-engineer time signatures or
// subdivision structure. Every sound slot gets duration 1/1 (quarter note)
// and the BPM is inferred from the first !speed directive.
//
// All control items become proper ControlSlot instances so they survive
// a round-trip export without data loss.

export function importFromTDW(text) {
    const tokens = text.trim().split('|').flatMap(expandRepeat)

    const slots = []
    let bpm = 120
    let foundFirstSpeed = false
    let pendingCombine  = false

    for (const token of tokens) {
        const { id, value, modifier } = splitControlToken(token)

        // -- Rests --
        if (id === '_pause') {
            slots.push(new Slot({ sounds: [], duration: Fraction.QUARTER }))
            pendingCombine = false
            continue
        }

        // -- Combine (chord join) --
        if (id === '!combine') {
            pendingCombine = true
            continue
        }

        // -- Control items --
        if (id.startsWith('!')) {
            const name = id.slice(1)

            // !stop@n expands to n rest slots so beat timing stays intact
            if (name === 'stop') {
                const count = parseInt(value, 10) || 1
                for (let i = 0; i < count; i++) {
                    slots.push(new Slot({ sounds: [], duration: Fraction.QUARTER }))
                }
                pendingCombine = false
                continue
            }

            // Grab the first absolute !speed to set the project BPM
            if (name === 'speed' && !foundFirstSpeed && modifier === null) {
                const parsed = parseFloat(value)
                if (!isNaN(parsed)) bpm = parsed
                    foundFirstSpeed = true
                    pendingCombine  = false
                    continue
            }

            // Everything else (including subsequent !speed changes) becomes a ControlSlot
            const parsedValue = (value === null) ? null : (isNaN(+value) ? value : +value)
            const action      = ACTION_BY_NAME[name]
            const isValue2    = action?.twoValues && modifier !== null
            slots.push(new ControlSlot({
                name,
                value:    parsedValue,
                modifier: isValue2 ? null : (modifier || null),
                                       value2:   isValue2 ? (isNaN(+modifier) ? modifier : +modifier) : null,
            }))
            pendingCombine = false
            continue
        }

        // -- Regular sound --
        // Parse the full token for pitch (@), volume (%), and panning (^)
        const { id: soundId, pitch, volume, panning } = parseSoundToken(token)
        const sound = new Sound({ id: soundId, pitch, volume, panning })

        if (pendingCombine && slots.length > 0) {
            const prev = slots[slots.length - 1]
            if (prev instanceof Slot && !prev.isRest) {
                prev.sounds.push(sound)
                pendingCombine = false
                continue
            }
        }

        slots.push(new Slot({ sounds: [sound], duration: Fraction.QUARTER }))
        pendingCombine = false
    }

    return new Project({
        bpm,
        tracks: [new Track({ name: 'Track 1', slots })],
    })
}

function expandRepeat(token) {
    const match = token.match(/^(.+?)=(\d+)$/)
    if (!match) return [token]
        const [, base, n] = match
        return Array.from({ length: parseInt(n, 10) }, () => base)
}

// Used only for control tokens (!speed@120@+, etc.) which use @ as their
// separator. Sound tokens go through parseSoundToken instead.
function splitControlToken(token) {
    const parts = token.split('@')
    return {
        id:       parts[0],
        value:    parts[1] ?? null,
        modifier: parts[2] ?? null,
    }
}

// Parses a sound token in the format: id[@pitch][%volume][^panning]
// All three modifiers are optional and independent.
// Examples: kick | boom@4 | ding@-3%80 | snare@0%106^-50 | hi@2%200^100
function parseSoundToken(token) {
    const match = token.match(/^([^@%^]+)(?:@([-\d.]+))?(?:%([\d.]+))?(?:\^([-\d]+))?$/)
    if (!match) return { id: token, pitch: 0, volume: null, panning: 0 }
    return {
        id:      match[1],
        pitch:   match[2] !== undefined ? parseFloat(match[2]) : 0,
        volume:  match[3] !== undefined ? parseFloat(match[3]) : null,
        panning: match[4] !== undefined ? parseInt(match[4], 10) : 0,
    }
}
