import * as Obsidian from "obsidian"

import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Notice from "src/notice"
import { OK, ERROR } from "src/utils/result"

export async function run(app: Obsidian.App): Promise<void> {
    const file = app.workspace.getActiveFile()
    if (!file) {
        Notice.warning("No active file")
        return
    }

    const cache = app.metadataCache.getFileCache(file)
    if (!cache?.frontmatter) {
        Notice.warning("No frontmatter found")
        return
    }

    const result = Site.getSiteAndModuleForFile(file)

    switch (result._) {
        case OK: {
            const { module } = result.data

            switch (module.kind) {
                case "blog": {
                    const result = await Post.updateFrontmatter(app, file, meta => {
                        // Add missing base fields with default values
                        if (!("status" in meta)) {
                            meta.status = null
                        }
                        if (!("description" in meta)) {
                            meta.description = null
                        }
                        if (!("posted on" in meta)) {
                            meta["posted on"] = ""
                        }
                        if (!("tags" in meta)) {
                            meta.tags = []
                        }
                    })

                    switch (result._) {
                        case OK: {
                            Notice.info("Frontmatter normalized")
                            return
                        }
                        case ERROR: {
                            Notice.error("Failed to normalize frontmatter")
                            return
                        }
                    }
                }

                case "docs":
                    return

                default:
                    module.kind satisfies never
            }
        }
        case ERROR: {
            // TODO: Improve error - match against result.error
            Notice.warning("File doesn't belong to any site")
            return
        }
        default: {
            result satisfies never
        }
    }
}
