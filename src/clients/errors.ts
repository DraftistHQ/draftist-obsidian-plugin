import { z } from "zod"

export const ContentParsingError = z.discriminatedUnion("TAG", [
    z.object({
        TAG: z.literal("UnimplementedNode"),
        node: z.string(),
    }),
    z.object({
        TAG: z.literal("UnexpectedNode"),
        node: z.string(),
    }),
    z.object({
        TAG: z.literal("HeadingNodeConversionError"),
        error: z.object({ TAG: z.literal("TooDeep"), level: z.number() }),
    }),
    z.object({
        TAG: z.literal("ListNodeConversionError"),
        error: z.union([
            z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
            z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
            z.object({
                TAG: z.literal("SubListConversionError"),
                error: z.array(
                    z.union([
                        z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                        z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                        z.object({ TAG: z.literal("SubListConversionError"), error: z.any() }), // Recursive
                    ]),
                ),
            }),
        ]),
    }),
    z.object({
        TAG: z.literal("BlockquoteNodeConversionError"),
        error: z.discriminatedUnion("TAG", [
            z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
            z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
        ]),
    }),
    z.object({
        TAG: z.literal("CalloutError"),
        error: z.union([
            z.literal("InvalidSyntax"),
            z.object({ TAG: z.literal("UnexpectedCalloutVariant"), variant: z.string() }),
            z.object({
                TAG: z.literal("BlockParsingError"),
                error: z.discriminatedUnion("TAG", [
                    z.object({ TAG: z.literal("UnsupportedNode"), node: z.string() }),
                    z.object({
                        TAG: z.literal("HeadingError"),
                        error: z.object({ TAG: z.literal("TooDeep"), level: z.number() }),
                    }),
                    z.object({
                        TAG: z.literal("ListError"),
                        error: z.union([
                            z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                            z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                            z.object({ TAG: z.literal("SubListConversionError"), error: z.any() }), // Recursive
                        ]),
                    }),
                    z.object({
                        TAG: z.literal("QuoteError"),
                        error: z.discriminatedUnion("TAG", [
                            z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                            z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                        ]),
                    }),
                    z.object({
                        TAG: z.literal("ImageError"),
                        error: z.discriminatedUnion("TAG", [
                            z.object({ TAG: z.literal("UnexpectedParams"), params: z.string() }),
                            z.object({ TAG: z.literal("UnexpectedPlacementValue"), value: z.string() }),
                            z.object({ TAG: z.literal("ImageNotFound"), url: z.string() }),
                        ]),
                    }),
                    z.object({
                        TAG: z.literal("VideoError"),
                        error: z.discriminatedUnion("TAG", [
                            z.object({
                                TAG: z.literal("UnexpectedExternalSource"),
                                error: z.union([
                                    z.object({ TAG: z.literal("InvalidYouTubeUrl"), url: z.string() }),
                                    z.object({ TAG: z.literal("UnexpectedYouTubeUrl"), url: z.string() }),
                                    z.literal("YouTubeUrlContainsInvalidChars"),
                                ]),
                            }),
                        ]),
                    }),
                    z.object({
                        TAG: z.literal("GalleryError"),
                        error: z.union([
                            z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                            z.object({ TAG: z.literal("MissingImage"), url: z.string() }),
                            z.literal("EmptyGallery"),
                        ]),
                    }),
                ]),
            }),
        ]),
    }),
    z.object({
        TAG: z.literal("ImageConversionError"),
        error: z.discriminatedUnion("TAG", [
            z.object({ TAG: z.literal("UnexpectedParams"), params: z.string() }),
            z.object({ TAG: z.literal("UnexpectedPlacementValue"), value: z.string() }),
            z.object({ TAG: z.literal("ImageNotFound"), url: z.string() }),
        ]),
    }),
    z.object({
        TAG: z.literal("VideoConversionError"),
        error: z.discriminatedUnion("TAG", [
            z.object({
                TAG: z.literal("UnexpectedExternalSource"),
                error: z.union([
                    z.object({ TAG: z.literal("InvalidYouTubeUrl"), url: z.string() }),
                    z.object({ TAG: z.literal("UnexpectedYouTubeUrl"), url: z.string() }),
                    z.literal("YouTubeUrlContainsInvalidChars"),
                ]),
            }),
        ]),
    }),
    z.object({
        TAG: z.literal("GalleryError"),
        error: z.union([
            z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
            z.object({ TAG: z.literal("MissingImage"), url: z.string() }),
            z.literal("EmptyGallery"),
        ]),
    }),
])
export type ContentParsingError = z.infer<typeof ContentParsingError>

export const InvalidContentError = z.object({
    TAG: z.literal("InvalidContent"),
    error: z.object({
        TAG: z.literal("ParsingErrors"),
        errors: z.array(ContentParsingError),
    }),
})
export type InvalidContentError = z.infer<typeof InvalidContentError>