# Draft42

Publish your personal content websites directly from [Obsidian](https://obsidian.md).

[Draft42](https://draft42.io) is a publishing platform for personal websites. This plugin lets you write and manage your content in Obsidian, then publish it to your Draft42 sites with a single command.

## Features

- **Preview & publish** — See your post on your site before going live
- **Custom domains** — Your own domain with automatic SSL and redirects
- **Theming** — Fonts, colors, light/dark mode, upload custom fonts
- **SEO-ready** — Server-rendered content, meta/og tags, clean URLs
- **Image optimization** — CDN delivery and state-of-the-art placeholders
- **Deep linking** — Block IDs for linking to any content block
- _[coming soon]_ Multi-site support
- _[coming soon]_ Documentation sites
- _[coming soon]_ More modules: photo galleries, etc.

[See a live demo →](https://demo.draft42.io/)

## Requirements

- Obsidian v1.11.4 or higher
- A [Draft42](https://draft42.io) account

## Installation

### _[coming soon]_ Community Plugins

The plugin is pending approval in the community plugins directory.

### BRAT (Recommended)

Since the plugin is not yet available in the community plugins directory, you can install it using [BRAT](https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins), a community plugin manager for beta testing:

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community plugins
2. Run command: `BRAT: Plugins: Add a beta plugin for testing`
3. Enter `Draft42HQ/draft42-obsidian-plugin`

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/Draft42HQ/draft42-obsidian-plugin/releases/latest)
2. Create folder: `.obsidian/plugins/draft42/` in your vault
3. Copy the downloaded files into that folder
4. Reload Obsidian and enable the plugin in Settings → Community plugins

## Setup

1. Go to [draft42.io](https://draft42.io) and create an account
2. Get an API token at [draft42.io/manage/account/security/tokens](https://draft42.io/manage/account/security/tokens)
3. In Obsidian, go to Settings → Draft42
4. Enter your API token
5. Select your site and configure the vault path where your site content will live

## Usage

All commands are available via the command palette (`Ctrl/Cmd + P`). Feel free to bind any command to a hotkey in Settings → Hotkeys.

### Publishing

| Command | Description |
|---------|-------------|
| `Draft42: Preview and publish` | Opens your post in the browser to preview how it will look on your site. You can preview as many times as you want while working — publish only when ready. |

### Creating Content

These commands create local notes in designated folders for organization. They don't sync to the server — use "Preview and publish" when you're ready to publish.

| Command | Description |
|---------|-------------|
| `Draft42: Create new blog post idea` | Create a note in your Ideas folder |
| `Draft42: Create new blog post draft` | Create a note in your Drafts folder |

### Images

| Command | Description |
|---------|-------------|
| `Draft42: Insert image` | Insert an image into the note |
| `Draft42: Insert gallery` | Insert a gallery of images into the note |
| `Draft42: Set cover image` | Choose a cover image for the post |
| `Draft42: Normalize images` | Collect all images used in a post into an `./images` folder next to the post and rename them with unique hashes |

### Maintenance

| Command | Description |
|---------|-------------|
| `Draft42: Normalize frontmatter` | Ensure base frontmatter fields (status, description, posted on, etc.) and reorder them consistently |

## Content Organization

When the "Manage file trees" automation is enabled, the plugin automatically organizes your posts based on their `status` frontmatter field:

```
Site/
└── Blog/
    ├── Ideas/
    │   └── My Post Idea/
    ├── Drafts/
    │   └── Work in Progress/
    ├── Published/
    │   └── 2024-01-15 - My Published Post/
    └── Archive/
        └── 2023-06-01 - Old Post/
```

- **Ideas** → early stage notes
- **Drafts** → posts you're actively working on
- **Published** → posts live on your site
- **Archive** → posts removed from public view

`Blog` in the example above is the module name — it must match the module name configured in your Draft42 site settings.

When you change a post's `status` in the frontmatter, the plugin automatically moves it to the corresponding folder. Any post with a `posted on` date gets a date prefix (e.g., `2024-01-15 - Post Title`).

### Posts and Assets

Each post lives in its own self-contained folder — the markdown file and all its assets are kept together:

```
My Post/
├── My Post.md
└── images/
    ├── cover-hero.a1b2c3d4.jpg
    ├── cover-hero.a1b2c3d4.jpg.d42.json
    ├── post-diagram.e5f6g7h8.png
    └── post-diagram.e5f6g7h8.png.d42.json
```

- Images are stored in an `images/` subfolder next to the post
- Filenames are prefixed with `cover-` (cover images) or `post-` (inline images)
- A unique hash is appended to prevent naming conflicts
- Each image has a `.d42.json` metadata file that stores upload info

To keep assets organized, always use the dedicated commands (`Insert image`, `Insert gallery`, `Set cover image`) to add images to your posts.

The `.d42.json` metadata files are hidden by default in Obsidian. You'll only see them if you enable Settings → Files and links → Detect all file extensions. These files are managed by the plugin — do not edit them manually.

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

Due to Obsidian API limitations, block IDs are visible in the editor. You can adjust their opacity (Settings → Draft42 → Block IDs → Opacity) to make them less distracting while writing.

## Settings

- **Authentication**: API token for connecting to Draft42
- **Sites**: Map Draft42 sites to vault folders
- **Automations**: Toggle automatic file tree management (see above)
- **Block IDs**: Enable/disable block ID generation and adjust editor opacity (see above)
- **Debugging**: Extensive logging and internal metadata visibility

## Support

- _[coming soon]_ [Documentation](https://docs.draft42.io/)
- [Discord](https://discord.gg/nZhbzzbT5A)
- [GitHub Issues](https://github.com/Draft42HQ/draft42-obsidian-plugin/issues)
- [support@draft42.io](mailto:support@draft42.io)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
