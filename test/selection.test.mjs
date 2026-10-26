// Headless checks for selection, moving slots between lanes, and undo.
// Run with: node test/selection.test.mjs

globalThis.document    = { dispatchEvent() {} }
globalThis.CustomEvent = class { constructor(t) { this.type = t } }

const App = await import('../app.js')
const { Slot }  = await import('../model/slot.js')
const { Sound } = await import('../model/sound.js')
const { Track } = await import('../model/track.js')
const { gapFromPoint, laneFromY, edgeScrollSpeed } = await import('../ui/hit.js')

let failed = 0
function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) console.log(`  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`)
}

const note = id => new Slot({ sounds: [new Sound({ id })] })
const ids  = t => App.state.project.tracks[t].slots.map(s => s.sounds[0]?.id).join('')
const sel  = () => App.selectedIndices()

function fresh(...lanes) {
    App.state.project.tracks = lanes.map((str, n) =>
        new Track({ name: 'T' + n, slots: [...str].map(note) }))
    App.state.activeTrackIndex = 0
    App.state.cursorPos = 0
    App.state.selection = null
    App.state.anchorSlot = null
    App.state.undoStack = []
    App.state.redoStack = []
}
const wait = ms => new Promise(r => setTimeout(r, ms))

// -- clicking and ranges --
fresh('ABCDEFG')
App.clickSlot(1)
check('click puts cursor after slot', [App.state.cursorPos, sel()], [2, []])
App.selectSlotRange(4)
check('shift+click selects anchor..clicked', sel(), [1, 2, 3, 4])
App.selectSlotRange(0)
check('shift+click backwards includes both ends', sel(), [0, 1])
App.clickSlot(5)
App.toggleSlot(2)
check('first ctrl+click also keeps the plainly clicked slot', sel(), [2, 5])
App.toggleSlot(6)
check('ctrl+click adds single slots', sel(), [2, 5, 6])
App.toggleSlot(2)
check('ctrl+click on a selected slot removes it', sel(), [5, 6])
App.toggleSlot(5)
App.toggleSlot(6)
check('removing the last one leaves no selection', App.state.selection, null)

// ctrl+click after moving the cursor with the keyboard does not invent a pick
fresh('ABCDEFG')
App.setCursor(4)
App.toggleSlot(1)
check('ctrl+click after keyboard cursor picks only that slot', sel(), [1])

// -- ctrl+shift adds a range, plain shift replaces --
fresh('ABCDEFGH')
App.clickSlot(0)
App.toggleSlot(5)
App.selectSlotRange(7, { additive: true })
check('ctrl+shift+click keeps earlier picks and adds range', sel(), [0, 5, 6, 7])
fresh('ABCDEFGH')
App.clickSlot(1)
App.toggleSlot(5)
App.selectSlotRange(3)
check('plain shift+click replaces a gappy selection, anchored on the last ctrl+click', sel(), [3, 4, 5])
App.selectSlotRange(7)
check('and shift+click again keeps the same anchor', sel(), [5, 6, 7])

// -- marquee --
fresh('ABCDEFG')
App.selectGapRange(1, 4)
check('marquee gap 1..4 selects slots 1-3', sel(), [1, 2, 3])
App.selectGapRange(4, 1)
check('marquee works dragged backwards', sel(), [1, 2, 3])
App.selectGapRange(2, 2)
check('collapsed marquee is just a cursor', [App.state.selection, App.state.cursorPos], [null, 2])
App.selectGapRange(1, 3)
const base = new Set(App.state.selection.indices)
App.selectGapRange(5, 7, base)
check('ctrl+marquee adds to existing', sel(), [1, 2, 5, 6])

// -- keyboard growth still works, and select all --
fresh('ABCDE')
App.setCursor(2)
App.extendSelection(+1)
App.extendSelection(+1)
check('shift+arrow right grows from cursor', sel(), [2, 3])
App.extendSelection(-1)
check('shift+arrow back shrinks', sel(), [2])
App.selectAll()
check('select all', sel(), [0, 1, 2, 3, 4])

// -- delete / copy / paste with holes --
fresh('ABCDEF')
App.clickSlot(0); App.toggleSlot(2); App.toggleSlot(4)
App.copySelection()
App.setCursor(6)
App.pasteAtCursor()
check('copy of a gappy selection keeps order', ids(0), 'ABCDEFACE')
App.clickSlot(0); App.toggleSlot(2); App.toggleSlot(4)
App.deleteBeforeCursor()
check('delete removes only the selected slots', ids(0), 'BDFACE')

// -- moving --
fresh('ABCDE', 'xyz')
App.moveSlots(0, [1, 2], 0, 3)
check('move group later in same lane', ids(0), 'ADEBC')
check('moved slots stay selected at new spot', sel(), [3, 4])

fresh('ABCDE')
App.moveSlots(0, [3, 4], 0, 0)
check('move group to the front', ids(0), 'DEABC')

fresh('ABCDE')
App.moveSlots(0, [0, 2, 4], 0, 1)
check('non-contiguous group gathers together', ids(0), 'BACED')
check('gathered slots are selected', sel(), [1, 2, 3])

fresh('ABCDE', 'xyz')
App.moveSlots(0, [1, 2], 1, 1)
check('move to another lane: source', ids(0), 'ADE')
check('move to another lane: dest', ids(1), 'xBCyz')
check('dest lane becomes active with selection', [App.state.activeTrackIndex, sel()], [1, [1, 2]])

fresh('ABC', 'xyz')
App.moveSlots(0, [0, 1], 1, 3, { copy: true })
check('ctrl-copy leaves source alone', ids(0), 'ABC')
check('ctrl-copy lands in dest', ids(1), 'xyzAB')
App.state.project.tracks[1].slots[3].sounds[0].pitch = 7
check('copies are independent objects', App.state.project.tracks[0].slots[0].sounds[0].pitch, 0)

fresh('ABC')
const before = App.state.undoStack.length
App.moveSlots(0, [1], 0, 1)
check('dropping back where it started changes nothing and makes no undo step',
    [ids(0), App.state.undoStack.length], ['ABC', before])

// -- undo restores the state from before the edit --
fresh('ABCDE', 'xyz')
App.moveSlots(0, [1, 2], 1, 0)
App.undo()
check('one Ctrl+Z undoes a cross-lane drop (source)', ids(0), 'ABCDE')
check('one Ctrl+Z undoes a cross-lane drop (dest)', ids(1), 'xyz')
App.redo()
check('redo reapplies it', [ids(0), ids(1)], ['ADE', 'BCxyz'])

fresh('')
App.insertRest(); await wait(300)
App.insertRest(); await wait(300)
App.undo()
check('undo after two separate edits goes back one step', App.activeTrack().slots.length, 1)
App.undo()
check('and another goes back to empty', App.activeTrack().slots.length, 0)

fresh('A')
App.state.cursorPos = 1
App.insertRest(); App.insertRest(); App.insertRest()   // a quick burst
App.undo()
check('a burst of quick edits is one undo step', App.activeTrack().slots.length, 1)

// -- hit testing --
// two rows of three 40px boxes, 10px apart
const rect = (col, row) => ({ left: col * 50, right: col * 50 + 40, top: row * 50, bottom: row * 50 + 40 })
const grid = [0, 1, 2].map(c => rect(c, 0)).concat([0, 1, 2].map(c => rect(c, 1)))
check('left half of a box is the gap before it', gapFromPoint(grid, 55, 20), 1)
check('right half is the gap after it', gapFromPoint(grid, 85, 20), 2)
check('empty space past the end of row 1 is after its last box', gapFromPoint(grid, 400, 20), 3)
check('empty space left of row 2 is before its first box', gapFromPoint(grid, -30, 70), 3)
check('below everything lands at the very end', gapFromPoint(grid, 60, 900), 6)
check('above everything lands at the very start', gapFromPoint(grid, 60, -50), 0)
check('no slots means gap 0', gapFromPoint([], 10, 10), 0)
const lanes = [{ top: 0, bottom: 100 }, { top: 110, bottom: 200 }]
check('pointer inside a lane picks it', laneFromY(lanes, 150), 1)
check('pointer between lanes picks the closer one', laneFromY(lanes, 104), 0)
check('pointer past the last lane picks the last', laneFromY(lanes, 999), 1)
check('no scroll in the middle', edgeScrollSpeed({ top: 0, bottom: 500 }, 250), 0)
check('scrolls up near the top', edgeScrollSpeed({ top: 0, bottom: 500 }, 5) < 0, true)
check('scrolls down near the bottom', edgeScrollSpeed({ top: 0, bottom: 500 }, 495) > 0, true)

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exit(failed ? 1 : 0)
