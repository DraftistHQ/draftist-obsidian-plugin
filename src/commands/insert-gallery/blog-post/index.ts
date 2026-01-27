import * as Obsidian from "obsidian"

import * as Post from "src/models/post"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import * as log from "src/logger"

// TODO: Current gallery UX is meh. Things to implement:
// - ability to add/reorder/remove images
// - set optional caption for each image

type FormState = {
    imageFiles: File[]
    caption: string
    collapsedByDefault: boolean
}

class InsertGalleryModal extends Obsidian.Modal {
    private file: Obsidian.TFile
    private formState: FormState
    private imageButtonEl: HTMLButtonElement | null = null

    constructor(app: Obsidian.App, file: Obsidian.TFile) {
        super(app)
        this.file = file
        this.formState = {
            imageFiles: [],
            caption: "",
            collapsedByDefault: true,
        }
    }

    onOpen() {
        const { titleEl, contentEl } = this

        titleEl.setText("Insert Gallery")

        this.modalEl.style.width = "600px"

        new Obsidian.Setting(contentEl)
            .setName("Images")
            .setDesc("Select images for the gallery")
            .addButton(button => {
                this.imageButtonEl = button.buttonEl
                button.setButtonText("Select Images").onClick(async () => {
                    const imageFiles = await Image.pickImageFiles({ multiple: true })
                    if (imageFiles.length > 0) {
                        this.formState.imageFiles = imageFiles
                        button.setButtonText(`${imageFiles.length} image(s) selected`)
                    }
                })
            })

        new Obsidian.Setting(contentEl)
            .setName("Caption")
            .setDesc("Optional caption for the gallery")
            .addText(text =>
                text
                    .setPlaceholder("My photo gallery")
                    .setValue(this.formState.caption)
                    .onChange(value => {
                        this.formState.caption = value
                    }),
            )

        new Obsidian.Setting(contentEl)
            .setName("Collapsed by default")
            .setDesc("Gallery will be collapsed when the page loads")
            .addToggle(toggle =>
                toggle.setValue(this.formState.collapsedByDefault).onChange(value => {
                    this.formState.collapsedByDefault = value
                }),
            )

        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Insert")
                    .setCta()
                    .onClick(() => this.handleSubmit()),
            )
    }

    async handleSubmit() {
        if (this.formState.imageFiles.length === 0) {
            Notice.warning("Please select at least one image")
            return
        }

        try {
            await this.insertGallery()
            Notice.info("Gallery inserted")
            this.close()
        } catch (error) {
            log.error("Failed to insert gallery", error)
            Notice.error("Failed to insert gallery")
        }
    }

    async insertGallery(): Promise<void> {
        const folder = this.file.parent
        if (!folder) {
            throw new Error("Cannot determine post folder")
        }

        const editor = this.app.workspace.activeEditor?.editor
        if (!editor) {
            throw new Error("No active editor")
        }

        const imageFileNames: string[] = []

        for (const imageFile of this.formState.imageFiles) {
            const imageFileName = Image.generateUniqueFilename(imageFile.name, Post.IMAGE_PREFIX_POST)
            await Post.copyImageFileToPostSubfolder(this.app, folder, imageFileName, imageFile)
            imageFileNames.push(imageFileName)
        }

        const foldingMarker = this.formState.collapsedByDefault ? "-" : "+"
        const caption = this.formState.caption.trim()
        const headerLine = `> [!GALLERY]${foldingMarker}${caption ? ` ${caption}` : ""}`

        const imageLines = imageFileNames.map(name => `> ![](${name})`).join("\n")

        const markdown = `${headerLine}\n${imageLines}`

        editor.replaceSelection(markdown)
    }

    onClose() {
        this.contentEl.empty()
    }
}

export async function insertGallery(app: Obsidian.App, file: Obsidian.TFile): Promise<void> {
    const folder = file.parent
    if (!folder) {
        Notice.warning("Cannot determine post folder")
        return
    }

    const editor = app.workspace.activeEditor?.editor
    if (!editor) {
        Notice.warning("No active editor to insert gallery")
        return
    }

    new InsertGalleryModal(app, file).open()
}
