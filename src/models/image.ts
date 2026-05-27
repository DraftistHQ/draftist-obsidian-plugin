import * as Obsidian from "obsidian"
import { z } from "zod"

import * as Site from "src/models/site"
import * as ImageUploader from "src/clients/image-uploader"
import * as Opaque from "src/utils/opaque"
import * as Uuid from "src/utils/uuid"
import { Ok, Err, OK, ERROR, Result, GenericError } from "src/utils/result"
import * as log from "src/logger"

export const MAX_SIZE = 10 * 1024 * 1024 // 10Mb
export const ALLOWED_FORMATS = ["jpg", "jpeg", "png", "webp", "gif"]
export const METADATA_SUFFIX = "draftist.json"

export const ImageId = Opaque.id<"ImageId">()
export type ImageId = z.infer<typeof ImageId>

export const ImagePlaceholderKind = z.enum(["BlurHash", "Primitive"])
export type ImagePlaceholderKind = z.infer<typeof ImagePlaceholderKind>

export const UploadedImage = z.object({ id: ImageId })
export type UploadedImage = z.infer<typeof UploadedImage>

export const UploadedImageMetadata = z.object({
    imageId: ImageId,
    lastModified: z.number(),
})
export type UploadedImageMetadata = z.infer<typeof UploadedImageMetadata>

export const PublishableImage = z.object({
    id: ImageId,
    filename: z.string(),
    absolutePath: z.string(),
})
export type PublishableImage = z.infer<typeof PublishableImage>

export function buildImageMetadataPath(image: Obsidian.TFile): string {
    return `${image.path}.${METADATA_SUFFIX}`
}

export function generateUniqueFilename(originalFilename: string, prefix: string): string {
    const uuid = Uuid.generate(8)
    const lastDotIndex = originalFilename.lastIndexOf(".")
    const baseName = lastDotIndex > 0 ? originalFilename.substring(0, lastDotIndex) : originalFilename
    const ext = lastDotIndex > 0 ? originalFilename.substring(lastDotIndex + 1) : ""
    return ext ? `${prefix}-${baseName}.${uuid}.${ext}` : `${prefix}-${baseName}.${uuid}`
}

export async function readUploadedImageMetadata(
    asset: Obsidian.TFile,
): Promise<Result<UploadedImageMetadata | null, GenericError>> {
    const path = buildImageMetadataPath(asset)
    const file = asset.vault.getAbstractFileByPath(path)

    if (!file) return Ok(null)

    let contents
    try {
        contents = await asset.vault.read(file as Obsidian.TFile)
    } catch (error) {
        return Err(new GenericError(`Failed to read image metadata at ${path}`, error))
    }

    let json
    try {
        json = JSON.parse(contents)
    } catch (error) {
        return Err(new GenericError(`Failed to parse image metadata json at ${path}`, error))
    }

    const result = UploadedImageMetadata.safeParse(json)
    if (result.success) {
        return Ok(result.data)
    } else {
        return Err(new GenericError(`Failed to deserialize image metadata at ${path}`, result.error))
    }
}

export async function writeUploadedImageMetadata(
    imageId: ImageId,
    file: Obsidian.TFile,
): Promise<Result<null, GenericError>> {
    let path = buildImageMetadataPath(file)
    let meta: UploadedImageMetadata = {
        imageId,
        lastModified: file.stat.mtime,
    }
    let json = JSON.stringify(meta, null, 4)

    log.debug(`Writing image metadata to ${path}`, { meta, json })

    try {
        await file.vault.adapter.write(path, json)
        return Ok(null)
    } catch (error) {
        return Err(new GenericError(`Failed to write image metadata to ${path}`, error))
    }
}

export type ImageFile<X = {}> = { file: Obsidian.TFile } & X

export type ImageValidtaionError =
    | { _: "UNSUPPORTED_FORMAT"; asset: Obsidian.TFile }
    | { _: "IMAGE_TOO_BIG"; asset: Obsidian.TFile }

export function validateAssets<X>(assets: ImageFile<X>[]): Result<ImageFile<X>[], ImageValidtaionError[]> {
    let invalid: ImageValidtaionError[] = []

    assets.forEach(asset => {
        if (!ALLOWED_FORMATS.includes(asset.file.extension.toLowerCase())) {
            invalid.push({ _: "UNSUPPORTED_FORMAT", asset: asset.file })
            return
        }

        if (asset.file.stat.size > MAX_SIZE) {
            invalid.push({ _: "IMAGE_TOO_BIG", asset: asset.file })
            return
        }
    })

    if (invalid.length > 0) {
        return Err(invalid)
    }

    return Ok(assets)
}

export type ImageUploadError =
    | { _: "FAILED_TO_READ_IMAGE"; error: any }
    | { _: "FAILED_TO_UPLOAD_IMAGE"; error: ImageUploader.ResponseError }

export async function uploadImage(
    siteId: Site.SiteId,
    image: Obsidian.TFile,
): Promise<Result<UploadedImage, ImageUploadError>> {
    let arrayBuffer
    try {
        arrayBuffer = await image.vault.readBinary(image)
    } catch (error) {
        return Err({ _: "FAILED_TO_READ_IMAGE", error })
    }

    const file = new File([arrayBuffer], image.name, { type: "image/" + image.extension })

    const body = new FormData()

    body.append("image", file)
    body.append("site-id", siteId)

    let uploadResult = await ImageUploader.post(body)

    switch (uploadResult._) {
        case OK:
            return Ok(uploadResult.data)
        case ERROR:
            return Err({ _: "FAILED_TO_UPLOAD_IMAGE", error: uploadResult.error })
    }
}

type PickImageOptions = { multiple: boolean }

export function pickImageFiles(options: { multiple: false }): Promise<File | null>
export function pickImageFiles(options: { multiple: true }): Promise<File[]>
export function pickImageFiles(options: PickImageOptions): Promise<File | File[] | null> {
    return new Promise(resolve => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "image/*"

        if (options.multiple) {
            input.multiple = true
        }

        input.onchange = () => {
            if (options.multiple) {
                const files = input.files ? Array.from(input.files) : []
                resolve(files)
            } else {
                const file = input.files?.[0]
                resolve(file || null)
            }
        }

        input.oncancel = () => {
            if (options.multiple) {
                resolve([])
            } else {
                resolve(null)
            }
        }

        input.click()
    })
}
