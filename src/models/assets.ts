import * as Obsidian from "obsidian"

export const IMAGES_FOLDER = "images"

export async function copyImageFileToSubfolder(
    app: Obsidian.App,
    parentFolder: Obsidian.TFolder,
    imageFileName: string,
    imageFile: File,
) {
    const imagesFolderPath = Obsidian.normalizePath(`${parentFolder.path}/${IMAGES_FOLDER}`)
    const imagesFolderExists = await app.vault.adapter.exists(imagesFolderPath)
    if (!imagesFolderExists) {
        await app.vault.createFolder(imagesFolderPath)
    }

    const imagePath = Obsidian.normalizePath(`${imagesFolderPath}/${imageFileName}`)
    const imageBuffer = await imageFile.arrayBuffer()
    await app.vault.adapter.writeBinary(imagePath, Buffer.from(imageBuffer))
}