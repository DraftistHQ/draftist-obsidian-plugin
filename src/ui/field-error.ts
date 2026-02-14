// Field error (Obsidian UI API)
// Shows inline error message + red border on field

export function createErrorEl(container: HTMLElement): HTMLElement {
    return container.createEl("div", {
        cls: "d42-field-error",
        attr: {
            style: "display: none; color: var(--text-error); font-size: var(--font-ui-smaller); padding-top: var(--size-4-1);",
        },
    })
}

export function show(field: HTMLElement | null, errorEl: HTMLElement, message: string): void {
    if (field) field.style.borderColor = "var(--text-error)"
    errorEl.setText(message)
    errorEl.style.display = "block"
}

export function clear(field: HTMLElement | null, errorEl: HTMLElement): void {
    if (field) field.style.borderColor = ""
    errorEl.style.display = "none"
}
