import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Config from "src/config"
import * as Notice from "src/notice"
import * as Doc from "src/models/doc"
import * as Site from "src/models/site"
import * as FM from "src/models/fm"
import * as FieldError from "src/ui/field-error"
import * as Position from "src/utils/position"
import * as Timer from "src/utils/timer"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"
import * as LocationId from "./location-id"

// --- Modal

export type InsertionMode =
    | { kind: "root" }
    | { kind: "prepend"; reference: Obsidian.TFolder }
    | { kind: "append"; reference: Obsidian.TFolder }
    | { kind: "child"; parent: Obsidian.TFolder }

type PageLocation = {
    id: LocationId.T
    label: string
    parentFolder: Obsidian.TFolder
    mode: InsertionMode
    isHeader?: boolean
}

type FormState = {
    siteId: Site.SiteId | null
    moduleIndex: number
    locationId: LocationId.T
    title: string
    description: string
}

export type CreateDocPagePrefill = {
    siteId: Site.SiteId
    moduleIndex: number
    locationId: LocationId.T
}

export class CreateDocPageModal extends Obsidian.Modal {
    private sites: Config.SiteSettings[]
    private formState: FormState
    private titleInputEl: HTMLInputElement | null = null
    private titleErrorEl: HTMLElement | null = null
    private siteDropdownEl: HTMLSelectElement | null = null
    private siteErrorEl: HTMLElement | null = null

    // Dynamic UI elements
    private moduleDropdown: Obsidian.DropdownComponent | null = null
    private locationDropdown: Obsidian.DropdownComponent | null = null

    constructor(plugin: Plugin, prefill?: CreateDocPagePrefill) {
        super(plugin.app)

        // Load enabled sites with docs modules
        this.sites = Site.sitesWithModule("docs")

        // Use provided prefill, or smart prefill from active file, or defaults
        const derivedPrefill = prefill ?? this.derivePrefillFromActiveFile()

        this.formState = {
            siteId: derivedPrefill?.siteId ?? (this.sites.length === 1 ? this.sites[0].config.id : null),
            moduleIndex: derivedPrefill?.moduleIndex ?? 0,
            locationId: derivedPrefill?.locationId ?? LocationId.beginning(),
            title: "",
            description: "",
        }
    }

    private derivePrefillFromActiveFile(): CreateDocPagePrefill | null {
        const activeFile = this.app.workspace.getActiveFile()
        if (!activeFile) return null

        const result = Site.getSiteAndModuleForFile(activeFile)
        if (result._ === ERROR) return null

        const { site, module } = result.data
        if (module.kind !== "docs") return null

        // Find module index
        const docsModules = site.config.modules.filter(m => m.kind === "docs")
        const moduleIndex = docsModules.findIndex(m => m.name === module.name)

        // Get the page folder (parent of the file)
        const pageFolder = activeFile.parent
        if (!pageFolder) return null

        return {
            siteId: site.config.id,
            moduleIndex: moduleIndex >= 0 ? moduleIndex : 0,
            locationId: LocationId.after(pageFolder),
        }
    }

    onOpen() {
        const { contentEl, titleEl } = this

        titleEl.setText("Create New Page")
        this.modalEl.style.width = "600px"

        // Site dropdown
        if (this.sites.length > 1) {
            const siteSetting = new Obsidian.Setting(contentEl)
                .setName("Site")
                .setDesc("Select the site")
                .addDropdown(dropdown => {
                    if (!this.formState.siteId) {
                        dropdown.addOption("", "Select a site...")
                    }
                    this.sites.forEach(site => {
                        dropdown.addOption(site.config.id, site.config.label || site.config.addresses.primary)
                    })
                    dropdown.setValue(this.formState.siteId || "").onChange(value => {
                        this.formState.siteId = value as Site.SiteId
                        this.formState.moduleIndex = 0
                        this.formState.locationId = LocationId.beginning()
                        this.clearSiteError()
                        this.updateModuleDropdown()
                        this.updateLocationDropdown()
                    })
                    this.siteDropdownEl = dropdown.selectEl
                })
            this.siteErrorEl = FieldError.createErrorEl(siteSetting.infoEl)
        }

        // Module dropdown
        const site = this.sites.find(s => s.config.id === this.formState.siteId)
        const docsModules = site?.config.modules.filter(m => m.kind === "docs") ?? []
        if (docsModules.length > 1) {
            new Obsidian.Setting(contentEl)
                .setName("Module")
                .setDesc("Select the docs module")
                .addDropdown(dropdown => {
                    this.moduleDropdown = dropdown
                    this.updateModuleDropdown()
                    dropdown.onChange(value => {
                        this.formState.moduleIndex = parseInt(value, 10)
                        this.formState.locationId = LocationId.beginning()
                        this.updateLocationDropdown()
                    })
                })
        }

        // Location dropdown
        new Obsidian.Setting(contentEl)
            .setName("Location")
            .setDesc("Where to add the new page")
            .addDropdown(dropdown => {
                this.locationDropdown = dropdown
                this.updateLocationDropdown()
                dropdown.onChange(value => {
                    this.formState.locationId = LocationId.parse(value)
                })
            })

        // Title input
        const titleSetting = new Obsidian.Setting(contentEl)
            .setName("Title")
            .setDesc("Page title")
            .addText(text => {
                text.setPlaceholder("Enter page title")
                    .setValue(this.formState.title)
                    .onChange(value => {
                        this.formState.title = value
                        this.clearTitleError()
                    })

                text.inputEl.style.width = "300px"
                text.inputEl.addEventListener("keydown", this.handleKeyboardSubmission)
                this.titleInputEl = text.inputEl

                Timer.onNextTick(() => text.inputEl.focus())
            })
        this.titleErrorEl = FieldError.createErrorEl(titleSetting.infoEl)

        // Description input
        new Obsidian.Setting(contentEl)
            .setName("Description")
            .setDesc("Optional page description")
            .addText(text => {
                text.setPlaceholder("Optional description")
                    .setValue(this.formState.description)
                    .onChange(value => {
                        this.formState.description = value
                    })

                text.inputEl.style.width = "300px"
                text.inputEl.addEventListener("keydown", this.handleKeyboardSubmission)
            })

        // Buttons
        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Create")
                    .setCta()
                    .onClick(() => this.handleCreate()),
            )
    }

    private updateModuleDropdown() {
        if (!this.moduleDropdown) return

        const site = this.sites.find(s => s.config.id === this.formState.siteId)
        const docsModules = site?.config.modules.filter(m => m.kind === "docs") ?? []

        // Clear and repopulate
        this.moduleDropdown.selectEl.empty()

        docsModules.forEach((module, index) => {
            this.moduleDropdown!.addOption(index.toString(), module.name)
        })

        if (docsModules.length > 0) {
            this.moduleDropdown.setValue(this.formState.moduleIndex.toString())
        }
    }

    private updateLocationDropdown() {
        if (!this.locationDropdown) return

        const locations = this.getLocations()

        // Clear and repopulate
        this.locationDropdown.selectEl.empty()

        locations.forEach(loc => {
            if (loc.isHeader) {
                // Add as disabled header
                const option = this.locationDropdown!.selectEl.createEl("option", {
                    text: loc.label,
                    value: "",
                })
                option.disabled = true
            } else {
                const serialized = LocationId.serialize(loc.id)
                this.locationDropdown!.addOption(serialized, loc.label)
            }
        })

        // Try to keep current selection, fallback to beginning
        const currentExists = locations.some(l => LocationId.eq(l.id, this.formState.locationId) && !l.isHeader)
        if (currentExists) {
            const currentSerialized = LocationId.serialize(this.formState.locationId)
            this.locationDropdown.setValue(currentSerialized)
        } else {
            this.formState.locationId = LocationId.beginning()
            this.locationDropdown.setValue(LocationId.serialize(LocationId.beginning()))
        }
    }

    private getLocations(): PageLocation[] {
        const site = this.sites.find(s => s.config.id === this.formState.siteId)
        if (!site?.path) return []

        const docsModules = site.config.modules.filter(m => m.kind === "docs")
        const module = docsModules[this.formState.moduleIndex]
        if (!module) return []

        const modulePath = Obsidian.normalizePath(`${site.path}/${module.name}`)
        const moduleFolder = this.app.vault.getAbstractFileByPath(modulePath)

        if (!(moduleFolder instanceof Obsidian.TFolder)) {
            return [
                {
                    id: LocationId.beginning(),
                    label: "The very first page",
                    parentFolder: moduleFolder as any,
                    mode: { kind: "root" },
                },
            ]
        }

        const locations: PageLocation[] = []

        // Add "The very first page" option
        locations.push({
            id: LocationId.beginning(),
            label: "The very first page",
            parentFolder: moduleFolder,
            mode: { kind: "root" },
        })

        // Recursively collect pages
        this.collectPageLocations(moduleFolder, locations, 0)

        return locations
    }

    private collectPageLocations(folder: Obsidian.TFolder, locations: PageLocation[], depth: number) {
        // Get child folders with pages with valid position
        const validPages = folder.children
            .filter((c): c is Obsidian.TFolder => c instanceof Obsidian.TFolder)
            .map(f => {
                const mdFile = f.children.find(
                    (c): c is Obsidian.TFile => c instanceof Obsidian.TFile && c.extension === "md",
                )
                if (!mdFile) return null
                const position = getPositionFromFile(this.app, mdFile)
                if (position === null) return null
                return { folder: f, mdFile, position }
            })
            .filter((p): p is { folder: Obsidian.TFolder; mdFile: Obsidian.TFile; position: number } => p !== null)
            .sort((a, b) => a.position - b.position)

        // Use non-breaking spaces for indentation (regular spaces collapse in HTML)
        const nbsp = "\u00A0"
        const indent = nbsp.repeat(4).repeat(depth)
        const actionIndent = indent + nbsp.repeat(2)

        // For non-root levels, add "before first" option
        if (depth > 0 && validPages.length > 0) {
            const firstPage = validPages[0]
            locations.push({
                id: LocationId.before(firstPage.folder),
                label: `${actionIndent}↑ Before "${firstPage.mdFile.basename}"`,
                parentFolder: folder,
                mode: { kind: "prepend", reference: firstPage.folder },
            })
        }

        for (const { folder: childFolder, mdFile } of validPages) {
            const title = mdFile.basename

            // Page header (disabled)
            locations.push({
                id: LocationId.header(childFolder),
                label: `${indent}${title}`,
                parentFolder: folder,
                mode: { kind: "append", reference: childFolder },
                isHeader: true,
            })

            // "After" option (sibling)
            locations.push({
                id: LocationId.after(childFolder),
                label: `${actionIndent}↓ After "${title}"`,
                parentFolder: folder,
                mode: { kind: "append", reference: childFolder },
            })

            // "Child" option (appends after existing children)
            locations.push({
                id: LocationId.firstChild(childFolder),
                label: `${actionIndent}↳ Child of "${title}"`,
                parentFolder: childFolder,
                mode: { kind: "child", parent: childFolder },
            })

            // Recurse into children
            this.collectPageLocations(childFolder, locations, depth + 1)
        }
    }

    handleKeyboardSubmission = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault()
            event.stopPropagation()
            this.handleCreate()
        }
    }

    showSiteError(message: string) {
        if (this.siteErrorEl) {
            FieldError.show(this.siteDropdownEl, this.siteErrorEl, message)
        }
    }

    clearSiteError() {
        if (this.siteErrorEl) {
            FieldError.clear(this.siteDropdownEl, this.siteErrorEl)
        }
    }

    showTitleError(message: string) {
        if (this.titleInputEl && this.titleErrorEl) {
            FieldError.show(this.titleInputEl, this.titleErrorEl, message)
        }
    }

    clearTitleError() {
        if (this.titleInputEl && this.titleErrorEl) {
            FieldError.clear(this.titleInputEl, this.titleErrorEl)
        }
    }

    async handleCreate() {
        if (!this.formState.siteId) {
            this.showSiteError("Please select a site")
            return
        }

        const trimmedTitle = this.formState.title.trim()
        if (!trimmedTitle) {
            this.showTitleError("Title is required")
            return
        }

        try {
            const file = await this.createDocPage(trimmedTitle, this.formState.description.trim())
            if (!file) return

            this.close()

            const leaf = this.app.workspace.getLeaf(false)
            await leaf.openFile(file)
        } catch (error) {
            log.error("Failed to create doc page", error)
            Notice.error("Failed to create doc page", { permanent: true })
        }
    }

    async createDocPage(title: string, description: string): Promise<Obsidian.TFile | null> {
        const site = this.sites.find(s => s.config.id === this.formState.siteId)
        if (!site?.path) throw new Error("Site not found")

        const docsModules = site.config.modules.filter(m => m.kind === "docs")
        const module = docsModules[this.formState.moduleIndex]
        if (!module) throw new Error("Module not found")

        const locations = this.getLocations()
        const location = locations.find(l => LocationId.eq(l.id, this.formState.locationId))
        if (!location) throw new Error("Location not found")

        const { parentFolder, mode } = location

        // Calculate position
        const position = this.calculatePosition(parentFolder, mode)
        if (position === null) {
            Notice.error("Failed to add a new page because reference page is missing position data.")
            return null
        }

        // Calculate folder prefix (for display ordering in file tree)
        const folderPrefix = await this.calculateFolderPrefix(parentFolder, mode)

        // Build paths
        const pageFolderName = `${folderPrefix} - ${title}`
        const pageFolderPath = Obsidian.normalizePath(`${parentFolder.path}/${pageFolderName}`)
        const pageFilePath = Obsidian.normalizePath(`${pageFolderPath}/${title}.md`)

        // Create folder
        await this.ensureFolder(pageFolderPath)

        // Create file with empty content
        const file = await this.app.vault.create(pageFilePath, "")

        // Add frontmatter
        const result = await Doc.updateFrontmatter(this.app, file, frontmatter => {
            frontmatter.status = "Draft"
            frontmatter.description = description || null
            frontmatter["posted on"] = ""
            frontmatter.tags = []
            frontmatter[FM.D42_POSITION] = position
        })

        switch (result._) {
            case OK:
                return file
            case ERROR:
                throw result.error
        }
    }

    calculatePosition(parentFolder: Obsidian.TFolder, mode: InsertionMode): number | null {
        const siblings = this.getSiblingPages(parentFolder)
        const siblingPositions = this.getPositionsFromFrontmatter(siblings)

        if (siblingPositions.length === 0) {
            return Position.initial()
        }

        switch (mode.kind) {
            case "root": {
                // Prepend before first
                const minPos = Math.min(...siblingPositions)
                return Position.prepend(minPos)
            }
            case "child": {
                // Append after last
                const maxPos = Math.max(...siblingPositions)
                return Position.append(maxPos)
            }
            case "prepend": {
                // Find position of reference and insert before
                const refPosition = this.getPositionOfFolder(mode.reference)
                if (refPosition === null) {
                    return null
                }
                const beforePositions = siblingPositions.filter(p => p < refPosition)
                if (beforePositions.length === 0) {
                    return Position.prepend(refPosition)
                } else {
                    const maxBefore = Math.max(...beforePositions)
                    return Position.insert(maxBefore, refPosition)
                }
            }
            case "append": {
                // Find position of reference and insert after
                const refPosition = this.getPositionOfFolder(mode.reference)
                if (refPosition === null) {
                    return null
                }
                const afterPositions = siblingPositions.filter(p => p > refPosition)
                if (afterPositions.length === 0) {
                    return Position.append(refPosition)
                } else {
                    const minAfter = Math.min(...afterPositions)
                    return Position.insert(refPosition, minAfter)
                }
            }
        }
    }

    async calculateFolderPrefix(parentFolder: Obsidian.TFolder, mode: InsertionMode): Promise<string> {
        const siblings = this.getSiblingFolders(parentFolder)

        if (siblings.length === 0) {
            return "01"
        }

        // Extract numeric prefixes
        const prefixes = siblings
            .map(f => Doc.extractPositionFromFolderName(f.name))
            .filter((p): p is number => p !== null)

        if (prefixes.length === 0) {
            return "01"
        }

        switch (mode.kind) {
            case "root": {
                // Prepend: shift all folders and use 01
                await this.shiftFolderPrefixes(parentFolder, 1)
                return "01"
            }
            case "child": {
                // Append: max + 1
                const maxPrefix = Math.max(...prefixes)
                return this.formatPrefix(maxPrefix + 1)
            }
            case "prepend": {
                // Insert before reference: need to shift others
                const refPrefix = Doc.extractPositionFromFolderName(mode.reference.name) ?? 1
                await this.shiftFolderPrefixes(parentFolder, refPrefix)
                return this.formatPrefix(refPrefix)
            }
            case "append": {
                // Insert after reference: need to shift others after
                const refPrefix = Doc.extractPositionFromFolderName(mode.reference.name) ?? 1
                await this.shiftFolderPrefixes(parentFolder, refPrefix + 1)
                return this.formatPrefix(refPrefix + 1)
            }
        }
    }

    formatPrefix(num: number): string {
        return num.toString().padStart(2, "0")
    }

    async shiftFolderPrefixes(parentFolder: Obsidian.TFolder, fromPrefix: number): Promise<void> {
        const siblings = this.getSiblingFolders(parentFolder)

        // Get folders with prefix >= fromPrefix, sorted descending
        const toShift = siblings
            .map(f => ({ folder: f, prefix: Doc.extractPositionFromFolderName(f.name) }))
            .filter(
                (x): x is { folder: Obsidian.TFolder; prefix: number } => x.prefix !== null && x.prefix >= fromPrefix,
            )
            .sort((a, b) => b.prefix - a.prefix)

        // Rename in reverse order to avoid conflicts
        for (const { folder, prefix } of toShift) {
            const newPrefix = this.formatPrefix(prefix + 1)
            const nameWithoutPrefix = Doc.extractTitleFromFolderName(folder.name) ?? folder.name
            const newName = `${newPrefix} - ${nameWithoutPrefix}`
            const newPath = Obsidian.normalizePath(`${parentFolder.path}/${newName}`)

            await this.app.vault.rename(folder, newPath)
        }
    }

    getSiblingFolders(parentFolder: Obsidian.TFolder): Obsidian.TFolder[] {
        return parentFolder.children.filter((c): c is Obsidian.TFolder => c instanceof Obsidian.TFolder)
    }

    getSiblingPages(parentFolder: Obsidian.TFolder): Obsidian.TFile[] {
        // Each page is in a folder with a markdown file
        const result: Obsidian.TFile[] = []

        for (const child of parentFolder.children) {
            if (child instanceof Obsidian.TFolder) {
                const mdFile = child.children.find(
                    (c): c is Obsidian.TFile => c instanceof Obsidian.TFile && c.extension === "md",
                )
                if (mdFile) {
                    result.push(mdFile)
                }
            }
        }

        return result
    }

    getPositionsFromFrontmatter(files: Obsidian.TFile[]): number[] {
        const positions: number[] = []

        for (const file of files) {
            const pos = getPositionFromFile(this.app, file)
            if (pos !== null) {
                positions.push(pos)
            } else {
                Notice.warning(`Page missing position: ${file.path}`)
            }
        }

        return positions
    }

    getPositionOfFolder(folder: Obsidian.TFolder): number | null {
        return getPositionFromFolder(this.app, folder)
    }

    async ensureFolder(path: string): Promise<void> {
        const exists = await this.app.vault.adapter.exists(path)
        if (!exists) {
            await this.app.vault.createFolder(path)
        }
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}

// --- Context Menu

export function registerFileMenuEventHandler(plugin: Plugin): void {
    plugin.registerEvent(
        plugin.app.workspace.on("file-menu", (menu: Obsidian.Menu, file: Obsidian.TAbstractFile) => {
            if (!Config.Store.onboarded()) return

            const result = Site.getSiteAndModuleForFolder(file instanceof Obsidian.TFolder ? file : file.parent!)

            if (result._ === ERROR) return

            const { site, module } = result.data
            if (module.kind !== "docs") return

            const modulePath = Obsidian.normalizePath(`${site.path}/${module.name}`)
            const isModuleRoot = file instanceof Obsidian.TFolder && file.path === modulePath

            menu.addSeparator()

            menu.addItem(item => item.setTitle(`Draft42: ${module.name}`).setIsLabel(true))

            if (isModuleRoot) {
                // Right-click on module root folder
                menu.addItem(item =>
                    item
                        .setTitle("Add page")
                        .setIcon("file-plus")
                        .onClick(() => {
                            const prefill = buildPrefillFromContext(
                                plugin.app,
                                site,
                                module,
                                file as Obsidian.TFolder,
                                "root",
                            )
                            new CreateDocPageModal(plugin, prefill).open()
                        }),
                )
            } else {
                // Right-click on a page folder or file
                const targetFolder = file instanceof Obsidian.TFolder ? file : file.parent!

                // Determine if this is a page folder (contains .md file)
                const isPageFolder = targetFolder.children.some(
                    c => c instanceof Obsidian.TFile && c.extension === "md",
                )

                if (!isPageFolder) return

                menu.addItem(item =>
                    item
                        .setTitle("Add page before")
                        .setIcon("arrow-up")
                        .onClick(() => {
                            const prefill = buildPrefillFromContext(plugin.app, site, module, targetFolder, "before")
                            new CreateDocPageModal(plugin, prefill).open()
                        }),
                )

                menu.addItem(item =>
                    item
                        .setTitle("Add page after")
                        .setIcon("arrow-down")
                        .onClick(() => {
                            const prefill = buildPrefillFromContext(plugin.app, site, module, targetFolder, "after")
                            new CreateDocPageModal(plugin, prefill).open()
                        }),
                )

                menu.addItem(item =>
                    item
                        .setTitle("Add child page")
                        .setIcon("corner-down-right")
                        .onClick(() => {
                            const prefill = buildPrefillFromContext(plugin.app, site, module, targetFolder, "child")
                            new CreateDocPageModal(plugin, prefill).open()
                        }),
                )
            }
        }),
    )
}

function getPositionFromFile(app: Obsidian.App, file: Obsidian.TFile): number | null {
    const frontmatter = Doc.getFrontmatter(app, file)
    const pos = frontmatter?.[FM.D42_POSITION]
    return typeof pos === "number" ? pos : null
}

function getPositionFromFolder(app: Obsidian.App, folder: Obsidian.TFolder): number | null {
    const mdFile = folder.children.find((c): c is Obsidian.TFile => c instanceof Obsidian.TFile && c.extension === "md")
    if (!mdFile) return null
    return getPositionFromFile(app, mdFile)
}

function buildPrefillFromContext(
    app: Obsidian.App,
    site: Config.SiteSettings,
    module: Site.SiteModule,
    targetFolder: Obsidian.TFolder,
    action: "after" | "before" | "child" | "root",
): CreateDocPagePrefill {
    const docsModules = site.config.modules.filter(m => m.kind === "docs")
    const moduleIndex = docsModules.findIndex(m => m.name === module.name)

    let locationId: LocationId.T
    switch (action) {
        case "root":
            locationId = LocationId.beginning()
            break
        case "after":
            locationId = LocationId.after(targetFolder)
            break
        case "before": {
            // Find previous sibling by position and use "after" that, or "beginning"/"before" if first
            const parentFolder = targetFolder.parent
            const targetPosition = getPositionFromFolder(app, targetFolder)

            if (parentFolder && targetPosition !== null) {
                const validSiblings = parentFolder.children
                    .filter((c): c is Obsidian.TFolder => c instanceof Obsidian.TFolder)
                    .map(f => ({ folder: f, position: getPositionFromFolder(app, f) }))
                    .filter((s): s is { folder: Obsidian.TFolder; position: number } => s.position !== null)
                    .sort((a, b) => a.position - b.position)

                const targetIndex = validSiblings.findIndex(s => s.folder.path === targetFolder.path)
                if (targetIndex > 0) {
                    locationId = LocationId.after(validSiblings[targetIndex - 1].folder)
                } else {
                    // First among siblings — check if at module root or nested
                    const modulePath = Obsidian.normalizePath(`${site.path}/${module.name}`)
                    if (parentFolder.path === modulePath) {
                        locationId = LocationId.beginning()
                    } else {
                        locationId = LocationId.before(targetFolder)
                    }
                }
            } else {
                locationId = LocationId.beginning()
            }
            break
        }
        case "child":
            locationId = LocationId.firstChild(targetFolder)
            break
    }

    return {
        siteId: site.config.id,
        moduleIndex: moduleIndex >= 0 ? moduleIndex : 0,
        locationId,
    }
}
