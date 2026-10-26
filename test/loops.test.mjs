// Headless check of loop/jump behavior against what real TDW plays.
// Each case is a block layout plus the sequence we heard from TDW itself.
// Run with: node test/loops.test.mjs

import { Project }     from '../model/project.js'
import { Track }       from '../model/track.js'
import { Slot }        from '../model/slot.js'
import { Sound }       from '../model/sound.js'
import { ControlSlot } from '../model/controlslot.js'
import { buildSchedule }  from '../audio/sequencer.js'
import { linearizeTrack } from '../io/linearizer.js'

const note = id => new Slot({ sounds: [new Sound({ id })] })
const ctl  = (name, value = null) => new ControlSlot({ name, value })

const cases = [
    {
        name: 'Test 1: single loop',
        slots: [ctl('looptarget'), note('A'), note('B'), ctl('loopmany', 2), note('C')],
        expect: 'A B A B A B C',
    },
    {
        name: 'Test 2: spent loop stays spent',
        slots: [ctl('looptarget'), note('A'), note('B'), ctl('loopmany', 1), note('C'), note('D'), ctl('loopmany', 1)],
        expect: 'A B A B C D A B C D',
    },
    {
        name: 'Test 3: Loop once stays spent',
        slots: [ctl('looptarget'), note('A'), ctl('loop'), note('B'), ctl('loop')],
        expect: 'A A B A B',
    },
    {
        name: 'Test 4: Loop (0) becomes Loop (1)',
        slots: [ctl('looptarget'), note('A'), ctl('loopmany', 0), note('B')],
        expect: 'A A B',
    },
    {
        name: 'Test 5: jumping back does not reset loops',
        slots: [ctl('target', 1), note('A'), ctl('looptarget'), note('B'), ctl('loopmany', 1), note('C'), ctl('jump', 1)],
        expect: 'A B B C A B C',
    },
    {
        name: 'Test 6: loop-back re-arms a jump in its body',
        slots: [ctl('looptarget'), note('A'), ctl('jump', 1), note('B'), ctl('target', 1), ctl('loopmany', 2), note('C')],
        expect: 'A A A C',
    },
]

let failed = 0
for (const c of cases) {
    const track   = new Track({ slots: c.slots })
    const project = new Project({ bpm: 120, tracks: [track] })

    const played = buildSchedule(project).events
        .filter(e => e.type === 'sound').map(e => e.id).join(' ')
    const exported = linearizeTrack(project, track)
        .filter(e => e.type === 'sound').map(e => e.sounds[0].id).join(' ')

    const ok = played === c.expect && exported === c.expect
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
    if (!ok) {
        console.log(`  expected  ${c.expect}`)
        console.log(`  playback  ${played}`)
        console.log(`  export    ${exported}`)
    }
}

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exit(failed ? 1 : 0)
