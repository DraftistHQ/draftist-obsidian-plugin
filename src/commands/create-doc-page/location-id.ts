import type * as Obsidian from "obsidian"

// --- Types

export type T =
    | { kind: "beginning" }
    | { kind: "header"; folderPath: string }
    | { kind: "after"; folderPath: string }
    | { kind: "first-child"; folderPath: string }

// --- Constructors

export function beginning(): T {
    return { kind: "beginning" }
}

export function header(folder: Obsidian.TFolder): T {
    return { kind: "header", folderPath: folder.path }
}

export function after(folder: Obsidian.TFolder): T {
    return { kind: "after", folderPath: folder.path }
}

export function firstChild(folder: Obsidian.TFolder): T {
    return { kind: "first-child", folderPath: folder.path }
}

// --- Equality

export function eq(a: T, b: T): boolean {
    if (a.kind !== b.kind) return false

    switch (a.kind) {
        case "beginning":
            return true
        case "header":
        case "after":
        case "first-child":
            return a.folderPath === (b as typeof a).folderPath
        default:
            return a satisfies never
    }
}

// --- Serialization (for HTML select values)

export function serialize(loc: T): string {
    switch (loc.kind) {
        case "beginning":
            return "beginning"
        case "header":
            return `header:${loc.folderPath}`
        case "after":
            return `after:${loc.folderPath}`
        case "first-child":
            return `first-child:${loc.folderPath}`
        default:
            return loc satisfies never
    }
}

export function parse(s: string): T {
    if (s === "beginning") {
        return { kind: "beginning" }
    }

    if (s.startsWith("header:")) {
        return { kind: "header", folderPath: s.slice(7) }
    }

    if (s.startsWith("after:")) {
        return { kind: "after", folderPath: s.slice(6) }
    }

    if (s.startsWith("first-child:")) {
        return { kind: "first-child", folderPath: s.slice(12) }
    }

    throw new Error(`Invalid LocationId: ${s}`)
}