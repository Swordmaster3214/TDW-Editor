// Central state store. All mutations go through the functions here,
// which dispatch a 'statechange' event so UI components can re-render.

import { Project }     from './model/project.js'
import { Track }       from './model/track.js'
import { Slot }        from './model/slot.js'
import { Sound }       from './model/sound.js'
import { Fraction }    from './model/fraction.js'
import { ControlSlot } from './model/controlslot.js'

export const state = {
    project:          new Project(),
    activeTrackIndex: 0,
    cursorPos:        0,       // insert point within the active track; 0 = before first slot
    selection:        null,    // { start, end } inclusive slot indices, or null
    activeDur:        Fraction.QUARTER,
    soundList:        [],
    undoStack:        [],      // array of serialized tracks snapshots
    redoStack:        [],
}

// Sound ID lookup cache: Map<tdwId, sound> for O(1) lookups instead of O(n)
let soundIdCache = null

// Undo/redo debounce: only snapshot once per 200ms to group rapid edits
let undoDebounceTimer = null
const UNDO_DEBOUNCE_MS = 200

// -- Active track helper --

export function activeTrack() {
    return state.project.tracks[state.activeTrackIndex]
    ?? state.project.tracks[0]
}

// -- Notifications --

function notify() {
    document.dispatchEvent(new CustomEvent('statechange'))
}

// -- Undo/redo (debounced) --

function snapshot() {
    // Clear any pending debounce timer
    if (undoDebounceTimer) clearTimeout(undoDebounceTimer)

        // Debounce: only create snapshot after user stops editing for 200ms
        undoDebounceTimer = setTimeout(() => {
            state.undoStack.push(JSON.stringify(state.project.tracks.map(t => t.toJSON())))
            state.redoStack = []
            if (state.undoStack.length > 100) state.undoStack.shift()
                undoDebounceTimer = null
        }, UNDO_DEBOUNCE_MS)
}

function restoreTracks(raw) {
    state.project.tracks = raw.map(Track.fromJSON)
    state.activeTrackIndex = Math.min(state.activeTrackIndex, state.project.tracks.length - 1)
    const len = activeTrack().slots.length
    state.cursorPos = Math.min(state.cursorPos, len)
    state.selection = null
}

export function undo() {
    if (!state.undoStack.length) return
        // Immediately flush any pending snapshot
        if (undoDebounceTimer) {
            clearTimeout(undoDebounceTimer)
            undoDebounceTimer = null
        }
        state.redoStack.push(JSON.stringify(state.project.tracks.map(t => t.toJSON())))
        restoreTracks(JSON.parse(state.undoStack.pop()))
        notify()
}

export function redo() {
    if (!state.redoStack.length) return
        // Immediately flush any pending snapshot
        if (undoDebounceTimer) {
            clearTimeout(undoDebounceTimer)
            undoDebounceTimer = null
        }
        state.undoStack.push(JSON.stringify(state.project.tracks.map(t => t.toJSON())))
        restoreTracks(JSON.parse(state.redoStack.pop()))
        notify()
}

// -- Cursor --

export function setCursor(pos) {
    state.cursorPos = Math.max(0, Math.min(pos, activeTrack().slots.length))
    state.selection = null
    notify()
}

export function moveCursor(delta) {
    setCursor(state.cursorPos + delta)
}

// -- Selection --

export function setSelection(start, end) {
    if (start === null) { state.selection = null }
    else {
        state.selection = {
            start: Math.max(0, Math.min(start, end)),
            end:   Math.min(activeTrack().slots.length - 1, Math.max(start, end)),
        }
    }
    notify()
}

export function extendSelection(delta) {
    const anchor  = state.selection?.anchor ?? state.cursorPos
    const focus   = (state.selection?.focus  ?? state.cursorPos) + delta
    const clamped = Math.max(0, Math.min(focus, activeTrack().slots.length - 1))
    state.selection = {
        anchor,
        focus:  clamped,
        start:  Math.min(anchor, clamped),
        end:    Math.max(anchor, clamped),
    }
    state.cursorPos = clamped + (delta > 0 ? 1 : 0)
    notify()
}

// -- Insert / delete --

export function insertSlot(slot) {
    snapshot()
    const slots = activeTrack().slots
    if (state.selection) {
        slots.splice(state.selection.start, state.selection.end - state.selection.start + 1, slot)
        state.cursorPos = state.selection.start + 1
        state.selection = null
    } else {
        slots.splice(state.cursorPos, 0, slot)
        state.cursorPos++
    }
    notify()
}

export function insertSound(soundId) {
    insertSlot(new Slot({ sounds: [new Sound({ id: soundId, pitch: 0 })], duration: state.activeDur }))
}

export function insertRest() {
    insertSlot(new Slot({ sounds: [], duration: state.activeDur }))
}

export function addToChord(soundId) {
    if (state.cursorPos === 0) return
        snapshot()
        const target = activeTrack().slots[state.cursorPos - 1]
        if (!target || target.isRest || target.isControl) return
            target.sounds.push(new Sound({ id: soundId, pitch: 0 }))
            notify()
}

export function insertControl(name, value = null, modifier = null, value2 = null) {
    insertSlot(new ControlSlot({ name, value, modifier, value2 }))
}

export function deleteBeforeCursor() {
    if (state.selection) return deleteSelection()
        if (state.cursorPos === 0) return
            snapshot()
            activeTrack().slots.splice(state.cursorPos - 1, 1)
            state.cursorPos--
            notify()
}

export function deleteAfterCursor() {
    if (state.selection) return deleteSelection()
        if (state.cursorPos >= activeTrack().slots.length) return
            snapshot()
            activeTrack().slots.splice(state.cursorPos, 1)
            notify()
}

function deleteSelection() {
    if (!state.selection) return
        snapshot()
        activeTrack().slots.splice(
            state.selection.start,
            state.selection.end - state.selection.start + 1
        )
        state.cursorPos = state.selection.start
        state.selection = null
        notify()
}

// -- Copy / paste --

let clipboard = []

export function copySelection() {
    if (!state.selection) return
        clipboard = activeTrack().slots
        .slice(state.selection.start, state.selection.end + 1)
        .map(s => s.clone())
}

export function pasteAtCursor() {
    if (!clipboard.length) return
        snapshot()
        const clones = clipboard.map(s => s.clone())
        activeTrack().slots.splice(state.cursorPos, 0, ...clones)
        state.cursorPos += clones.length
        state.selection  = null
        notify()
}

// -- Pitch editing --

export function adjustPitch(slotIndex, soundIndex, delta) {
    const sound = activeTrack().slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
    snapshot()
    sound.pitch = Math.max(-60, Math.min(60, sound.pitch + delta))
    notify()
}

// -- Volume / Panning editing --

export function adjustVolume(slotIndex, soundIndex, delta) {
    const sound = activeTrack().slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
    snapshot()
    if (sound.volume === null) sound.volume = 100
    sound.volume = Math.max(0, Math.min(200, sound.volume + delta))
    notify()
}

export function adjustPanning(slotIndex, soundIndex, delta) {
    const sound = activeTrack().slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
    snapshot()
    sound.panning = Math.max(-100, Math.min(100, sound.panning + delta * 10))
    notify()
}

// -- Track management --

export function setActiveTrack(index) {
    if (index < 0 || index >= state.project.tracks.length) return
        state.activeTrackIndex = index
        state.cursorPos = 0
        state.selection = null
        notify()
}

export function addTrack() {
    snapshot()
    const n = state.project.tracks.length + 1
    state.project.tracks.push(new Track({ name: `Track ${n}` }))
    state.activeTrackIndex = state.project.tracks.length - 1
    state.cursorPos = 0
    state.selection = null
    notify()
}

export function removeTrack(index) {
    if (state.project.tracks.length <= 1) return  // always keep at least one track
        snapshot()
        state.project.tracks.splice(index, 1)
        state.activeTrackIndex = Math.min(state.activeTrackIndex, state.project.tracks.length - 1)
        state.cursorPos = Math.min(state.cursorPos, activeTrack().slots.length)
        state.selection = null
        notify()
}

export function setTrackMuted(index, value) {
    const track = state.project.tracks[index]
    if (!track) return
        snapshot()
        track.muted = value
        notify()
}

export function setTrackSolo(index, value) {
    const track = state.project.tracks[index]
    if (!track) return
        snapshot()
        track.solo = value
        notify()
}

export function renameTrack(index, name) {
    const track = state.project.tracks[index]
    if (!track) return
        track.name = name
        notify()
}

// -- Project settings --

export function setBPM(bpm) {
    state.project.bpm = Math.max(1, Math.min(10000, bpm))
    notify()
}

export function setTimeSignature(numerator, denominator) {
    state.project.timeSignature = { numerator, denominator }
    notify()
}

export function setActiveDuration(fraction) {
    state.activeDur = fraction
    notify()
}

// -- Sound list --

// Build the sound ID cache after loading sounds
function buildSoundIdCache() {
    soundIdCache = new Map()
    for (const s of state.soundList) {
        soundIdCache.set(s.tdwId, s)
        soundIdCache.set(s.id, s)
    }
}

// Resolve a tdwId (may be emoji) back to the plain id used for audio filenames.
// Now O(1) instead of O(n) thanks to the cache.
export function resolveAudioId(tdwId) {
    const found = soundIdCache?.get(tdwId)
    return found ? found.id : tdwId
}

export async function loadSounds() {
    try {
        const res  = await fetch('./sounds.json')
        const list = await res.json()
        list.forEach(s => {
            s.tdwId = s.emoji || s.id
            s.imageLink = (!s.emoji && s.id.match(/[a-z0-9]/i))
            ? `https://thirtydollar.website/icons/${s.img || s.id}.png`
            : `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${(s.emoji || s.id).codePointAt(0).toString(16)}.svg`
        })
        state.soundList = list
        buildSoundIdCache()
        notify()
    } catch (e) {
        console.error('Could not load sounds.json:', e)
    }
}

// -- File I/O --

export function newProject() {
    snapshot()
    state.project         = new Project()
    state.activeTrackIndex = 0
    state.cursorPos       = 0
    state.selection       = null
    notify()
}

export function saveProject() {
    const json = JSON.stringify(state.project.toJSON(), null, 2)
    downloadText(json, `${state.project.name || 'untitled'}.tde`, 'application/json')
}

export function loadProjectFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
        try {
            snapshot()
            state.project          = Project.fromJSON(JSON.parse(e.target.result))
            state.activeTrackIndex = 0
            state.cursorPos        = state.project.tracks[0].slots.length
            state.selection        = null
            notify()
        } catch (err) {
            alert(`Could not load file: ${err.message}`)
        }
    }
    reader.readAsText(file)
}

export function exportTDWFile() {
    import('./io/exporter.js').then(({ exportToTDW }) => {
        const seq = exportToTDW(state.project)
        downloadText(seq, `${state.project.name || 'untitled'}.🗿`, 'text/plain')
    })
}

export function importTDWFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
        import('./io/parser.js').then(({ importFromTDW }) => {
            snapshot()
            state.project          = importFromTDW(e.target.result)
            state.activeTrackIndex = 0
            state.cursorPos        = state.project.tracks[0].slots.length
            state.selection        = null
            notify()
        })
    }
    reader.readAsText(file)
}

function downloadText(text, filename, mime) {
    const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(new Blob([text], { type: mime })),
                            download: filename,
    })
    a.click()
    URL.revokeObjectURL(a.href)
}
