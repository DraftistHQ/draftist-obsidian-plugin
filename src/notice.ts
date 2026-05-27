import * as Obsidian from "obsidian"

type NoticeMessage = string | DocumentFragment
type NoticeOpts = { permanent: boolean }

export const info = (message: NoticeMessage, opts?: NoticeOpts) => {
    show("info", message, opts)
}

export const warning = (message: NoticeMessage, opts?: NoticeOpts) => {
    show("warning", message, opts)
}

export const error = (message: NoticeMessage, opts?: NoticeOpts) => {
    show("error", message, opts)
}

const show = (level: "info" | "warning" | "error", message: NoticeMessage, opts?: NoticeOpts) => {
    let icon: string
    switch (level) {
        case "info": {
            icon = "info"
            break
        }
        case "warning": {
            icon = "alert-triangle"
            break
        }
        case "error": {
            icon = "alert-circle"
            break
        }
        default: {
            level satisfies never
            throw new Error(`Unexpected notice level: ${level}`)
        }
    }

    const duration = !!opts?.permanent ? 0 : undefined

    const fragment = document.createDocumentFragment()
    const container = fragment.createEl("div", { cls: `draftist-notice draftist-notice-${level}` })
    Obsidian.setIcon(container.createEl("span", { cls: "draftist-notice-icon" }), icon)
    const content = container.createEl("span", { cls: "draftist-notice-content" })
    if (typeof message === "string") {
        content.setText(`Draftist: ${message}`)
    } else {
        message.prepend("Draftist: ")
        content.appendChild(message)
    }

    new Obsidian.Notice(fragment, duration)
}
