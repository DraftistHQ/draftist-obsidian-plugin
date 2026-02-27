import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Config from "src/config"
import * as Notice from "src/notice"
import * as Doc from "src/models/doc"
import * as Site from "src/models/site"
import * as FM from "src/models/fm"
import * as Position from "src/utils/position"
import { OK, ERROR } from "src/utils/result"
import { Commands } from "src/commands"
import * as log from "src/logger"

// --- Commands

export function registerCommands(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.MOVE_DOC_PAGE_UP,
        checkCallback: (checking: boolean) => {
            if (!Config.Store.onboarded()) return false

            const folder = getActiveDocPageFolder(plugin.app)
            if (!folder?.parent) return false

            const siblings = getSortedSiblings(plugin.app, folder.parent)
            const index = siblings.findIndex(s => s.folder.path === folder.path)
            if (index <= 0) return false

            if (!checking) {
                movePage(plugin.app, folder, "up")
            }
            return true
        },
    })

    plugin.addCommand({
        ...Commands.MOVE_DOC_PAGE_DOWN,
        checkCallback: (checking: boolean) => {
            if (!Config.Store.onboarded()) return false

            const folder = getActiveDocPageFolder(plugin.app)
            if (!folder?.parent) return false

            const siblings = getSortedSiblings(plugin.app, folder.parent)
            const index = siblings.findIndex(s => s.folder.path === folder.path)
            if (index === -1 || index >= siblings.length - 1) return false

            if (!checking) {
                movePage(plugin.app, folder, "down")
            }
            return true
        },
    })
}

// --- Helpers

export function getActiveDocPageFolder(app: Obsidian.App): Obsidian.TFolder | null {
    const file = app.workspace.getActiveFile()
    if (!file) return null

    const result = Site.getSiteAndModuleForFile(file)
    if (result._ === ERROR) return null
    if (result.data.module.kind !== "docs") return null

    const folder = file.parent
    if (!folder) return null

    // Ensure it's a page folder (contains .md file)
    const isPageFolder = folder.children.some(c => c instanceof Obsidian.TFile && c.extension === "md")
    if (!isPageFolder) return null

    return folder
}

// --- Context Menu

export function registerFileMenuEventHandler(plugin: Plugin): void {
    plugin.registerEvent(
        plugin.app.workspace.on("file-menu", (menu: Obsidian.Menu, file: Obsidian.TAbstractFile) => {
            if (!Config.Store.onboarded()) return

            const result = Site.getSiteAndModuleForFolder(file instanceof Obsidian.TFolder ? file : file.parent!)

            if (result._ === ERROR) return

            const { module } = result.data
            if (module.kind !== "docs") return

            const modulePath = Obsidian.normalizePath(`${result.data.site.path}/${module.name}`)
            const isModuleRoot = file instanceof Obsidian.TFolder && file.path === modulePath

            if (isModuleRoot) return

            // Right-click on a page folder or file
            const targetFolder = file instanceof Obsidian.TFolder ? file : file.parent!

            // Determine if this is a page folder (contains .md file)
            const isPageFolder = targetFolder.children.some(c => c instanceof Obsidian.TFile && c.extension === "md")

            if (!isPageFolder) return

            const siblings = getSortedSiblings(plugin.app, targetFolder.parent!)
            const targetIndex = siblings.findIndex(s => s.folder.path === targetFolder.path)

            if (targetIndex > 0) {
                menu.addItem(item =>
                    item
                        .setTitle("Move up")
                        .setIcon("chevron-up")
                        .onClick(() => movePage(plugin.app, targetFolder, "up")),
                )
            }

            if (targetIndex >= 0 && targetIndex < siblings.length - 1) {
                menu.addItem(item =>
                    item
                        .setTitle("Move down")
                        .setIcon("chevron-down")
                        .onClick(() => movePage(plugin.app, targetFolder, "down")),
                )
            }
        }),
    )
}

// --- Move Logic

type SortedSibling = {
    folder: Obsidian.TFolder
    mdFile: Obsidian.TFile
    position: number
}

export function getSortedSiblings(app: Obsidian.App, parentFolder: Obsidian.TFolder): SortedSibling[] {
    return parentFolder.children
        .filter((c): c is Obsidian.TFolder => c instanceof Obsidian.TFolder)
        .map(f => {
            const mdFile = f.children.find(
                (c): c is Obsidian.TFile => c instanceof Obsidian.TFile && c.extension === "md",
            )
            if (!mdFile) return null
            const position = getPositionFromFile(app, mdFile)
            if (position === null) return null
            return { folder: f, mdFile, position }
        })
        .filter((s): s is SortedSibling => s !== null)
        .sort((a, b) => a.position - b.position)
}

async function movePage(app: Obsidian.App, targetFolder: Obsidian.TFolder, direction: "up" | "down"): Promise<void> {
    const parentFolder = targetFolder.parent
    if (!parentFolder) return

    const siblings = getSortedSiblings(app, parentFolder)
    const targetIndex = siblings.findIndex(s => s.folder.path === targetFolder.path)
    if (targetIndex === -1) return

    const target = siblings[targetIndex]

    let newPosition: number
    switch (direction) {
        case "up": {
            if (targetIndex === 0) return
            const neighbor = siblings[targetIndex - 1]
            const prev = siblings[targetIndex - 2]
            newPosition = prev ? Position.insert(prev.position, neighbor.position) : Position.prepend(neighbor.position)
            break
        }
        case "down": {
            if (targetIndex === siblings.length - 1) return
            const neighbor = siblings[targetIndex + 1]
            const next = siblings[targetIndex + 2]
            newPosition = next ? Position.insert(neighbor.position, next.position) : Position.append(neighbor.position)
            break
        }
    }

    // Update frontmatter position
    const result = await Doc.updateFrontmatter(app, target.mdFile, frontmatter => {
        frontmatter[FM.D42_POSITION] = newPosition
    })
    if (result._ === ERROR) {
        log.error("Failed to update position", result.error)
        Notice.error("Failed to move page")
        return
    }

    // Swap folder prefixes
    const neighborIndex = direction === "up" ? targetIndex - 1 : targetIndex + 1
    const neighbor = siblings[neighborIndex]

    const targetParsed = Doc.parseFolderName(targetFolder.name)
    const neighborParsed = Doc.parseFolderName(neighbor.folder.name)
    if (!targetParsed || !neighborParsed) return

    const formatPrefix = (n: number) => n.toString().padStart(2, "0")

    const targetNewName = `${formatPrefix(neighborParsed.position)} - ${targetParsed.title}`
    const targetNewPath = Obsidian.normalizePath(`${parentFolder.path}/${targetNewName}`)
    const neighborNewName = `${formatPrefix(targetParsed.position)} - ${neighborParsed.title}`
    const neighborNewPath = Obsidian.normalizePath(`${parentFolder.path}/${neighborNewName}`)

    // Swapping same-titled folders requires a temp rename, which triggers the
    // file tree manager's folder rename handler and corrupts the .md filename.
    if (targetParsed.title === neighborParsed.title) {
        Notice.warning("Cannot swap folders with the same name. Rename one of the pages first.")
        return
    }

    await app.vault.rename(targetFolder, targetNewPath)
    await app.vault.rename(neighbor.folder, neighborNewPath)
}

function getPositionFromFile(app: Obsidian.App, file: Obsidian.TFile): number | null {
    const frontmatter = Doc.getFrontmatter(app, file)
    const pos = frontmatter?.[FM.D42_POSITION]
    return typeof pos === "number" ? pos : null
}
