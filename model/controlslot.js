// A control item slot -- !speed, !volume, !stop, !combine, etc.
// Replaces the old _passthrough hack with a proper typed class.
// The ACTIONS array mirrors TDW's internal action list and drives
// both the actions panel UI and the keyboard shortcut handler.

export const ACTIONS = [
    // Group 1: Timing and dynamics
    { shortcut: 't', action: 'Set tempo',          name: 'speed',     hasValue: true,  modifiers: true,  default: 300,    set: [10, 10000],      add: [-10000, 10000],     multiply: [0.01, 1000, 0.1], divide: [0.1, 100, 0.1] },
{ shortcut: 'v', action: 'Set volume',          name: 'volume',    hasValue: true,  modifiers: true,  default: 100,    set: [0, 600, 1, '%'], add: [-600, 600, 1, '%'], multiply: [0.01, 1000, 0.1], divide: [0.1, 100, 0.1] },
{ shortcut: 'p', action: 'Pause for duration',  name: 'stop',      hasValue: true,  modifiers: false, default: 4,      set: [0, 1000] },
{ shortcut: 'm', action: 'Transpose',           name: 'transpose', hasValue: true,  modifiers: true,  default: 1,      set: [-60, 60],        add: [-60, 60] },

// Group 2: Loops
{ shortcut: 'l', action: 'Loop',                name: 'loopmany',  hasValue: true,  modifiers: false, default: 4,      set: [1, 1000] },
{ shortcut: 'r', action: 'Loop once',           name: 'loop',      hasValue: false },
{ shortcut: 's', action: 'Set loop start',      name: 'looptarget',hasValue: false },
{ shortcut: 'c', action: 'Combine sounds',      name: 'combine',   hasValue: false },

// Group 3: Navigation
{ shortcut: 'g', action: 'Go to target',        name: 'jump',      hasValue: true,  isTarget: true,   default: 1,      set: [1, 9999] },
{ shortcut: 'a', action: 'Target',              name: 'target',    hasValue: true,  isTarget: true,   default: 1,      set: [1, 9999] },
{ shortcut: 'x', action: 'Stop all sounds',     name: 'cut',       hasValue: false },
{ shortcut: 'o', action: 'Set start position',  name: 'startpos',  hasValue: false },

// Group 4: Visual
{ shortcut: 'd', action: 'Add divider',         name: 'divider',   hasValue: false },
{ shortcut: 'f', action: 'Flash screen',        name: 'flash',     hasValue: false },
{ shortcut: 'u', action: 'Pulse screen',        name: 'pulse',     hasValue: true,  twoValues: [[0, 1000], [0.1, 128]], default: [1, 2] },
{ shortcut: 'b', action: 'Set background',      name: 'bg',        hasValue: true,  colorMode: true,  twoValues: [['color'], [0, 128]], default: ['X', 1] },
]

// Lookup by name for the parser
export const ACTION_BY_NAME = Object.fromEntries(ACTIONS.map(a => [a.name, a]))
// Lookup by shortcut for the keyboard handler
export const ACTION_BY_KEY  = Object.fromEntries(ACTIONS.map(a => [a.shortcut, a]))

export class ControlSlot {
    constructor({ name, value = null, modifier = null, value2 = null } = {}) {
        this.name     = name      // TDW control name without !, e.g. 'speed'
        this.value    = value     // primary value, or null
        this.modifier = modifier  // null = set, '+' = add, 'x' = multiply, 'divide' = UI-only (exports as 'x' with 1/v)
        this.value2   = value2    // second value for pulse/bg, or null
    }

    // So the rest of the code can treat any slot uniformly
    get isRest()    { return false }
    get isControl() { return true  }
    get sounds()    { return []    }

    // Builds the TDW token string -- called by the exporter
    toTDWToken() {
        if (this.value === null) return `!${this.name}`

            // Two-value items like pulse and bg: !name@v1@v2 (v2 occupies the modifier slot)
            if (this.value2 !== null) {
                return `!${this.name}@${this.value}@${this.value2}`
            }

            // Single value with optional modifier
            const exportValue    = this.modifier === 'divide' ? round6(1 / this.value) : this.value
            const exportModifier = this.modifier === 'divide' ? 'x' : (this.modifier ?? '')
            return `!${this.name}@${exportValue}${exportModifier ? '@' + exportModifier : ''}`
    }

    clone() {
        return new ControlSlot({
            name: this.name, value: this.value, modifier: this.modifier, value2: this.value2
        })
    }

    toJSON() {
        const obj = { type: 'control', name: this.name }
        if (this.value    !== null) obj.value    = this.value
            if (this.modifier !== null) obj.modifier = this.modifier
                if (this.value2   !== null) obj.value2   = this.value2
                    return obj
    }

    static fromJSON(obj) {
        return new ControlSlot({
            name:     obj.name,
            value:    obj.value    ?? null,
            modifier: obj.modifier ?? null,
            value2:   obj.value2   ?? null,
        })
    }
}

function round6(n) {
    return Math.round(n * 1e6) / 1e6
}
