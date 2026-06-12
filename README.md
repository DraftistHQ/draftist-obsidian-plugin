# Draftist

Publish your personal content websites directly from [Obsidian](https://obsidian.md).

[Draftist](https://draftist.io) is a publishing platform for personal websites. This plugin lets you write and manage your content in Obsidian, then publish it to your Draftist sites with a single command.

## Features

- **Preview & publish** — See your content on your site before going live
- **Lifecycle management** — Publish, unpublish, archive, restore, and delete content from Draftist
- **Custom domains** — Your own domain with automatic SSL and redirects
- **Theming** — Fonts, colors, light/dark mode, upload custom fonts
- **SEO-ready** — Server-rendered content, meta/og tags, clean URLs
- **Image optimization** — CDN delivery and state-of-the-art placeholders
- **Deep linking** — Block IDs for linking to any content block
- _[coming soon]_ Multi-site support
- **Documentation sites** — Hierarchical docs pages with parent/child navigation _(private beta)_
- _[coming soon]_ More modules: photo galleries, etc.

[See a live demo →](https://demo.draftist.io/)

## Requirements

- Obsidian v1.11.4 or higher
- A [Draftist](https://draftist.io) account

## Installation

### _[coming soon]_ Community Plugins

The plugin is pending approval in the community plugins directory.

### BRAT (Recommended)

Since the plugin is not yet available in the community plugins directory, you can install it using [BRAT](https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins), a community plugin manager for beta testing:

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community plugins
2. Run command: `BRAT: Plugins: Add a beta plugin for testing`
3. Enter `DraftistHQ/draftist-obsidian-plugin`

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/DraftistHQ/draftist-obsidian-plugin/releases/latest)
2. Create folder: `.obsidian/plugins/draftist/` in your vault
3. Copy the downloaded files into that folder
4. Reload Obsidian and enable the plugin in Settings → Community plugins

## Setup

1. Go to [draftist.io](https://draftist.io) and create an account
2. Get an API token at [draftist.io/manage/account/security/tokens](https://draftist.io/manage/account/security/tokens)
3. In Obsidian, go to Settings → Draftist
4. Enter your API token
5. Select your site and configure the vault path where your site content will live

## Usage

All commands are available via the command palette (`Ctrl/Cmd + P`). Feel free to bind any command to a hotkey in Settings → Hotkeys.

### Publishing

| Command | Description |
|---------|-------------|
| `Draftist: Preview and publish` | Uploads assets, saves the current note as a Draftist draft, and opens a browser preview. Use the toolbar on the preview page to publish when ready. |
| `Draftist: Manage on Draftist` | Opens the current post or page on Draftist so you can publish, unpublish, archive, restore, or delete it. |
| `Draftist: Pull metadata from Draftist` | Refreshes the current note's Draftist status and publication metadata from Draftist. |

### Creating Content

These commands create local notes in designated folders for organization. They don't sync to the server — use "Preview and publish" when you're ready to publish.

| Command | Description |
|---------|-------------|
| `Draftist: Create new blog post idea` | Create a note in your Ideas folder |
| `Draftist: Create new blog post draft` | Create a note in your Drafts folder |

### Images

| Command | Description |
|---------|-------------|
| `Draftist: Insert image` | Insert an image into the note |
| `Draftist: Insert gallery` | Insert a gallery of images into the note |
| `Draftist: Set cover image` | Choose a cover image for the post |
| `Draftist: Normalize images` | Collect all images used in a post into an `./images` folder next to the post and rename them with unique hashes |

### Maintenance

| Command | Description |
|---------|-------------|
| `Draftist: Normalize frontmatter` | Ensure base frontmatter fields (status, description, posted on, etc.) and reorder them consistently |

## Content Organization

When the "Manage site folders" automation is enabled, the plugin automatically organizes your posts based on their `status` frontmatter field. Before a post goes live, you can use `Idea` and `Draft` to organize your writing workflow. After a post goes live, manage its public status on Draftist; the plugin pulls that status back to Obsidian.

```
Site/
└── Blog/
    ├── Ideas/
    │   └── My Post Idea/
    ├── Drafts/
    │   └── Work in Progress/
    ├── Published/
    │   └── 2024-01-15 - My Published Post/
    ├── Unpublished/
    │   └── 2024-01-15 - Needs More Work/
    ├── Archive/
    │   └── 2023-06-01 - Old Post/
    ├── Trash/
    │   └── 2024-01-15 - Deleted Post/
    └── Deleted/
        └── 2024-01-15 - Removed Post/
```

- **Ideas** → early stage notes
- **Drafts** → posts you're actively working on
- **Published** → posts live on your site
- **Unpublished** → posts taken offline because they still need work
- **Archive** → posts taken offline because they are no longer relevant
- **Trash** → posts scheduled for deletion on Draftist
- **Deleted** → notes whose content was permanently deleted from Draftist

`Blog` in the example above is the module name — it must match the module name configured in your Draftist site settings.

Before a post has ever gone live, changing its `status` between `Idea` and `Draft` moves it to the corresponding folder. Once a post has gone live, use Draftist to manage its status. The plugin pulls `Published`, `Unpublished`, `Archived`, and `Deleted` metadata back to the frontmatter and moves the post to the matching folder. If Draftist reports that the post no longer exists, the plugin removes local Draftist metadata and image metadata sidecars, keeps `status: Deleted`, and moves the post to `Deleted/`. Any post with a `posted on` date gets a date prefix (e.g., `2024-01-15 - Post Title`).

### Posts and Assets

Each post lives in its own self-contained folder — the markdown file and all its assets are kept together:

```
My Post/
├── My Post.md
└── images/
    ├── cover-hero.a1b2c3d4.jpg
    ├── cover-hero.a1b2c3d4.jpg.draftist.json
    ├── post-diagram.e5f6g7h8.png
    └── post-diagram.e5f6g7h8.png.draftist.json
```

- Images are stored in an `images/` subfolder next to the post
- Filenames are prefixed with `cover-` (cover images) or `post-` (inline images)
- A unique hash is appended to prevent naming conflicts
- Each image has a `.draftist.json` metadata file that stores upload info

To keep assets organized, always use the dedicated commands (`Insert image`, `Insert gallery`, `Set cover image`) to add images to your posts.

The `.draftist.json` metadata files are hidden by default in Obsidian. You'll only see them if you enable Settings → Files and links → Detect all file extensions. These files are managed by the plugin — do not edit them manually.

When you rename or delete an image, the plugin automatically manages its metadata file as well.

### Block IDs

Block IDs enable deep linking to specific parts of your posts — paragraphs, headings, list items, code blocks, etc. When enabled, the plugin automatically adds Obsidian's standard block references (`^blockid`) to your content during preview/publish:

```markdown
This is a paragraph. ^a1b2c3

- List item one ^d4e5f6
- List item two ^g7h8i9
```

**Why block IDs matter:**

- **Deep linking for readers**: Your blog readers can link directly to specific paragraphs from your website
- _[coming soon]_ **Change tracking**: Block IDs enable diffing between versions, so you can show what changed and publicly link to updates

Due to Obsidian API limitations, block IDs are visible in the editor. You can adjust their opacity (Settings → Draftist → Block IDs → Opacity) to make them less distracting while writing.

## Settings

- **Authentication**: API token for connecting to Draftist
- **Sites**: Map Draftist sites to vault folders
- **Automations**: Toggle automatic file tree management (see above)
- **Block IDs**: Enable/disable block ID generation and adjust editor opacity (see above)
- **Debugging**: Extensive logging and internal metadata visibility

## Support

- [Documentation](https://docs.draftist.io/)
- [Discord](https://discord.gg/nZhbzzbT5A)
- [GitHub Issues](https://github.com/DraftistHQ/draftist-obsidian-plugin/issues)
- [support@draftist.io](mailto:support@draftist.io)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
