// Position utilities for gap-based ordering.
// Uses float positions with gaps to allow insertions without renumbering.

const GAP = 32768

// Initial position for the first item
export function initial(): number {
    return GAP
}

// Position before the first item
export function prepend(first: number): number {
    return first / 2.0
}

// Position after the last item
export function append(last: number): number {
    return last + GAP
}

// Position between two items
export function insert(a: number, b: number): number {
    return a + (b - a) / 2.0
}
