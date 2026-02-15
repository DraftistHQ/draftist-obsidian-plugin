import * as Obsidian from "obsidian"
import * as React from "react"
import * as ReactDOM from "react-dom/client"

import type Plugin from "src/main"
import * as Api from "src/clients/api"
import * as Config from "src/config"
import * as Image from "src/models/image"
import * as Site from "src/models/site"
import * as PublishPostRequest from "src/clients/requests/publish-post"
import * as PublishDocRequest from "src/clients/requests/publish-doc"
import { OK, ERROR } from "src/utils/result"
import * as Timer from "src/utils/timer"
import * as log from "src/logger"
import * as Notice from "src/notice"

import * as PostPublishing from "./publish-post"
import * as DocPublishing from "./publish-doc"

export class PublishingModal extends Obsidian.Modal {
    private file: Obsidian.TFile
    private plugin: Plugin

    private root: ReactDOM.Root | null = null

    constructor(plugin: Plugin, file: Obsidian.TFile) {
        super(plugin.app)

        this.file = file
        this.plugin = plugin
    }

    async onOpen() {
        this.root = ReactDOM.createRoot(this.containerEl.children[1])
        this.root.render(
            <React.StrictMode>
                <PublishingModalComponent app={this.app} plugin={this.plugin} file={this.file} modal={this} />
            </React.StrictMode>,
        )
    }

    async onClose() {
        // let React finish rendering
        Timer.onNextTick(() => {
            this.root?.unmount()
            this.plugin.publishingModals.dispose(this.file)
        })
    }
}

// --- Types

type Props = {
    app: Obsidian.App
    plugin: Plugin
    file: Obsidian.TFile
    modal: PublishingModal
}

type PrePublishingOptions = { skipChangesCheck: boolean }

type PreparedEntry =
    | { kind: "blog"; data: PostPublishing.PrePublishingData }
    | { kind: "docs"; data: DocPublishing.PrePublishingData }

type PublishedEntry =
    | { kind: "blog"; post: PublishPostRequest.PublishedPost }
    | { kind: "docs"; page: PublishDocRequest.PublishedDocPage; hasContent: boolean }

export type PublishingError =
    | PostPublishing.PrePublishingError
    | DocPublishing.PrePublishingError
    | Api.ResponseError<PublishPostRequest.Error>
    | Api.ResponseError<PublishDocRequest.Error>
    | { _: "UNEXPECTED_ERROR" }

type Progress =
    | { phase: "validating" }
    | { phase: "uploading"; uploaded: number; total: number }
    | { phase: "publishing" }

// --- State Machine

export type State =
    | { status: "READY" }
    | {
          status: "PREPARING"
          site: Config.SiteSettings
          module: Site.SiteModule
          options: PrePublishingOptions
      }
    | {
          status: "PUBLISHING"
          site: Config.SiteSettings
          module: Site.SiteModule
          entry: PreparedEntry
      }
    | {
          status: "SUCCESS"
          site: Config.SiteSettings
          module: Site.SiteModule
          published: PublishedEntry
      }
    | {
          status: "PUBLISHING_FAILURE"
          site: Config.SiteSettings
          module: Site.SiteModule
          error: PublishingError
      }
    | {
          status: "INITIALIZATION_FAILURE"
          error: Site.GetSiteForFileError
      }

type Action =
    | {
          type: "START_PREPARING"
          payload: { site: Config.SiteSettings; module: Site.SiteModule; options: PrePublishingOptions }
      }
    | {
          type: "START_PUBLISHING"
          payload: { site: Config.SiteSettings; module: Site.SiteModule; entry: PreparedEntry }
      }
    | {
          type: "SUCCEED_PUBLISHING"
          payload: { site: Config.SiteSettings; module: Site.SiteModule; published: PublishedEntry }
      }
    | {
          type: "FAIL_PUBLISHING"
          payload: { site: Config.SiteSettings; module: Site.SiteModule; error: PublishingError }
      }
    | { type: "FAIL_INITIALIZATION"; payload: { error: Site.GetSiteForFileError } }

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case "START_PREPARING":
            return { status: "PREPARING", ...action.payload }
        case "START_PUBLISHING":
            return { status: "PUBLISHING", ...action.payload }
        case "SUCCEED_PUBLISHING":
            return { status: "SUCCESS", ...action.payload }
        case "FAIL_PUBLISHING":
            return { status: "PUBLISHING_FAILURE", ...action.payload }
        case "FAIL_INITIALIZATION":
            return { status: "INITIALIZATION_FAILURE", ...action.payload }
        default: {
            action satisfies never
            return state
        }
    }
}

const initialState: State = { status: "READY" }

// --- Helpers

function openPreviewOrShowNoticeWithLink(url: string, text: string) {
    if (Obsidian.Platform.isMobile) {
        Notice.info(
            createFragment(fragment => {
                fragment.createEl("a", { href: url, text })
            }),
            { permanent: true },
        )
    } else {
        window.open(url)
    }
}

// --- Modal

const PublishingModalComponent = ({ app, plugin, file, modal }: Props) => {
    const [state, dispatch] = React.useReducer(reducer, initialState)
    const [progress, setProgress] = React.useState<Progress | null>(null)
    const guardRef = React.useRef<"preparing" | "publishing" | null>(null)

    React.useEffect(() => {
        switch (state.status) {
            case "READY": {
                const result = Site.getSiteAndModuleForFile(file)
                switch (result._) {
                    case OK: {
                        let { site, module } = result.data
                        dispatch({
                            type: "START_PREPARING",
                            payload: { site, module, options: { skipChangesCheck: false } },
                        })
                        return
                    }
                    case ERROR: {
                        dispatch({ type: "FAIL_INITIALIZATION", payload: { error: result.error } })
                        return
                    }
                }
            }

            case "PREPARING": {
                if (guardRef.current === "preparing") break
                guardRef.current = "preparing"

                setProgress({ phase: "validating" })

                const onAssetProcessed = (uploaded: number, total: number) => {
                    setProgress({ phase: "uploading", uploaded, total })
                }

                const prepareAndDispatch = async () => {
                    let entry: PreparedEntry

                    switch (state.module.kind) {
                        case "blog": {
                            let result = await PostPublishing.prepareForPublishing(
                                file,
                                app,
                                state.options,
                                onAssetProcessed,
                            )
                            switch (result._) {
                                case OK:
                                    entry = { kind: "blog", data: result.data }
                                    break
                                case ERROR:
                                    log.error("Pre-publishing failed", result.error)
                                    guardRef.current = null
                                    dispatch({
                                        type: "FAIL_PUBLISHING",
                                        payload: { site: state.site, module: state.module, error: result.error },
                                    })
                                    return
                                default:
                                    result satisfies never
                                    return
                            }
                            break
                        }
                        case "docs": {
                            let result = await DocPublishing.prepareForPublishing(
                                file,
                                app,
                                state.options,
                                onAssetProcessed,
                            )
                            switch (result._) {
                                case OK:
                                    entry = { kind: "docs", data: result.data }
                                    break
                                case ERROR:
                                    log.error("Pre-publishing failed", result.error)
                                    guardRef.current = null
                                    dispatch({
                                        type: "FAIL_PUBLISHING",
                                        payload: { site: state.site, module: state.module, error: result.error },
                                    })
                                    return
                                default:
                                    result satisfies never
                                    return
                            }
                            break
                        }
                        default: {
                            state.module.kind satisfies never
                            return
                        }
                    }

                    setProgress({ phase: "publishing" })
                    dispatch({ type: "START_PUBLISHING", payload: { site: state.site, module: state.module, entry } })
                }

                prepareAndDispatch().catch(error => {
                    log.error("Unexpected error during preparation", error)
                    guardRef.current = null
                    dispatch({
                        type: "FAIL_PUBLISHING",
                        payload: { site: state.site, module: state.module, error: { _: "UNEXPECTED_ERROR" } },
                    })
                })
                break
            }

            case "PUBLISHING": {
                if (guardRef.current === "publishing") break
                guardRef.current = "publishing"

                const publishAndDispatch = async () => {
                    switch (state.entry.kind) {
                        case "blog": {
                            let result = await PostPublishing.publish(
                                state.site.config.id,
                                state.entry.data.post,
                                file,
                                app,
                            )
                            switch (result._) {
                                case OK:
                                    dispatch({
                                        type: "SUCCEED_PUBLISHING",
                                        payload: {
                                            site: state.site,
                                            module: state.module,
                                            published: { kind: "blog", post: result.data },
                                        },
                                    })
                                    break
                                case ERROR:
                                    dispatch({
                                        type: "FAIL_PUBLISHING",
                                        payload: { site: state.site, module: state.module, error: result.error },
                                    })
                                    break
                                default:
                                    result satisfies never
                            }
                            break
                        }
                        case "docs": {
                            let result = await DocPublishing.publish(
                                state.site.config.id,
                                state.entry.data.page,
                                file,
                                app,
                            )
                            switch (result._) {
                                case OK:
                                    dispatch({
                                        type: "SUCCEED_PUBLISHING",
                                        payload: {
                                            site: state.site,
                                            module: state.module,
                                            published: {
                                                kind: "docs",
                                                page: result.data,
                                                hasContent: state.entry.data.page.pageData.content.trim().length > 0,
                                            },
                                        },
                                    })
                                    break
                                case ERROR:
                                    dispatch({
                                        type: "FAIL_PUBLISHING",
                                        payload: { site: state.site, module: state.module, error: result.error },
                                    })
                                    break
                                default:
                                    result satisfies never
                            }
                            break
                        }
                        default:
                            state.entry satisfies never
                    }
                }

                publishAndDispatch().catch(error => {
                    log.error("Unexpected error during publishing", error)
                    guardRef.current = null
                    dispatch({
                        type: "FAIL_PUBLISHING",
                        payload: { site: state.site, module: state.module, error: { _: "UNEXPECTED_ERROR" } },
                    })
                })
                break
            }

            case "SUCCESS": {
                switch (state.published.kind) {
                    case "blog": {
                        let url = `https://${state.site.config.addresses.draft}/${state.module.slug}/${state.published.post.slug}`
                        openPreviewOrShowNoticeWithLink(url, "Preview and publish blog post ↗")
                        plugin.pendingSyncsManager.registerPendingSync(file)
                        modal.close()
                        break
                    }
                    case "docs": {
                        if (state.published.hasContent) {
                            let url = `https://${state.site.config.addresses.draft}/${state.module.slug}/${state.published.page.slug}`
                            openPreviewOrShowNoticeWithLink(url, "Preview and publish doc page ↗")
                            plugin.pendingSyncsManager.registerPendingSync(file)
                            modal.close()
                        }
                        break
                    }
                    default:
                        state.published satisfies never
                }
                return
            }

            case "PUBLISHING_FAILURE":
            case "INITIALIZATION_FAILURE":
                return

            default:
                state satisfies never
        }
    })

    return (
        <div className="d42-modal-container">
            {(() => {
                switch (state.status) {
                    case "READY":
                        return null

                    case "PREPARING":
                    case "PUBLISHING": {
                        return (
                            <div className="d42-modal-processing-container">
                                <div style={{ height: "32px" }} />
                                <ProgressBar progress={progress} />
                            </div>
                        )
                    }

                    case "SUCCESS": {
                        switch (state.published.kind) {
                            case "blog":
                                return null
                            case "docs": {
                                if (!state.published.hasContent) {
                                    return (
                                        <div className="d42-alert-container d42-alert-container-info">
                                            <h1>Publishing Doc Page</h1>
                                            <div className="d42-alert-message d42-alert-message-info">
                                                Doc group updated successfully.
                                            </div>
                                            <div className="d42-alert-buttons">
                                                <button
                                                    className="d42-button d42-button-secondary"
                                                    onClick={_ => modal.close()}
                                                >
                                                    Close
                                                </button>
                                            </div>
                                        </div>
                                    )
                                }
                                return null
                            }
                            default:
                                state.published satisfies never
                                return null
                        }
                    }

                    case "PUBLISHING_FAILURE": {
                        let contentLabel: string
                        switch (state.module.kind) {
                            case "blog":
                                contentLabel = "Blog Post"
                                break
                            case "docs":
                                contentLabel = "Doc Page"
                                break
                            default:
                                state.module.kind satisfies never
                                throw new Error("unreachable")
                        }
                        let kind!: "info" | "warning" | "danger"
                        let messages: string[] = []
                        let retryWithoutCheck = false

                        let failure = state.error

                        switch (failure._) {
                            case "NO_CHANGES_SINCE_LAST_PUBLISH": {
                                kind = "info"
                                messages.push("It doesn't seem like you have made any changes since your last publish.")
                                retryWithoutCheck = true
                                break
                            }
                            case "FAILED_TO_GET_SITE_AND_MODULE": {
                                kind = "danger"
                                switch (failure.error._) {
                                    case "ENABLED_SITE_MISSING_PATH": {
                                        messages.push(
                                            "There's a configuraiton issue. Some of the sites are missing path. Please, make sure your sites are properly configured and try again.",
                                        )
                                        break
                                    }
                                    case "OVERLAPPING_PATHS": {
                                        messages.push(
                                            `There's a configuraiton issue. Some of the sites have overlapping paths: ${failure.error.site1.label} (${failure.error.site1.path}) & ${failure.error.site2.label} (${failure.error.site2.path}). Please, make sure your sites are properly configured and try again.`,
                                        )
                                        break
                                    }
                                    case "SITE_NOT_FOUND": {
                                        messages.push(
                                            "Unable to locate site configuration for this file. Please ensure that the file is placed in the correct directory and the directory structure follows the required hierarchy.",
                                        )
                                        break
                                    }
                                    case "SITE_DISABLED": {
                                        messages.push(
                                            "Site is disabled. Please enable the site in the settings and try again.",
                                        )
                                        break
                                    }
                                    case "MODULE_NOT_FOUND": {
                                        messages.push(
                                            "Site module is not found. Please ensure that the file is placed in the correct directory within your site folder and the directory structure follows the required hierarchy.",
                                        )
                                        break
                                    }
                                    default:
                                        failure.error satisfies never
                                }
                                break
                            }
                            case "INVALID_SETTINGS": {
                                kind = "danger"
                                failure.errors.forEach(error => {
                                    switch (error._) {
                                        case "MISSING_TOKEN": {
                                            messages.push(
                                                "You didn't set API token. Set it in the Settings and try again.",
                                            )
                                            break
                                        }
                                        case "MISSING_SITE": {
                                            messages.push(
                                                "You don't have required site in your site list. Maybe you have created a new site on `draft42.io`, but didn't update the site list in the Obsidian plugin settings? Refresh your site list in the Settings and try again.",
                                            )
                                            break
                                        }
                                        case "NO_SITES": {
                                            messages.push(
                                                "You don't have any sites configured. Fetch a site list in the Settings and try again.",
                                            )
                                            break
                                        }
                                        case "NO_SITE_MODULES": {
                                            messages.push(
                                                "Your site doesn't have any modules. You need to add required modules in your site configuration on `draft42.io` and update your sites in the Obsidian plugin settings.",
                                            )
                                            break
                                        }
                                        case "MISSING_SITE_PATH": {
                                            messages.push(
                                                "You didn't set a site path. Set it in the Settings and try again.",
                                            )
                                            break
                                        }
                                        default:
                                            error satisfies never
                                    }
                                })
                                break
                            }
                            case "MISSING_FRONTMATTER": {
                                kind = "danger"
                                messages.push(
                                    "The file you are trying to publish doesn't have a frontmatter. Add it and try again.",
                                )
                                break
                            }
                            case "INVALID_POST_FRONTMATTER": {
                                kind = "danger"
                                failure.errors.forEach(error => {
                                    switch (error._) {
                                        case "INVALID_POSTED_ON":
                                            messages.push("`Posted On` field is not a valid date.")
                                            break
                                        case "MISSING_COVER_LINK":
                                            messages.push(
                                                "`Cover` is not a valid link. Provide either a link to a local image or an absolute url to an external image and try again.",
                                            )
                                            break
                                        default:
                                            error satisfies never
                                    }
                                })
                                break
                            }
                            case "INVALID_DOC_FRONTMATTER": {
                                kind = "danger"
                                failure.errors.forEach(error => {
                                    switch (error._) {
                                        case "INVALID_POSTED_ON":
                                            messages.push("`Posted On` field is not a valid date.")
                                            break
                                        // TS doesn't narrow single-member types in switch defaults
                                        // default:
                                        //     error satisfies never
                                    }
                                })
                                break
                            }
                            case "LINKED_RESOURCE_NOT_FOUND": {
                                kind = "danger"
                                messages.push(`Unable to locate linked resource: ${failure.link.link}.`)
                                break
                            }
                            case "LINKED_RESOURCE_IS_DIRECTORY": {
                                kind = "danger"
                                messages.push(`Linked resource is a directory: ${failure.link.link}.`)
                                break
                            }
                            case "LOCAL_LINK_DOESNT_HAVE_BLOCK_ID": {
                                kind = "danger"
                                messages.push(
                                    `This entry contains a link to itself. Link text: ${failure.link.displayText || failure.link.original}`,
                                )
                                break
                            }
                            case "LINKED_RESOURCE_DOESNT_HAVE_METADATA":
                            case "LINKED_RESOURCE_IS_NOT_PUBLISHED": {
                                kind = "danger"
                                messages.push(
                                    `Linked resource is not yet published: ${failure.link.link}. Publish it first and then add a link to it.`,
                                )
                                break
                            }
                            case "IMAGES_VALIDATION_FAILED": {
                                kind = "danger"
                                messages.push("Some images failed validation.")
                                failure.errors.forEach(error => {
                                    switch (error._) {
                                        case "UNSUPPORTED_FORMAT": {
                                            messages.push(
                                                `${error.asset.name}: Unsupported image format. Supported formats: ${Image.ALLOWED_FORMATS.join(", ")}.`,
                                            )
                                            break
                                        }
                                        case "IMAGE_TOO_BIG": {
                                            let mb = Image.MAX_SIZE / (1024 * 1024)
                                            let maxSize = `${Math.round(mb * 100) / 100}Mb`
                                            messages.push(
                                                `${error.asset.name}: Image is too big. Max file size is ${maxSize}.`,
                                            )
                                            break
                                        }
                                        default:
                                            error satisfies never
                                    }
                                })
                                break
                            }
                            case "IMAGES_UPLOADING_FAILED": {
                                kind = "danger"
                                failure.errors.forEach(error => {
                                    switch (error._) {
                                        case "FAILED_TO_UPLOAD_IMAGE": {
                                            switch (error.error._) {
                                                case "FAILED_TO_READ_IMAGE": {
                                                    messages.push(
                                                        "We weren't able to read image. Reach out to support.",
                                                    )
                                                    messages.push(`Error: ${error.error.error}`)
                                                    break
                                                }
                                                case "FAILED_TO_UPLOAD_IMAGE": {
                                                    messages.push("We weren't able to upload image.")
                                                    switch (error.error.error._) {
                                                        case "MISSING_API_TOKEN": {
                                                            messages.push(
                                                                "You didn't set API token. Set it in the Settings and try again.",
                                                            )
                                                            break
                                                        }
                                                        case "API_AUTH_ERROR": {
                                                            messages.push(
                                                                "Looks like your API token is expired or has been revoked. Update it in the Settings and try again.",
                                                            )
                                                            break
                                                        }
                                                        case "API_SERVER_ERROR":
                                                        case "API_UNEXPECTED_ERROR": {
                                                            messages.push(
                                                                "We weren't able to reach image uploader server. Reach out to support.",
                                                            )
                                                            break
                                                        }
                                                        case "API_USER_ERROR": {
                                                            let reason = error.error.error.error
                                                            if (!!reason) messages.push(reason)
                                                            break
                                                        }
                                                        case "MAINTENANCE": {
                                                            messages.push(
                                                                `Service is under maintenance. Please try again later.`,
                                                            )
                                                            break
                                                        }
                                                        default:
                                                            error.error.error satisfies never
                                                    }
                                                    break
                                                }
                                                default:
                                                    error.error satisfies never
                                            }
                                            break
                                        }
                                        case "FAILED_TO_WRITE_UPLOADED_IMAGE_METADATA": {
                                            messages.push(
                                                "We weren't able to write image metadata. Reach out to support.",
                                            )
                                            break
                                        }
                                        default:
                                            error satisfies never
                                    }
                                })
                                break
                            }
                            case "INVALID_EXTERNAL_COVER_IMAGE_URL": {
                                kind = "danger"
                                messages.push(
                                    `Cover is not a valid link. Provide either a link to a local image or an absolute url to an external image and try again.`,
                                )
                                break
                            }
                            case "INVALID_EXTERNAL_COVER_CREDIT_LINK": {
                                kind = "danger"
                                messages.push(
                                    `Cover image credit link is not valid. It should be an absolute URL. Please, fix it and try again.`,
                                )
                                break
                            }
                            case "MISSING_POSITION": {
                                kind = "danger"
                                messages.push(
                                    "Unable to determine page position. The module hierarchy is in invalid state.",
                                )
                                break
                            }
                            case "PARENT_FOLDER_NOT_FOUND":
                            case "PARENT_NOTE_NOT_FOUND": {
                                kind = "danger"
                                messages.push(`Parent folder not found: ${failure.folderPath}`)
                                break
                            }
                            case "PARENT_NOT_PUBLISHED": {
                                kind = "danger"
                                messages.push(`Parent page must be published first: ${failure.folderPath}`)
                                break
                            }
                            case "MISSING_API_TOKEN": {
                                kind = "danger"
                                messages.push("You didn't set API token. Set it in the Settings and try again.")
                                break
                            }
                            case "API_AUTH_ERROR": {
                                kind = "danger"
                                messages.push(
                                    "Looks like your API token is expired or has been revoked. Update it in the Settings and try again.",
                                )
                                break
                            }
                            case "CLIENT_OUTDATED": {
                                kind = "danger"
                                messages.push("Please update Draft42 plugin to the latest version.")
                                break
                            }
                            case "API_USER_ERROR": {
                                kind = "danger"
                                messages.push("Server responded with an error:")
                                messages.push(JSON.stringify(failure.error, null, 4))
                                break
                            }
                            case "MAINTENANCE": {
                                kind = "warning"
                                messages.push(`Service is under maintenance. Please try again later.`)
                                break
                            }
                            case "FAILED_TO_READ_ASSETS_METADATA":
                            case "API_SERVER_ERROR":
                            case "API_UNEXPECTED_ERROR":
                            case "INTERNAL_ERROR":
                            case "UNEXPECTED_ERROR": {
                                kind = "danger"
                                messages.push("Something unexpected happened. Reach out to support.")
                                break
                            }
                            default:
                                failure satisfies never
                        }

                        return (
                            <div className={`d42-alert-container d42-alert-container-${kind}`}>
                                <h1>Publishing {contentLabel}</h1>
                                {messages.map((message, idx) => (
                                    <div key={idx} className={`d42-alert-message d42-alert-message-${kind}`}>
                                        {message}
                                    </div>
                                ))}
                                <div className="d42-alert-buttons">
                                    <button className="d42-button d42-button-secondary" onClick={_ => modal.close()}>
                                        Close
                                    </button>
                                    {retryWithoutCheck && (
                                        <button
                                            className="d42-button d42-button-primary"
                                            onClick={_ => {
                                                guardRef.current = null
                                                dispatch({
                                                    type: "START_PREPARING",
                                                    payload: {
                                                        site: state.site,
                                                        module: state.module,
                                                        options: { skipChangesCheck: true },
                                                    },
                                                })
                                            }}
                                        >
                                            Publish Anyway
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    }

                    case "INITIALIZATION_FAILURE": {
                        let message

                        switch (state.error._) {
                            case "ENABLED_SITE_MISSING_PATH": {
                                message =
                                    "There's a configuration issue. Some of the sites are missing path. Please, make sure your sites are properly configured and try again."
                                break
                            }
                            case "OVERLAPPING_PATHS": {
                                message = `There's a configuration issue. Some of the sites have overlapping paths: ${state.error.site1.label} (${state.error.site1.path}) & ${state.error.site2.label} (${state.error.site2.path}). Please, make sure your sites are properly configured and try again.`
                                break
                            }
                            case "SITE_NOT_FOUND":
                            case "MODULE_NOT_FOUND": {
                                message = "Failed to find a target site. Make sure your configuration is correct."
                                break
                            }
                            case "SITE_DISABLED": {
                                message = `Site ${state.error.site} is disabled. Please enable the site in the settings and try again.`
                                break
                            }
                            default:
                                state.error satisfies never
                        }

                        return (
                            <div className={`d42-alert-container d42-alert-container-danger`}>
                                <h1>Publishing Error</h1>
                                <div className={`d42-alert-message d42-alert-message-danger`}>{message}</div>
                                <div className="d42-alert-buttons">
                                    <button className="d42-button d42-button-secondary" onClick={_ => modal.close()}>
                                        Close
                                    </button>
                                </div>
                            </div>
                        )
                    }

                    default: {
                        state satisfies never
                        return null
                    }
                }
            })()}
        </div>
    )
}

// --- Progress Bar

function ProgressBar({ progress }: { progress: Progress | null }) {
    if (!progress) return null

    let label: string
    let fillClass = "d42-progress-bar-fill"
    let fillStyle: React.CSSProperties

    switch (progress.phase) {
        case "validating":
            label = "Validating..."
            fillClass += " d42-progress-bar-fill-indeterminate"
            fillStyle = {}
            break
        case "uploading":
            label = `Uploading assets (${progress.uploaded}/${progress.total})...`
            fillStyle = { width: progress.total > 0 ? `${(progress.uploaded / progress.total) * 100}%` : "0%" }
            break
        case "publishing":
            label = "Publishing..."
            fillClass += " d42-progress-bar-fill-indeterminate"
            fillStyle = {}
            break
        default:
            progress satisfies never
            label = ""
            fillStyle = {}
    }

    return (
        <div className="d42-progress-bar">
            <div className="d42-progress-bar-track">
                <div className={fillClass} style={fillStyle} />
            </div>
            <p className="d42-progress-bar-label">{label}</p>
        </div>
    )
}
