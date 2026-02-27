import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Site from "src/models/site"
import * as Doc from "src/models/doc"
import * as Post from "src/models/post"
import * as Notice from "src/notice"
import { OK, ERROR } from "src/utils/result"

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.NORMALIZE_FRONTMATTER,
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile()
            if (!file) return false

            const cache = plugin.app.metadataCache.getFileCache(file)
            if (!cache?.frontmatter) return false

            const result = Site.getSiteAndModuleForFile(file)
            if (result._ === ERROR) return false

            if (!checking) {
                normalizeFrontmatter(plugin.app, file, result.data.module)
            }
            return true
        },
    })
}

async function normalizeFrontmatter(app: Obsidian.App, file: Obsidian.TFile, module: Site.SiteModule): Promise<void> {
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

        case "docs": {
            const result = await Doc.updateFrontmatter(app, file, meta => {
                // Add missing base fields with default values
                if (!("status" in meta)) {
                    meta.status = "Draft"
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

        default:
            module.kind satisfies never
    }
}
