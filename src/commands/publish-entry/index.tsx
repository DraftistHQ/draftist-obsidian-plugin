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

type Props = {
    app: Obsidian.App
    plugin: Plugin
    file: Obsidian.TFile
    modal: PublishingModal
}

export type State =
    | {
          status: "READY"
      }
    | {
          status: "PREPARING_BLOG_POST_PUBLISHING"
          site: Config.SiteSettings
          module: Site.SiteModule
          options: PostPublishing.PrePublishingOptions
      }
    | {
          status: "PUBLISHING_BLOG_POST"
          site: Config.SiteSettings
          module: Site.SiteModule
          data: PostPublishing.PrePublishingData
      }
    | {
          status: "BLOG_POST_PUBLISHING_SUCCESS"
          site: Config.SiteSettings
          module: Site.SiteModule
          post: PublishPostRequest.PublishedPost
      }
    | {
          status: "BLOG_POST_PUBLISHING_FAILURE"
          site: Config.SiteSettings
          module: Site.SiteModule
          error: BlogPostPublishingError
      }
    | {
          status: "PREPARING_DOC_PAGE_PUBLISHING"
          site: Config.SiteSettings
          module: Site.SiteModule
          options: DocPublishing.PrePublishingOptions
      }
    | {
          status: "PUBLISHING_DOC_PAGE"
          site: Config.SiteSettings
          module: Site.SiteModule
          data: DocPublishing.PrePublishingData
      }
    | {
          status: "DOC_PAGE_PUBLISHING_SUCCESS"
          site: Config.SiteSettings
          module: Site.SiteModule
          page: PublishDocRequest.PublishedDocPage
          hasContent: boolean
      }
    | {
          status: "DOC_PAGE_PUBLISHING_FAILURE"
          site: Config.SiteSettings
          module: Site.SiteModule
          error: DocPagePublishingError
      }
    | {
          status: "PUBLISHING_FAILURE"
          error: Site.GetSiteForFileError
      }

type Action =
    | {
          type: "START_PREPARING_BLOG_POST_PUBLISHING"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              options: PostPublishing.PrePublishingOptions
          }
      }
    | {
          type: "START_PUBLISHING_BLOG_POST"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              data: PostPublishing.PrePublishingData
          }
      }
    | {
          type: "SUCCEED_PUBLISHING_BLOG_POST"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              post: PublishPostRequest.PublishedPost
          }
      }
    | {
          type: "FAIL_PUBLISHING_BLOG_POST"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              error: BlogPostPublishingError
          }
      }
    | {
          type: "START_PREPARING_DOC_PAGE_PUBLISHING"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              options: DocPublishing.PrePublishingOptions
          }
      }
    | {
          type: "START_PUBLISHING_DOC_PAGE"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              data: DocPublishing.PrePublishingData
          }
      }
    | {
          type: "SUCCEED_PUBLISHING_DOC_PAGE"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              page: PublishDocRequest.PublishedDocPage
              hasContent: boolean
          }
      }
    | {
          type: "FAIL_PUBLISHING_DOC_PAGE"
          payload: {
              site: Config.SiteSettings
              module: Site.SiteModule
              error: DocPagePublishingError
          }
      }
    | {
          type: "FAIL_PUBLISHING"
          payload: {
              error: Site.GetSiteForFileError
          }
      }

export type UnexpectedError = { _: "UNEXPECTED_ERROR" }

export type BlogPostPublishingError =
    | PostPublishing.PrePublishingError
    | Api.ResponseError<PublishPostRequest.Error>
    | UnexpectedError

export type DocPagePublishingError =
    | DocPublishing.PrePublishingError
    | Api.ResponseError<PublishDocRequest.Error>
    | UnexpectedError

export type PublishingError = BlogPostPublishingError | DocPagePublishingError

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case "START_PREPARING_BLOG_POST_PUBLISHING": {
            return { status: "PREPARING_BLOG_POST_PUBLISHING", ...action.payload }
        }
        case "START_PUBLISHING_BLOG_POST": {
            return { status: "PUBLISHING_BLOG_POST", ...action.payload }
        }
        case "SUCCEED_PUBLISHING_BLOG_POST": {
            return { status: "BLOG_POST_PUBLISHING_SUCCESS", ...action.payload }
        }
        case "FAIL_PUBLISHING_BLOG_POST": {
            return { status: "BLOG_POST_PUBLISHING_FAILURE", ...action.payload }
        }
        case "START_PREPARING_DOC_PAGE_PUBLISHING": {
            return { status: "PREPARING_DOC_PAGE_PUBLISHING", ...action.payload }
        }
        case "START_PUBLISHING_DOC_PAGE": {
            return { status: "PUBLISHING_DOC_PAGE", ...action.payload }
        }
        case "SUCCEED_PUBLISHING_DOC_PAGE": {
            return { status: "DOC_PAGE_PUBLISHING_SUCCESS", ...action.payload }
        }
        case "FAIL_PUBLISHING_DOC_PAGE": {
            return { status: "DOC_PAGE_PUBLISHING_FAILURE", ...action.payload }
        }
        case "FAIL_PUBLISHING": {
            return { status: "PUBLISHING_FAILURE", ...action.payload }
        }
        default: {
            action satisfies never
            return state
        }
    }
}

const initialState: State = { status: "READY" }

// TODO: Show progress bar during assets uploading
// TODO: There's a massive duplication in this component. Abstract it during the progress bar implementation.
const PublishingModalComponent = ({ app, plugin, file, modal }: Props) => {
    const [state, dispatch] = React.useReducer(reducer, initialState)

    React.useEffect(() => {
        switch (state.status) {
            case "READY": {
                const result = Site.getSiteAndModuleForFile(file)
                switch (result._) {
                    case OK: {
                        let { site, module } = result.data

                        switch (module.kind) {
                            case "blog": {
                                return dispatch({
                                    type: "START_PREPARING_BLOG_POST_PUBLISHING",
                                    payload: {
                                        site,
                                        module,
                                        options: { skipChangesCheck: false },
                                    },
                                })
                            }
                            case "docs": {
                                return dispatch({
                                    type: "START_PREPARING_DOC_PAGE_PUBLISHING",
                                    payload: {
                                        site,
                                        module,
                                        options: { skipChangesCheck: false },
                                    },
                                })
                            }
                            default: {
                                module.kind satisfies never
                                return
                            }
                        }
                    }
                    case ERROR: {
                        dispatch({
                            type: "FAIL_PUBLISHING",
                            payload: { error: result.error },
                        })
                        return
                    }
                }
            }

            case "PREPARING_BLOG_POST_PUBLISHING": {
                PostPublishing.prepareForPublishing(file, app, state.options)
                    .then(result => {
                        switch (result._) {
                            case OK:
                                return dispatch({
                                    type: "START_PUBLISHING_BLOG_POST",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        data: result.data,
                                    },
                                })
                            case ERROR:
                                return dispatch({
                                    type: "FAIL_PUBLISHING_BLOG_POST",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        error: result.error,
                                    },
                                })
                            default:
                                result satisfies never
                        }
                    })
                    .catch(error => {
                        log.error("Unexpected error during data preparation for publishing", error)
                        dispatch({
                            type: "FAIL_PUBLISHING_BLOG_POST",
                            payload: {
                                site: state.site,
                                module: state.module,
                                error: { _: "UNEXPECTED_ERROR" },
                            },
                        })
                    })
                break
            }

            case "PUBLISHING_BLOG_POST": {
                PostPublishing.publish(state.data.site.config.id, state.data.post, file, app)
                    .then(result => {
                        switch (result._) {
                            case OK:
                                return dispatch({
                                    type: "SUCCEED_PUBLISHING_BLOG_POST",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        post: result.data,
                                    },
                                })
                            case ERROR:
                                return dispatch({
                                    type: "FAIL_PUBLISHING_BLOG_POST",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        error: result.error,
                                    },
                                })
                            default:
                                result satisfies never
                        }
                    })
                    .catch(error => {
                        log.error("Unexpected error during publishing", error)
                        dispatch({
                            type: "FAIL_PUBLISHING_BLOG_POST",
                            payload: {
                                site: state.site,
                                module: state.module,
                                error: { _: "UNEXPECTED_ERROR" },
                            },
                        })
                    })
                break
            }

            case "BLOG_POST_PUBLISHING_SUCCESS": {
                let url = `https://${state.site.config.addresses.draft}/${state.module.slug}/${state.post.slug}`
                if (Obsidian.Platform.isMobile) {
                    // Browser window won't open on mobile
                    Notice.info(
                        createFragment(fragment => {
                            fragment.createEl("a", { href: url, text: "Preview and publish post ↗" })
                        }),
                        { permanent: true },
                    )
                } else {
                    window.open(url)
                }
                plugin.pendingSyncsManager.registerPendingSync(file) // Register pending sync so status can be synced when user returns to the file
                modal.close()
                return
            }

            case "BLOG_POST_PUBLISHING_FAILURE":
                return

            case "PREPARING_DOC_PAGE_PUBLISHING": {
                DocPublishing.prepareForPublishing(file, app, state.options)
                    .then(result => {
                        switch (result._) {
                            case OK:
                                return dispatch({
                                    type: "START_PUBLISHING_DOC_PAGE",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        data: result.data,
                                    },
                                })
                            case ERROR:
                                return dispatch({
                                    type: "FAIL_PUBLISHING_DOC_PAGE",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        error: result.error,
                                    },
                                })
                            default:
                                result satisfies never
                        }
                    })
                    .catch(error => {
                        log.error("Unexpected error during data preparation for doc page publishing", error)
                        dispatch({
                            type: "FAIL_PUBLISHING_DOC_PAGE",
                            payload: {
                                site: state.site,
                                module: state.module,
                                error: { _: "UNEXPECTED_ERROR" },
                            },
                        })
                    })
                break
            }

            case "PUBLISHING_DOC_PAGE": {
                DocPublishing.publish(state.data.site.config.id, state.data.page, file, app)
                    .then(result => {
                        switch (result._) {
                            case OK:
                                return dispatch({
                                    type: "SUCCEED_PUBLISHING_DOC_PAGE",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        page: result.data,
                                        hasContent: state.data.page.pageData.content.trim().length > 0,
                                    },
                                })
                            case ERROR:
                                return dispatch({
                                    type: "FAIL_PUBLISHING_DOC_PAGE",
                                    payload: {
                                        site: state.site,
                                        module: state.module,
                                        error: result.error,
                                    },
                                })
                            default:
                                result satisfies never
                        }
                    })
                    .catch(error => {
                        log.error("Unexpected error during doc page publishing", error)
                        dispatch({
                            type: "FAIL_PUBLISHING_DOC_PAGE",
                            payload: {
                                site: state.site,
                                module: state.module,
                                error: { _: "UNEXPECTED_ERROR" },
                            },
                        })
                    })
                break
            }

            case "DOC_PAGE_PUBLISHING_SUCCESS": {
                if (state.hasContent) {
                    let url = `https://${state.site.config.addresses.draft}/${state.module.slug}/${state.page.slug}`
                    if (Obsidian.Platform.isMobile) {
                        Notice.info(
                            createFragment(fragment => {
                                fragment.createEl("a", { href: url, text: "Preview and publish doc page ↗" })
                            }),
                            { permanent: true },
                        )
                    } else {
                        window.open(url)
                    }
                    plugin.pendingSyncsManager.registerPendingSync(file)
                    modal.close()
                }
                return
            }

            case "DOC_PAGE_PUBLISHING_FAILURE":
            case "PUBLISHING_FAILURE":
                return

            default:
                state satisfies never
        }
    })

    return (
        <div className="d42-modal-container">
            {(() => {
                switch (state.status) {
                    case "READY": {
                        return null
                    }
                    case "PREPARING_BLOG_POST_PUBLISHING":
                    case "PUBLISHING_BLOG_POST": {
                        return (
                            <div className="d42-modal-processing-container">
                                <div style={{ height: "32px" }} />
                                <div className="d42-spinner" />
                                <p>Publishing...</p>
                            </div>
                        )
                    }
                    case "BLOG_POST_PUBLISHING_SUCCESS": {
                        return null
                    }
                    case "BLOG_POST_PUBLISHING_FAILURE": {
                        let kind!: "info" | "warning" | "danger"
                        let messages = []
                        let button: "publish-without-changes-check" | null = null

                        let failure = state.error

                        // TODO: Revisit error messages and overall design of this section
                        switch (failure._) {
                            case "NO_CHANGES_SINCE_LAST_PUBLISH": {
                                kind = "info"
                                messages.push("It doesn't seem like you have made any changes since your last publish.")
                                button = "publish-without-changes-check"
                                break
                            }
                            case "FAILED_TO_GET_SITE_AND_MODULE": {
                                // TODO: Provide a link to documentation. Structure it better.
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
                                    // TODO: Provide a link to documentation
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
                                // TODO: We should offer to add base frontmatter here
                                kind = "danger"
                                messages.push(
                                    "The file you are trying to publish doesn't have a frontmatter. Add it and try again.",
                                )
                                break
                            }
                            case "INVALID_FRONTMATTER": {
                                kind = "danger"
                                failure.errors.forEach(frontmatterError => {
                                    switch (frontmatterError._) {
                                        case "INVALID_POSTED_ON":
                                            messages.push("`Posted On` field is not a valid date.")
                                            break
                                        case "MISSING_COVER_LINK":
                                            messages.push(
                                                "`Cover` is not a valid link. Provide either a link to a local image or an absolute url to an external image and try again.",
                                            )
                                            break
                                        default:
                                            frontmatterError satisfies never
                                    }
                                })
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
                                // FIXME: Render proper error messages
                                messages.push("Server responded with an error:")
                                messages.push(JSON.stringify(failure.error, null, 4))
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
                                    `This post contains a link to itself. Link text: ${failure.link.displayText || failure.link.original}`,
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
                                // TODO: Include debug data to copy
                                // TODO: How to reach out to support?
                                kind = "danger"
                                messages.push("Something unexpected happened. Reach out to support.")
                                break
                            }
                            default:
                                failure satisfies never
                        }

                        return (
                            <div className={`d42-alert-container d42-alert-container-${kind}`}>
                                <h1>Publishing Post</h1>
                                {messages.map((message, idx) => (
                                    <div key={idx} className={`d42-alert-message d42-alert-message-${kind}`}>
                                        {message}
                                    </div>
                                ))}
                                <div className="d42-alert-buttons">
                                    <button className="d42-button d42-button-secondary" onClick={_ => modal.close()}>
                                        Close
                                    </button>
                                    {(() => {
                                        switch (button) {
                                            case "publish-without-changes-check":
                                                return (
                                                    <button
                                                        className="d42-button d42-button-primary"
                                                        onClick={_ =>
                                                            dispatch({
                                                                type: "START_PREPARING_BLOG_POST_PUBLISHING",
                                                                payload: {
                                                                    site: state.site,
                                                                    module: state.module,
                                                                    options: { skipChangesCheck: true },
                                                                },
                                                            })
                                                        }
                                                    >
                                                        Publish Anyway
                                                    </button>
                                                )
                                            case null:
                                                return null
                                            default: {
                                                button satisfies never
                                                return null
                                            }
                                        }
                                    })()}
                                </div>
                            </div>
                        )
                    }
                    case "PREPARING_DOC_PAGE_PUBLISHING":
                    case "PUBLISHING_DOC_PAGE": {
                        return (
                            <div className="d42-modal-processing-container">
                                <div style={{ height: "32px" }} />
                                <div className="d42-spinner" />
                                <p>Publishing...</p>
                            </div>
                        )
                    }
                    case "DOC_PAGE_PUBLISHING_SUCCESS": {
                        if (state.hasContent) {
                            return null
                        }
                        return (
                            <div className="d42-alert-container d42-alert-container-info">
                                <h1>Publishing Doc Page</h1>
                                <div className="d42-alert-message d42-alert-message-info">
                                    Doc group updated successfully.
                                </div>
                                <div className="d42-alert-buttons">
                                    <button className="d42-button d42-button-secondary" onClick={_ => modal.close()}>
                                        Close
                                    </button>
                                </div>
                            </div>
                        )
                    }
                    case "DOC_PAGE_PUBLISHING_FAILURE": {
                        let kind: "info" | "warning" | "danger" = "danger"
                        let messages: string[] = []
                        let button: "publish-without-changes-check" | null = null

                        let failure = state.error

                        switch (failure._) {
                            case "NO_CHANGES_SINCE_LAST_PUBLISH": {
                                kind = "info"
                                messages.push("It doesn't seem like you have made any changes since your last publish.")
                                button = "publish-without-changes-check"
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
                            case "MISSING_FRONTMATTER": {
                                kind = "danger"
                                messages.push("Note is missing frontmatter. Add frontmatter with required fields.")
                                break
                            }
                            case "INVALID_FRONTMATTER": {
                                kind = "danger"
                                failure.errors.forEach(frontmatterError => {
                                    switch (frontmatterError._) {
                                        case "INVALID_POSTED_ON":
                                            messages.push("`Posted On` field is not a valid date.")
                                            break
                                        // TS doesn't narrow single-member types in switch defaults
                                        // default:
                                        //     frontmatterError satisfies never
                                    }
                                })
                                break
                            }
                            case "MISSING_POSITION": {
                                kind = "danger"
                                messages.push(
                                    "Unable to determine page position. The module hierarchy is in invalid state.",
                                ) // TODO: Suggest how to fix
                                break
                            }
                            case "FAILED_TO_GET_SITE_AND_MODULE":
                            case "INVALID_SETTINGS":
                            case "LINKED_RESOURCE_NOT_FOUND":
                            case "LINKED_RESOURCE_IS_DIRECTORY":
                            case "LOCAL_LINK_DOESNT_HAVE_BLOCK_ID":
                            case "LINKED_RESOURCE_DOESNT_HAVE_METADATA":
                            case "LINKED_RESOURCE_IS_NOT_PUBLISHED":
                            case "IMAGES_VALIDATION_FAILED":
                            case "IMAGES_UPLOADING_FAILED": {
                                kind = "danger"
                                messages.push("An error occurred. Please check your configuration and try again.")
                                break
                            }
                            case "MISSING_API_TOKEN":
                            case "API_AUTH_ERROR": {
                                kind = "danger"
                                messages.push("Authentication error. Check your API token in settings.")
                                break
                            }
                            case "CLIENT_OUTDATED": {
                                kind = "danger"
                                messages.push("Please update Draft42 plugin to the latest version.")
                                break
                            }
                            case "MAINTENANCE": {
                                kind = "warning"
                                messages.push("Service is under maintenance. Please try again later.")
                                break
                            }
                            case "API_USER_ERROR": {
                                kind = "danger"
                                messages.push("Server responded with an error:")
                                messages.push(JSON.stringify(failure.error, null, 4))
                                break
                            }
                            case "API_SERVER_ERROR":
                            case "FAILED_TO_READ_ASSETS_METADATA":
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
                                <h1>Publishing Doc Page</h1>
                                {messages.map((message, idx) => (
                                    <div key={idx} className={`d42-alert-message d42-alert-message-${kind}`}>
                                        {message}
                                    </div>
                                ))}
                                <div className="d42-alert-buttons">
                                    <button className="d42-button d42-button-secondary" onClick={_ => modal.close()}>
                                        Close
                                    </button>
                                    {(() => {
                                        switch (button) {
                                            case "publish-without-changes-check":
                                                return (
                                                    <button
                                                        className="d42-button d42-button-primary"
                                                        onClick={_ =>
                                                            dispatch({
                                                                type: "START_PREPARING_DOC_PAGE_PUBLISHING",
                                                                payload: {
                                                                    site: state.site,
                                                                    module: state.module,
                                                                    options: { skipChangesCheck: true },
                                                                },
                                                            })
                                                        }
                                                    >
                                                        Publish Anyway
                                                    </button>
                                                )
                                            case null:
                                                return null
                                            default: {
                                                button satisfies never
                                                return null
                                            }
                                        }
                                    })()}
                                </div>
                            </div>
                        )
                    }
                    case "PUBLISHING_FAILURE": {
                        let message

                        switch (state.error._) {
                            case "SITE_NOT_FOUND":
                            case "MODULE_NOT_FOUND": {
                                message = "Failed to find a target site. Make sure your configuration is correct."
                                break
                            }
                            case "SITE_DISABLED": {
                                message = `Site ${state.error.site} is disabled. Please enable the site in the settings and try again.`
                            }
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
