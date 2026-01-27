export function ensureOrder(frontmatter: Record<string, any>, order: string[]): void {
    const ordered: Record<string, any> = {}

    // First, add properties in desired order (if they exist) and remove them from frontmatter
    for (const key of order) {
        if (key in frontmatter) {
            ordered[key] = frontmatter[key]
            delete frontmatter[key]
        }
    }

    // Then add any remaining properties
    for (const key in frontmatter) {
        ordered[key] = frontmatter[key]
        delete frontmatter[key]
    }

    // Assign ordered properties back
    Object.assign(frontmatter, ordered)
}
