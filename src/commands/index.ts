export type Command = {
    id: string
    name: string
}

export const Commands: Record<string, Command> = {
    PUBLISH_ENTRY: {
        id: "publish-entry",
        name: "Preview and publish",
    },
    DELETE_META_ENTRIES: {
        id: "delete-meta-entries",
        name: "Delete meta entries",
    },
    CREATE_BLOG_POST_IDEA: {
        id: "create-blog-post-idea",
        name: "Create new blog post idea",
    },
    CREATE_BLOG_POST_DRAFT: {
        id: "create-blog-post-draft",
        name: "Create new blog post draft",
    },
    INSERT_IMAGE: {
        id: "insert-image",
        name: "Insert image",
    },
    INSERT_GALLERY: {
        id: "insert-gallery",
        name: "Insert gallery",
    },
    NORMALIZE_IMAGES: {
        id: "normalize-images",
        name: "Normalize images",
    },
    SET_COVER_IMAGE: {
        id: "set-cover-image",
        name: "Set cover image",
    },
    NORMALIZE_FRONTMATTER: {
        id: "normalize-frontmatter",
        name: "Normalize frontmatter",
    },
    COPY_DEBUG_INFO: {
        id: "copy-debug-info",
        name: "Copy debug info",
    },
}
