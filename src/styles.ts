import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Post from "src/models/post"
import * as FM from "src/models/fm"
import * as Site from "src/models/site"

type StyleElements = {
    BlockIdCss: HTMLStyleElement | null
    InternalFrontmatterCss: HTMLStyleElement | null
}

export class Styles {
    elements: StyleElements = {
        BlockIdCss: null,
        InternalFrontmatterCss: null,
    }

    injectBlockIdCss(file: Obsidian.TFile) {
        this.disposeBlockIdCss()

        let automations = Config.Store.automations()

        if (!automations.blockIds.enable) return

        const isFileManaged = Site.isFileManaged(file)

        // TODO?: Probably, makes sense to apply it globally regardless if a file is a part of a site.
        if (!isFileManaged) return

        let css = `
            .cm-s-obsidian span.cm-blockid {
                opacity: ${automations.blockIds.opacity};
            }
        `

        this.elements.BlockIdCss = this.injectStyle("draftist-block-id", css)
    }

    disposeBlockIdCss() {
        this.dispose("BlockIdCss")
    }

    injectInternalFrontmatterCss() {
        this.disposeInternalFrontmatterCss()

        if (Config.Store.debugging().exposeInternalMetadata) return

        let css = `
            [data-property-key^="${FM.DFT_PREFIX}"] {
                display: none !important;
            }
        `

        this.elements.InternalFrontmatterCss = this.injectStyle("draftist-frontmatter-internal", css)
    }

    disposeInternalFrontmatterCss() {
        this.dispose("InternalFrontmatterCss")
    }

    injectStyle(id: string, css: string) {
        let element = document.createElement("style")

        element.setAttribute("id", id)
        element.setAttribute("type", "text/css")
        element.appendChild(document.createTextNode(css))
        document.head.appendChild(element)

        return element
    }

    dispose(element: keyof StyleElements) {
        if (this.elements[element]) {
            this.elements[element].remove()
            this.elements[element] = null
        }
    }

    disposeAll() {
        for (let key in this.elements) {
            this.dispose(key as keyof StyleElements)
        }
    }
}
