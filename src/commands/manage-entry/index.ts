import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Config from "src/config"
import * as Content from "src/models/content"
import * as FM from "src/models/fm"
import * as Site from "src/models/site"
import * as Notice from "src/notice"
import { ERROR } from "src/utils/result"
import { openUrlInBrowser } from "src/utils/open-url"

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.MANAGE_ENTRY,
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile()
            if (!file) return false

            const result = Site.getSiteAndModuleForFile(file)
            if (result._ === ERROR) return false

            if (!checking) {
                openOnDraftist(plugin.app, file, result.data)
            }
            return true
        },
    })
}

export function registerFileMenuEventHandler(plugin: Plugin): void {
    plugin.registerEvent(
        plugin.app.workspace.on("file-menu", (menu: Obsidian.Menu, file: Obsidian.TAbstractFile) => {
            if (!Config.Store.onboarded()) return

            const targetFolder = file instanceof Obsidian.TFolder ? file : file.parent!
            const result = Site.getSiteAndModuleForFolder(targetFolder)
            if (result._ === ERROR) return

            const modulePath = Obsidian.normalizePath(`${result.data.site.path}/${result.data.module.name}`)
            const isModuleRoot = file instanceof Obsidian.TFolder && file.path === modulePath
            if (isModuleRoot) return

            const note =
                file instanceof Obsidian.TFile
                    ? file
                    : targetFolder.children.find(
                          (child): child is Obsidian.TFile =>
                              child instanceof Obsidian.TFile && child.extension === "md",
                      )
            if (!note) return

            const frontmatter = FM.getFrontmatter<EntryMetadata>(plugin.app, note)
            if (!frontmatter?.[FM.DFT_CONTENT_ID]) return

            menu.addItem(item =>
                item
                    .setTitle("Manage on Draftist")
                    .setIcon("external-link")
                    .onClick(() => openOnDraftist(plugin.app, note, result.data)),
            )
        }),
    )
}

type EntryMetadata = {
    [FM.DFT_CONTENT_KIND]?: unknown
    [FM.DFT_CONTENT_ID]?: unknown
    [FM.DFT_LAST_PUBLISHED_SLUG]?: unknown
}

function openOnDraftist(app: Obsidian.App, file: Obsidian.TFile, siteAndModule: Site.SiteAndModule): void {
    const frontmatter = FM.getFrontmatter<EntryMetadata>(app, file)

    if (!frontmatter || !frontmatter[FM.DFT_CONTENT_ID]) {
        Notice.warning(
            "Draftist content ID is missing or corrupted. Contact support before publishing again to repair content id and avoid creating duplicate content.",
        )
        return
    }

    const contentKind = Content.ContentKind.safeParse(frontmatter[FM.DFT_CONTENT_KIND])
    if (!contentKind.success) {
        Notice.warning("Draftist metadata is corrupted. Pull metadata from Draftist and try again.")
        return
    }

    switch (siteAndModule.module.kind) {
        case "blog": {
            if (contentKind.data !== "BlogPost") {
                Notice.warning("Draftist metadata is corrupted. Pull metadata from Draftist and try again.")
                return
            }
            break
        }
        case "docs": {
            if (contentKind.data !== "DocPage") {
                Notice.warning("Draftist metadata is corrupted. Pull metadata from Draftist and try again.")
                return
            }
            break
        }
        default:
            siteAndModule.module.kind satisfies never
            return
    }

    const slug = Content.RenderedSlug.safeParse(frontmatter[FM.DFT_LAST_PUBLISHED_SLUG])
    if (!slug.success) {
        Notice.warning(
            "Draftist slug metadata is missing. Publish this note again to refresh the Draftist preview URL.",
        )
        return
    }

    const url = `https://${siteAndModule.site.config.addresses.draft}/${siteAndModule.module.slug}/${slug.data}`
    openUrlInBrowser(url, "Manage on Draftist ↗")
}
