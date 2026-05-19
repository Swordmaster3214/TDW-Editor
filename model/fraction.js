// Rational number representing a slot's duration in beats.
// Quarter note = 1/1, triplet eighth = 1/3, quintuplet = 1/5, etc.
// This one class handles both regular subdivisions and tuplets uniformly.

function gcd(a, b) {
    a = Math.abs(a)
    b = Math.abs(b)
    while (b !== 0) { const t = b; b = a % b; a = t }
    return a
}

export class Fraction {
    constructor(numerator, denominator = 1) {
        if (denominator === 0) throw new Error('Denominator cannot be zero')
            if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
                throw new Error('Fraction components must be integers')
            }
            const g = gcd(Math.abs(numerator), Math.abs(denominator))
            this.numerator = numerator / g
            this.denominator = denominator / g
    }

    equals(other) {
        return this.numerator === other.numerator && this.denominator === other.denominator
    }

    // Beat duration as a decimal -- used when computing effective BPM
    toDecimal() {
        return this.numerator / this.denominator
    }

    toString() {
        return this.denominator === 1 ? `${this.numerator}` : `${this.numerator}/${this.denominator}`
    }

    toJSON() {
        return { numerator: this.numerator, denominator: this.denominator }
    }

    static fromJSON({ numerator, denominator }) {
        return new Fraction(numerator, denominator)
    }

    // Common note values relative to one beat (quarter note)
    static WHOLE          = new Fraction(4, 1)
    static HALF           = new Fraction(2, 1)
    static QUARTER        = new Fraction(1, 1)
    static EIGHTH         = new Fraction(1, 2)
    static SIXTEENTH      = new Fraction(1, 4)
    static THIRTYSECOND   = new Fraction(1, 8)

    // Tuplets -- 3 notes in the space of 2 of the given type
    static TRIPLET_QUARTER   = new Fraction(2, 3)  // 2/3 of a beat each
    static TRIPLET_EIGHTH    = new Fraction(1, 3)  // 1/3 of a beat each
    static TRIPLET_SIXTEENTH = new Fraction(1, 6)

    // 5 notes in the space of 4 of the given type
    static QUINTUPLET_EIGHTH = new Fraction(2, 5)  // 2/5 of a beat each
    static QUINTUPLET_SIXTEENTH = new Fraction(1, 5)

    // 7 notes in the space of 4
    static SEPTUPLET_EIGHTH = new Fraction(2, 7)
}
