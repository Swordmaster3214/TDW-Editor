// Central state store. All mutations go through the functions here,
// which dispatch a 'statechange' event so UI components can re-render.

import { Project }      from './model/project.js'
import { Slot }         from './model/slot.js'
import { Sound }        from './model/sound.js'
import { Fraction }     from './model/fraction.js'
import { ControlSlot }  from './model/controlslot.js'

export const state = {
    project:     new Project(),
    cursorPos:   0,          // insert point: 0 = before first slot
    selection:   null,       // { start, end } inclusive slot indices, or null
    activeDur:   Fraction.QUARTER,  // duration applied to newly inserted slots
    soundList:   [],         // loaded from /sounds.json
    undoStack:   [],         // array of serialized slot snapshots
    redoStack:   [],
}

// -- Notifications --

function notify() {
    document.dispatchEvent(new CustomEvent('statechange'))
}

// -- Undo/redo --

function snapshot() {
    state.undoStack.push(JSON.stringify(state.project.slots.map(s => s.toJSON())))
    state.redoStack = []
    if (state.undoStack.length > 100) state.undoStack.shift()
}

export function undo() {
    if (!state.undoStack.length) return
        state.redoStack.push(JSON.stringify(state.project.slots.map(s => s.toJSON())))
        restoreSlots(JSON.parse(state.undoStack.pop()))
        notify()
}

export function redo() {
    if (!state.redoStack.length) return
        state.undoStack.push(JSON.stringify(state.project.slots.map(s => s.toJSON())))
        restoreSlots(JSON.parse(state.redoStack.pop()))
        notify()
}

function restoreSlots(raw) {
    state.project.slots = raw.map(Slot.fromJSON)
    state.cursorPos  = Math.min(state.cursorPos, state.project.slots.length)
    state.selection  = null
}

// -- Cursor --

export function setCursor(pos) {
    state.cursorPos = Math.max(0, Math.min(pos, state.project.slots.length))
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
            end:   Math.min(state.project.slots.length - 1, Math.max(start, end))
        }
    }
    notify()
}

export function extendSelection(delta) {
    const anchor = state.selection?.anchor ?? state.cursorPos
    const focus  = (state.selection?.focus  ?? state.cursorPos) + delta
    const clamped = Math.max(0, Math.min(focus, state.project.slots.length - 1))
    state.selection = {
        anchor,
        focus:  clamped,
        start:  Math.min(anchor, clamped),
        end:    Math.max(anchor, clamped)
    }
    state.cursorPos = clamped + (delta > 0 ? 1 : 0)
    notify()
}

// -- Insert / delete --

export function insertSlot(slot) {
    snapshot()
    // Replace selection if one exists, otherwise insert at cursor
    if (state.selection) {
        state.project.slots.splice(
            state.selection.start,
            state.selection.end - state.selection.start + 1,
            slot
        )
        state.cursorPos = state.selection.start + 1
        state.selection = null
    } else {
        state.project.slots.splice(state.cursorPos, 0, slot)
        state.cursorPos++
    }
    notify()
}

export function insertSound(soundId) {
    const sound = new Sound({ id: soundId, pitch: 0 })
    insertSlot(new Slot({ sounds: [sound], duration: state.activeDur }))
}

export function insertRest() {
    insertSlot(new Slot({ sounds: [], duration: state.activeDur }))
}

// Add a sound to the slot immediately before the cursor (chord building)
export function addToChord(soundId) {
    if (state.cursorPos === 0) return
        snapshot()
        const target = state.project.slots[state.cursorPos - 1]
        if (!target || target.isRest || target.isControl) return
            target.sounds.push(new Sound({ id: soundId, pitch: 0 }))
            notify()
}

// Insert a control item at the cursor
export function insertControl(name, value = null, modifier = null, value2 = null) {
    insertSlot(new ControlSlot({ name, value, modifier, value2 }))
}

export function deleteBeforeCursor() {
    if (state.selection) return deleteSelection()
        if (state.cursorPos === 0) return
            snapshot()
            state.project.slots.splice(state.cursorPos - 1, 1)
            state.cursorPos--
            notify()
}

export function deleteAfterCursor() {
    if (state.selection) return deleteSelection()
        if (state.cursorPos >= state.project.slots.length) return
            snapshot()
            state.project.slots.splice(state.cursorPos, 1)
            notify()
}

function deleteSelection() {
    if (!state.selection) return
        snapshot()
        state.project.slots.splice(
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
        clipboard = state.project.slots
        .slice(state.selection.start, state.selection.end + 1)
        .map(s => s.clone())
}

export function pasteAtCursor() {
    if (!clipboard.length) return
        snapshot()
        const clones = clipboard.map(s => s.clone())
        state.project.slots.splice(state.cursorPos, 0, ...clones)
        state.cursorPos += clones.length
        state.selection = null
        notify()
}

// -- Pitch editing --

export function adjustPitch(slotIndex, soundIndex, delta) {
    const sound = state.project.slots[slotIndex]?.sounds[soundIndex]
    if (!sound) return
        snapshot()
        sound.pitch = Math.max(-24, Math.min(24, sound.pitch + delta))
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

// Resolve a tdwId (may be emoji) back to the plain id used for audio filenames.
// Falls back to the input unchanged so plain ids still work with no lookup cost.
export function resolveAudioId(tdwId) {
    const found = state.soundList.find(s => s.tdwId === tdwId || s.id === tdwId)
    return found ? found.id : tdwId
}

export async function loadSounds() {
    try {
        const res  = await fetch('/sounds.json')
        const list = await res.json()
        list.forEach(s => {
            // The TDW token for a sound is its emoji if it has one, otherwise its id.
            // This is what gets written into exported sequences and stored on Sound objects.
            s.tdwId = s.emoji || s.id

            // Reproduce TDW's image URL logic exactly
            s.imageLink = (!s.emoji && s.id.match(/[a-z0-9]/i))
            ? `https://thirtydollar.website/icons/${s.img || s.id}.png`
            : `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${(s.emoji || s.id).codePointAt(0).toString(16)}.svg`
        })
        state.soundList = list
        notify()
    } catch (e) {
        console.error('Could not load sounds.json:', e)
    }
}

// -- File I/O --

export function newProject() {
    snapshot()
    state.project   = new Project()
    state.cursorPos = 0
    state.selection = null
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
            state.project   = Project.fromJSON(JSON.parse(e.target.result))
            state.cursorPos = state.project.slots.length
            state.selection = null
            notify()
        } catch (err) {
            alert(`Could not load file: ${err.message}`)
        }
    }
    reader.readAsText(file)
}

export function exportTDWFile() {
    // Imported lazily to avoid a circular dep at module load time
    import('./io/exporter.js').then(({ exportToTDW }) => {
        const seq = exportToTDW(state.project)
        downloadText(seq, `${state.project.name || 'untitled'}.🗿`, 'text/plain')
    })
}

export function openInTDW() {
    import('./io/exporter.js').then(({ exportToTDW }) => {
        const seq = exportToTDW(state.project)
        window.open(`https://thirtydollar.website/#${encodeURIComponent(seq)}`, '_blank')
    })
}

export function importTDWFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
        import('./io/parser.js').then(({ importFromTDW }) => {
            snapshot()
            state.project   = importFromTDW(e.target.result)
            state.cursorPos = state.project.slots.length
            state.selection = null
            notify()
        })
    }
    reader.readAsText(file)
}

function downloadText(text, filename, mime) {
    const a   = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(new Blob([text], { type: mime })),
                              download: filename,
    })
    a.click()
    URL.revokeObjectURL(a.href)
}
