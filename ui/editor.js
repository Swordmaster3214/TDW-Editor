// The main sequence editor. Renders slots as tokens with a movable cursor
// between them, supports click-to-place, keyboard navigation, and selection.

import * as App from '../app.js'
import { resolveAudioId } from '../app.js'
import { ACTION_BY_KEY } from '../model/controlslot.js'
import { handleActionClick } from './actions.js'
import { previewSound } from '../audio/engine.js'

// Tracks which slot indices have played during the current playback session.
// Updated via DOM events fired by the sequencer -- direct classList updates
// avoid a full re-render on every note.
const playedSlots = new Set()

export function init(container) {
    container.setAttribute('tabindex', '0')
    container.addEventListener('keydown',     onKeyDown)
    container.addEventListener('click',       onContainerClick)
    container.addEventListener('contextmenu', onContainerContextMenu)
    document.addEventListener('statechange',  () => render(container))

    // A slot just played -- mark it without re-rendering the whole editor
    document.addEventListener('slotplay', e => {
        const idx = e.detail.index
        if (playedSlots.has(idx)) return   // already marked, skip the DOM query
            playedSlots.add(idx)
            container.querySelector(`[data-index="${idx}"]`)?.classList.add('played')
    })

    // Playback stopped -- clear all played markers
    document.addEventListener('slotsclear', () => {
        playedSlots.clear()
        container.querySelectorAll('.played').forEach(el => el.classList.remove('played'))
    })

    render(container)
}

// -- Rendering --

export function render(container) {
    const { project, cursorPos, selection } = App.state
    const slots = project.slots

    container.innerHTML = ''

    if (slots.length === 0) {
        container.appendChild(makeCursorEl())
        const hint = document.createElement('span')
        hint.className = 'seq-hint'
        hint.textContent = 'Click a sound in the picker to insert, or press Space for a rest'
        container.appendChild(hint)
        return
    }

    if (cursorPos === 0) container.appendChild(makeCursorEl())

        slots.forEach((slot, i) => {
            const el = makeSlotEl(slot, i, selection)
            el.dataset.index = i

            el.addEventListener('click', e => {
                e.stopPropagation()
                if (e.shiftKey) {
                    App.extendSelection(i - (App.state.cursorPos - 1))
                } else {
                    App.setCursor(i + 1)
                }
                container.focus()
            })

            // Right-click on a sound slot previews it; control slots are ignored
            el.addEventListener('contextmenu', e => {
                e.preventDefault()
                e.stopPropagation()
                if (!slot.isControl && !slot.isRest && slot.sounds.length) {
                    for (const sound of slot.sounds) {
                        previewSound(resolveAudioId(sound.id), { pitch: sound.pitch })
                    }
                }
            })

            container.appendChild(el)

            if (cursorPos === i + 1) container.appendChild(makeCursorEl())
        })
}

function makeCursorEl() {
    const el = document.createElement('span')
    el.className = 'seq-cursor'
    el.setAttribute('aria-label', 'cursor')
    return el
}

function makeSlotEl(slot, index, selection) {
    const el = document.createElement('span')
    const isSelected = selection && index >= selection.start && index <= selection.end
    const wasPlayed  = playedSlots.has(index)

    if (slot.isControl) {
        const isDivider = slot.name === 'divider'
        el.className = 'seq-slot seq-control'
        + (isDivider  ? ' seq-divider' : '')
        + (isSelected ? ' selected'    : '')
        + (wasPlayed  ? ' played'      : '')
        el.title = slot.toTDWToken()

        if (isDivider) {
            const img = document.createElement('img')
            img.src = 'https://thirtydollar.website/assets/action_divider.png'
            img.alt = 'divider'
            img.className = 'seq-icon'
            img.onerror = () => { img.remove() }
            el.appendChild(img)
            return el
        }

        const img = document.createElement('img')
        img.src = `https://thirtydollar.website/assets/action_${slot.name}.png`
        img.alt = slot.name
        img.className = 'seq-icon'
        img.onerror = () => {
            img.remove()
            el.textContent = slot.toTDWToken()
        }
        el.appendChild(img)

        const token = slot.toTDWToken()
        const valuePart = token.slice(slot.name.length + 1)
        if (valuePart) {
            const badge = document.createElement('sub')
            badge.className = 'seq-dur'
            badge.textContent = valuePart
            el.appendChild(badge)
        }

        return el
    }

    if (slot.isRest) {
        el.className = 'seq-slot seq-rest'
        + (isSelected ? ' selected' : '')
        + (wasPlayed  ? ' played'   : '')
        el.title = `Rest (${slot.duration})`
        el.textContent = '·'
        return el
    }

    el.className = 'seq-slot seq-sound'
    + (slot.sounds.length > 1 ? ' seq-chord' : '')
    + (isSelected ? ' selected' : '')
    + (wasPlayed  ? ' played'   : '')
    el.title = slot.sounds
    .map(s => s.id + (s.pitch ? ` (${s.pitch > 0 ? '+' : ''}${s.pitch})` : ''))
    .join(' + ')
    + '\nRight-click to preview'

    slot.sounds.forEach((sound, si) => {
        const soundInfo = App.state.soundList.find(
            x => x.tdwId === sound.id || x.id === sound.id
        )

        const wrap = document.createElement('span')
        wrap.className = 'seq-sound-wrap'
        if (si > 0) wrap.style.marginLeft = '-10px'

            const img = document.createElement('img')
            img.src = soundInfo?.imageLink ?? `https://thirtydollar.website/icons/${sound.id}.png`
            img.alt = soundInfo?.name ?? sound.id
            img.className = 'seq-icon'
            wrap.appendChild(img)

            if (sound.pitch !== 0) {
                const badge = document.createElement('sup')
                badge.className = 'seq-pitch'
                badge.textContent = (sound.pitch > 0 ? '+' : '') + sound.pitch
                wrap.appendChild(badge)
            }

            // Scroll wheel adjusts pitch and plays a quick preview of the result
            wrap.addEventListener('wheel', e => {
                e.preventDefault()
                e.stopPropagation()
                const delta = e.deltaY < 0 ? 1 : -1
                App.adjustPitch(index, si, delta)
                previewSound(resolveAudioId(sound.id), { pitch: sound.pitch })
            }, { passive: false })

            el.appendChild(wrap)
    })

    if (slot.duration.denominator > 1 || slot.duration.numerator < 1) {
        const dur = document.createElement('sub')
        dur.className = 'seq-dur'
        dur.textContent = slot.duration.toString()
        el.appendChild(dur)
    }

    return el
}

// -- Keyboard handling --

function onKeyDown(e) {
    const ctrl = e.ctrlKey || e.metaKey

    // Navigation
    if (e.key === 'ArrowLeft'  && !e.shiftKey) { e.preventDefault(); App.moveCursor(-1); return }
    if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); App.moveCursor(+1); return }
    if (e.key === 'ArrowLeft'  &&  e.shiftKey) { e.preventDefault(); App.extendSelection(-1); return }
    if (e.key === 'ArrowRight' &&  e.shiftKey) { e.preventDefault(); App.extendSelection(+1); return }
    if (e.key === 'Home') { e.preventDefault(); App.setCursor(0); return }
    if (e.key === 'End')  { e.preventDefault(); App.setCursor(App.state.project.slots.length); return }

    // Editing
    if (e.key === 'Backspace') { e.preventDefault(); App.deleteBeforeCursor(); return }
    if (e.key === 'Delete')    { e.preventDefault(); App.deleteAfterCursor();  return }
    if (e.key === ' ')         { e.preventDefault(); App.insertRest();          return }

    // Undo/redo
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); App.undo(); return }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); App.redo(); return }

    // Copy/paste
    if (ctrl && e.key === 'c') { e.preventDefault(); App.copySelection(); return }
    if (ctrl && e.key === 'v') { e.preventDefault(); App.pasteAtCursor(); return }

    // Arrow up/down nudges pitch and previews the result
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const delta = e.key === 'ArrowUp' ? 1 : -1
        const slotIdx = App.state.cursorPos - 1
        App.adjustPitch(slotIdx, 0, delta)
        const slot = App.state.project.slots[slotIdx]
        if (slot && !slot.isRest && !slot.isControl && slot.sounds[0]) {
            const s = slot.sounds[0]
            previewSound(resolveAudioId(s.id), { pitch: s.pitch })
        }
        return
    }

    // Action shortcuts (single letter, no modifier keys, editor focused)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        const action = ACTION_BY_KEY[e.key.toLowerCase()]
        if (action) {
            e.preventDefault()
            handleActionClick(action, document.querySelector(`.action-btn[data-name="${action.name}"]`))
        }
    }
}

// Suppress the browser context menu on the container background
function onContainerContextMenu(e) {
    e.preventDefault()
}

// Clicking the container background moves cursor to end
function onContainerClick() {
    App.setCursor(App.state.project.slots.length)
    document.getElementById('seq').focus()
}
