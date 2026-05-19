// Converts a Project to a flat TDW-compatible sequence string.
//
// Lossy by design -- time signatures, Fraction durations, and our internal
// structure all collapse into a flat list of TDW tokens.
//
// Key behaviors:
//   - !speed is only emitted when the effective BPM changes between sound slots.
//     ControlSlots that ARE !speed emit their own token and reset the tracked BPM.
//   - Consecutive rests at the same duration compress into _pause=n.
//   - Single-sound slots that repeat identically compress into sound=n.
//   - Chords emit !combine between each pair of sounds in a slot.

import { ControlSlot } from '../model/controlslot.js'

export function exportToTDW(project) {
    const tokens = []
    let currentStepBPM = null

    let i = 0
    while (i < project.slots.length) {
        const slot = project.slots[i]

        if (slot.isControl) {
            tokens.push(slot.toTDWToken())
            // If this was an absolute !speed, update our tracked BPM so we don't
            // redundantly re-emit it for the next sound slot
            if (slot.name === 'speed' && slot.value !== null && slot.modifier === null) {
                currentStepBPM = slot.value
            }
            i++
            continue
        }

        const dur     = slot.duration
        const stepBPM = computeStepBPM(project.bpm, dur)

        // Only emit a speed directive when the duration changes
        if (stepBPM !== currentStepBPM) {
            tokens.push(`!speed@${stepBPM}`)
            currentStepBPM = stepBPM
        }

        if (slot.isRest) {
            // Greedily compress consecutive rests at the same duration
            let count = 1
            while (
                i + count < project.slots.length &&
                project.slots[i + count].isRest &&
                !project.slots[i + count].isControl &&
                project.slots[i + count].duration.equals(dur)
            ) count++

            tokens.push(count > 1 ? `_pause=${count}` : '_pause')
            i += count
        } else if (slot.sounds.length === 1) {
            // Single sound -- greedily compress consecutive identical slots into sound=n.
            // Two slots can merge only if they'd produce the same token and same duration
            // (same duration means same stepBPM, so no implicit speed change in between).
            const soundToken = formatSound(slot.sounds[0])
            let count = 1
            while (
                i + count < project.slots.length &&
                !project.slots[i + count].isControl &&
                !project.slots[i + count].isRest &&
                project.slots[i + count].sounds.length === 1 &&
                project.slots[i + count].duration.equals(dur) &&
                formatSound(project.slots[i + count].sounds[0]) === soundToken
            ) count++

            tokens.push(count > 1 ? `${soundToken}=${count}` : soundToken)
            i += count
        } else {
            // Chord -- join sounds with !combine between each pair
            const soundTokens = slot.sounds.map(formatSound)
            tokens.push(soundTokens.join('|!combine|'))
            i++
        }
    }

    return tokens.join('|')
}

// The BPM at which one TDW step equals `duration` beats.
// e.g. quarter (1/1) at 120 BPM -> 120
//      eighth  (1/2) at 120 BPM -> 240
//      triplet (1/3) at 120 BPM -> 360
function computeStepBPM(baseBPM, duration) {
    const raw = baseBPM * duration.denominator / duration.numerator
    return Math.round(raw * 1e6) / 1e6
}

// sound.id already stores the TDW token (emoji or alphanumeric id) --
// set when the sound is inserted from the picker or parsed from a TDW file.
function formatSound(sound) {
    let token = sound.id
    if (sound.pitch !== 0) token += `@${sound.pitch}`
        return token
}
