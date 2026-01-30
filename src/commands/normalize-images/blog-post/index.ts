import * as Obsidian from "obsidian"

import * as Assets from "src/models/assets"
import * as Image from "src/models/image"
import * as Post from "src/models/post"
import * as Notice from "src/notice"
import * as log from "src/logger"

class NormalizeImagesModal extends Obsidian.Modal {
    private count: number
    private proceed: () => void

    constructor(app: Obsidian.App, count: number, onConfirm: () => void) {
        super(app)
        this.count = count
        this.proceed = onConfirm
    }

    onOpen() {
        const { titleEl, contentEl } = this

        titleEl.setText("Normalize Images")

        contentEl.createEl("p", {
            text: `This will normalize ${this.count} image(s) in this document.`,
        })

        contentEl.createEl("p", {
            text: "All images used in this post will be collected in the ./images folder next to the post file. If an image is already in this folder, it will be renamed by appending a random hash to guarantee uniqueness. If an image is not in this folder, it will be copied there, renamed, and the link(s) in the post will be updated.",
        })

        contentEl.createEl("p", {
            text: "⚠️ It's recommended to backup your files before proceeding.",
            cls: "mod-warning",
        })

        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Proceed")
                    .setCta()
                    .onClick(() => {
                        this.close()
                        this.proceed()
                    }),
            )
    }
}

type UniqueImage = {
    file: Obsidian.TFile
    currentPath: string
    isCover: boolean
    linkTexts: string[]
    isInImagesFolder: boolean
    isNormalized: boolean
}

type TriagedImage = {
    original: UniqueImage
    newFilename: string
    newPath: string
    action: "copy" | "rename" | "skip"
}

const MD_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^"\s)]+)(?:\s+"([^"]*)")?\)$/

function collectImages(
    app: Obsidian.App,
    file: Obsidian.TFile,
    fileCache: Obsidian.CachedMetadata,
    imagesFolderPath: string,
): UniqueImage[] {
    const imagesMap = new Map<string, UniqueImage>()

    // Collect embedded images
    fileCache.embeds?.forEach(embed => {
        const imageFile = app.metadataCache.getFirstLinkpathDest(embed.link, file.path)
        if (imageFile && Image.ALLOWED_FORMATS.includes(imageFile.extension.toLowerCase())) {
            const existing = imagesMap.get(imageFile.path)
            if (existing) {
                // Same file, different link text - add to linkTexts
                if (!existing.linkTexts.includes(embed.link)) {
                    existing.linkTexts.push(embed.link)
                }
            } else {
                const isInImagesFolder = imageFile.parent?.path === imagesFolderPath
                imagesMap.set(imageFile.path, {
                    file: imageFile,
                    currentPath: imageFile.path,
                    isCover: false,
                    linkTexts: [embed.link],
                    isInImagesFolder,
                    isNormalized: isInImagesFolder && Post.isNormalizedImageFilename(imageFile.name),
                })
            }
        }
    })

    // Collect cover image from frontmatter
    fileCache.frontmatterLinks?.forEach(fm => {
        if (fm.key === "cover") {
            const imageFile = app.metadataCache.getFirstLinkpathDest(fm.link, file.path)
            if (imageFile) {
                const existing = imagesMap.get(imageFile.path)
                if (existing) {
                    existing.isCover = true
                    if (!existing.linkTexts.includes(fm.link)) {
                        existing.linkTexts.push(fm.link)
                    }
                } else {
                    const isInImagesFolder = imageFile.parent?.path === imagesFolderPath
                    imagesMap.set(imageFile.path, {
                        file: imageFile,
                        currentPath: imageFile.path,
                        isCover: true,
                        linkTexts: [fm.link],
                        isInImagesFolder,
                        isNormalized: isInImagesFolder && Post.isNormalizedImageFilename(imageFile.name),
                    })
                }
            }
        }
    })

    return Array.from(imagesMap.values())
}

function triageImages(images: UniqueImage[], imagesFolderPath: string): TriagedImage[] {
    const triaged: TriagedImage[] = []

    for (const image of images) {
        if (image.isNormalized) {
            // Already properly named and in correct location
            triaged.push({
                original: image,
                newFilename: image.file.name,
                newPath: image.currentPath,
                action: "skip",
            })
            continue
        }

        const prefix = image.isCover ? Post.IMAGE_PREFIX_COVER : Post.IMAGE_PREFIX_POST
        const newFilename = Image.generateUniqueFilename(image.file.name, prefix)
        const newPath = Obsidian.normalizePath(`${imagesFolderPath}/${newFilename}`)

        if (!image.isInImagesFolder) {
            // Image is outside ./images folder - need to copy
            triaged.push({
                original: image,
                newFilename,
                newPath,
                action: "copy",
            })
        } else {
            // Image is in ./images but not properly named - need to rename
            triaged.push({
                original: image,
                newFilename,
                newPath,
                action: "rename",
            })
        }
    }

    return triaged
}

async function executeFileOperations(
    app: Obsidian.App,
    imagesFolderPath: string,
    triaged: TriagedImage[],
): Promise<void> {
    const imagesFolderExists = await app.vault.adapter.exists(imagesFolderPath)
    if (!imagesFolderExists) {
        await app.vault.createFolder(imagesFolderPath)
    }

    for (const item of triaged) {
        switch (item.action) {
            case "skip":
                continue

            case "copy":
                // Copy image to ./images with new name
                await app.vault.adapter.copy(item.original.currentPath, item.newPath)
                break

            case "rename":
                // Rename image file (metadata is handled by FileTreeManager)
                await app.fileManager.renameFile(item.original.file, item.newPath)
                break

            default:
                item.action satisfies never
        }
    }
}

async function updateEmbedLinks(
    app: Obsidian.App,
    file: Obsidian.TFile,
    fileCache: Obsidian.CachedMetadata,
    replacements: Map<string, string>,
): Promise<void> {
    const embeds = fileCache.embeds ?? []

    // Filter to only embeds that need replacement
    const toReplace = embeds.filter(embed => replacements.has(embed.link))
    if (toReplace.length === 0) return

    // CRITICAL: Sort by position descending (end-to-start)
    // This preserves character offsets as we modify the string
    toReplace.sort((a, b) => b.position.start.offset - a.position.start.offset)

    let content = await app.vault.read(file)

    for (const embed of toReplace) {
        const newFilename = replacements.get(embed.link)!
        const { start, end } = embed.position
        const oldText = embed.original

        let newText: string
        if (oldText.startsWith("![[")) {
            // Wiki-link format: ![[path]] or ![[path|alias]]
            const hasAlias = embed.displayText && embed.displayText !== embed.link
            newText = hasAlias ? `![[${newFilename}|${embed.displayText}]]` : `![[${newFilename}]]`
        } else {
            // Standard markdown: ![alt](path "title")
            const match = oldText.match(MD_IMAGE_REGEX)
            if (match) {
                const [, alt, , title] = match
                // Preserve alt text and title attribute
                newText = title ? `![${alt}](${newFilename} "${title}")` : `![${alt}](${newFilename})`
            } else {
                // Fallback: simple replacement (shouldn't happen)
                newText = `![](${newFilename})`
            }
        }

        // Splice at exact positions
        content = content.slice(0, start.offset) + newText + content.slice(end.offset)
    }

    await app.vault.modify(file, content)
}

async function updateCoverLink(
    app: Obsidian.App,
    file: Obsidian.TFile,
    fileCache: Obsidian.CachedMetadata,
    replacements: Map<string, string>,
): Promise<void> {
    const coverLink = fileCache.frontmatterLinks?.find(fm => fm.key === "cover")
    if (!coverLink) return

    const newFilename = replacements.get(coverLink.link)
    if (!newFilename) return

    await Post.updateFrontmatter(app, file, fm => {
        fm.cover = `[[${newFilename}]]`
    })
}

async function executeNormalization(
    app: Obsidian.App,
    file: Obsidian.TFile,
    fileCache: Obsidian.CachedMetadata,
    imagesFolderPath: string,
    triaged: TriagedImage[],
): Promise<void> {
    const toProcess = triaged.filter(p => p.action !== "skip")

    // Step 1: Execute file operations
    await executeFileOperations(app, imagesFolderPath, triaged)

    // Build replacement map - ONLY for copy actions (rename is handled by Obsidian)
    const replacements = new Map<string, string>()
    for (const item of toProcess) {
        if (item.action === "copy") {
            for (const linkText of item.original.linkTexts) {
                replacements.set(linkText, item.newFilename)
            }
        }
    }

    // Step 2: Update embedded image links
    await updateEmbedLinks(app, file, fileCache, replacements)

    // Step 3: Update cover link in frontmatter
    await updateCoverLink(app, file, fileCache, replacements)

    Notice.info(`Normalized ${toProcess.length} image(s)`)
}

export async function normalizeImages(app: Obsidian.App, file: Obsidian.TFile): Promise<void> {
    const folder = file.parent
    if (!folder) {
        Notice.warning("Cannot determine post folder")
        return
    }

    const fileCache = app.metadataCache.getFileCache(file)
    if (!fileCache) {
        Notice.warning("Cannot read file metadata")
        return
    }

    const imagesFolderPath = Obsidian.normalizePath(`${folder.path}/${Assets.IMAGES_FOLDER}`)

    try {
        // Step 1: Collect all images
        const images = collectImages(app, file, fileCache, imagesFolderPath)

        if (images.length === 0) {
            Notice.info("No images found in document")
            return
        }

        // Step 2: Determine what needs to be done
        const triaged = triageImages(images, imagesFolderPath)

        const toProcess = triaged.filter(p => p.action !== "skip")
        if (toProcess.length === 0) {
            Notice.info("All images are already normalized")
            return
        }

        // Step 3: Show confirmation modal
        new NormalizeImagesModal(app, toProcess.length, async () => {
            try {
                await executeNormalization(app, file, fileCache, imagesFolderPath, triaged)
            } catch (error) {
                log.error("Failed to normalize images", error)
                Notice.error("Failed to normalize images")
            }
        }).open()
    } catch (error) {
        log.error("Failed to prepare image normalization", error)
        Notice.error("Failed to prepare image normalization")
    }
}
