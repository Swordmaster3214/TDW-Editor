// The main sequence editor. Renders slots as tokens with a movable cursor
// between them, supports click-to-place, keyboard navigation, and selection.

import * as App from '../app.js'
import { ACTION_BY_KEY } from '../model/controlslot.js'
import { handleActionClick } from './actions.js'

export function init(container) {
    container.setAttribute('tabindex', '0')
    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('click',   onContainerClick)
    document.addEventListener('statechange', () => render(container))
    render(container)
}

// -- Rendering --

export function render(container) {
    const { project, cursorPos, selection } = App.state
    const slots = project.slots

    container.innerHTML = ''

    if (slots.length === 0) {
        // Show cursor alone in an empty sequence
        container.appendChild(makeCursorEl())
        const hint = document.createElement('span')
        hint.className = 'seq-hint'
        hint.textContent = 'Click a sound in the picker to insert, or press Space for a rest'
        container.appendChild(hint)
        return
    }

    // Cursor before slot 0
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

            // Scroll wheel adjusts pitch on the first sound of a slot
            el.addEventListener('wheel', e => {
                e.preventDefault()
                App.adjustPitch(i, 0, e.deltaY < 0 ? 1 : -1)
            }, { passive: false })

            container.appendChild(el)

            // Cursor sits AFTER slot i (before slot i+1)
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

    if (slot.isControl) {
        el.className = 'seq-slot seq-control' + (isSelected ? ' selected' : '')
        el.title = slot.toTDWToken()
        el.textContent = slot.toTDWToken()
        return el
    }

    if (slot.isRest) {
        el.className = 'seq-slot seq-rest' + (isSelected ? ' selected' : '')
        el.title = `Rest (${slot.duration})`
        el.textContent = '·'
        return el
    }

    el.className = 'seq-slot seq-sound' + (slot.sounds.length > 1 ? ' seq-chord' : '') + (isSelected ? ' selected' : '')
    el.title = slot.sounds.map(s => s.id + (s.pitch ? ` (${s.pitch > 0 ? '+' : ''}${s.pitch})` : '')).join(' + ')

    slot.sounds.forEach((sound, si) => {
        const soundInfo = App.state.soundList.find(x => x.id === sound.id)
        const img = document.createElement('img')
        img.src = soundInfo?.imageLink ?? `https://thirtydollar.website/icons/${sound.id}.png`
        img.alt = soundInfo?.name ?? sound.id
        img.className = 'seq-icon'
        // Stack chord icons with a slight offset
        if (si > 0) img.style.marginLeft = '-10px'
            el.appendChild(img)
    })

    // Pitch badge -- only shown if non-zero
    const mainPitch = slot.sounds[0].pitch
    if (mainPitch !== 0) {
        const badge = document.createElement('sup')
        badge.className = 'seq-pitch'
        badge.textContent = (mainPitch > 0 ? '+' : '') + mainPitch
        el.appendChild(badge)
    }

    // Duration indicator for anything shorter than a quarter note
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

    // Pitch nudge on the slot before the cursor
    if (e.key === 'ArrowUp')   { e.preventDefault(); App.adjustPitch(App.state.cursorPos - 1, 0, +1); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); App.adjustPitch(App.state.cursorPos - 1, 0, -1); return }
    // Action shortcuts (single letter, no modifier keys held) -- only when
    // no input/select/textarea is focused so they don't eat typing elsewhere
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        const action = ACTION_BY_KEY[e.key.toLowerCase()]
        if (action) {
            e.preventDefault()
            handleActionClick(action, document.querySelector(`.action-btn[data-name="${action.name}"]`))
        }
    }
}

// Clicking the container background moves cursor to end
function onContainerClick() {
    App.setCursor(App.state.project.slots.length)
    document.getElementById('seq').focus()
}
