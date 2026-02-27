import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Site from "src/models/site"
import { ERROR } from "src/utils/result"
import * as BlogPost from "./blog-post"

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.NORMALIZE_IMAGES,
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile()
            if (!file) return false

            const result = Site.getSiteAndModuleForFile(file)
            if (result._ === ERROR) return false

            switch (result.data.module.kind) {
                case "blog": {
                    if (!checking) {
                        BlogPost.normalizeImages(plugin.app, file)
                    }
                    return true
                }

                case "docs": {
                    return false
                }

                default: {
                    result.data.module.kind satisfies never
                    return false
                }
            }
        },
    })
}
