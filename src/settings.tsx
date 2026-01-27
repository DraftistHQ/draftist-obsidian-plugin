import * as Obsidian from "obsidian"
import * as React from "react"
import * as ReactDOM from "react-dom/client"

import type Plugin from "src/main"
import * as Config from "src/config"
import * as Platform from "src/platform"
import * as Notice from "src/notice"
import * as Site from "src/models/site"
import * as GetSitesRequest from "src/clients/requests/get-sites"
import * as Record from "src/utils/record"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"
import * as CopyDebugInfoCmd from "src/commands/copy-debug-info"

export class SettingTab extends Obsidian.PluginSettingTab {
    plugin: Plugin

    private showDisabledSites: boolean = false
    private onboardingRoot: ReactDOM.Root | null = null

    constructor(plugin: Plugin) {
        super(plugin.app, plugin)
        this.plugin = plugin
    }

    display(): void {
        if (Config.Store.onboarded()) {
            this.displaySettings()
        } else {
            this.displayOnboarding()
        }
    }

    displayOnboarding(): void {
        const webViewerEnabled = this.isWebViewerEnabled()

        this.onboardingRoot = this.onboardingRoot || ReactDOM.createRoot(this.containerEl)
        this.onboardingRoot.render(
            <React.StrictMode>
                <Onboarding
                    app={this.app}
                    webViewerEnabled={webViewerEnabled}
                    onFinish={async sites => {
                        try {
                            await Config.Store.setSites(sites)
                            await Config.Store.setOnboarded(true)
                            await Site.createFolders(this.plugin.app)
                            this.display()
                        } catch (error) {
                            log.error("Failed to finish onboarding", error)
                            Notice.error("Failed to finish onboarding", { permanent: true })
                        }
                    }}
                    onRestart={async () => {
                        try {
                            await Config.Store.resetUserSettings()
                            this.display()
                        } catch (error) {
                            log.error("Failed to restart onboarding", error)
                            Notice.error("Failed to restart onboarding", { permanent: true })
                        }
                    }}
                />
            </React.StrictMode>,
        )
    }

    displaySettings(): void {
        const { containerEl } = this

        this.onboardingRoot = null

        containerEl.empty()

        containerEl.createEl("h1", { text: "Draft42 Settings", cls: "d42-settings-heading" })

        new Obsidian.Setting(containerEl).setName("Authentication").setHeading()

        const tokenSetting = new Obsidian.Setting(containerEl)
            .setName("Token")
            .setDesc("Select or create a secret for your Draft42 API token")

        new Obsidian.SecretComponent(this.app, tokenSetting.controlEl)
            .setValue(Config.Store.tokenSecretName() || "")
            .onChange(async (secretName: string) => {
                await Config.Store.setTokenSecretName(secretName || null)
            })

        tokenSetting.addExtraButton(button =>
            button
                .setIcon("square-arrow-out-up-right")
                .setTooltip("Get token on Draft42")
                .onClick(async () => {
                    window.open(Platform.apiTokensUrl())
                }),
        )

        new Obsidian.Setting(containerEl)
            .setName("Sites")
            .setHeading()
            .addExtraButton(button =>
                button
                    .setIcon("refresh-ccw")
                    .setTooltip("Refetch sites from Draft42")
                    .onClick(async () => {
                        // TODO: Show modal with site list (similar to the onboarding step)
                        if (Config.Store.apiToken()) {
                            let result = await GetSitesRequest.send()
                            switch (result._) {
                                case OK: {
                                    let nextSites: Config.SitesSettings = {}

                                    for (let site of result.data) {
                                        let siteSettings = Config.Store.siteSettings(site.id)

                                        if (!siteSettings) {
                                            siteSettings = {
                                                path: null,
                                                enabled: true,
                                                default: false,
                                                config: site,
                                            }
                                        } else {
                                            siteSettings = { ...siteSettings, config: site }
                                        }

                                        nextSites[site.id] = siteSettings
                                    }

                                    await Config.Store.setSites(nextSites)
                                    this.display()
                                    break
                                }
                                case ERROR: {
                                    // TODO: Handle error
                                    Notice.error("Failed to fetch sites", { permanent: true })
                                    log.error("Failed to fetch site settings", result.error)
                                    break
                                }
                                default:
                                    result satisfies never
                            }
                        } else {
                            Notice.error("API Token is not set", { permanent: true })
                        }
                    }),
            )
            .addExtraButton(button =>
                button
                    .setIcon("square-arrow-out-up-right")
                    .setTooltip("Manage sites on Draft42")
                    .onClick(async () => {
                        window.open(Platform.manageSitesUrl())
                    }),
            )

        const enabledSites: Config.SiteSettings[] = []
        const disabledSites: Config.SiteSettings[] = []

        for (const site of Record.values(Config.Store.sites())) {
            if (site!.enabled) {
                enabledSites.push(site)
            } else {
                disabledSites.push(site)
            }
        }

        for (const site of enabledSites) {
            let siteEl = new Obsidian.Setting(containerEl).setName(site.config.label || site.config.addresses.primary)

            const modulesPart =
                site.config.modules.length > 0 ? `Modules: ${site.config.modules.map(m => m.name).join(", ")}` : null

            const descParts = [modulesPart, site.config.addresses.primary].filter(Boolean)
            siteEl = siteEl.setDesc(descParts.join(" · "))

            siteEl
                .addText(text =>
                    text
                        .setPlaceholder("My Website")
                        .setValue(site.path || "")
                        .setDisabled(!site.enabled)
                        .onChange(async value => {
                            await Config.Store.setSiteSettings(site.config.id, {
                                ...site,
                                path: value.trim() || null,
                            })

                            // TODO: It should be validated onBlur, not onChange.
                            // if (nextPath) {
                            //     const abstractFile = this.app.vault.getAbstractFileByPath(path)
                            //     if (!(abstractFile instanceof Obsidian.TFolder)) {
                            //         Notice.error("Not a folder")
                            //     }
                            // }
                        }),
                )
                .addExtraButton(button =>
                    button
                        .setIcon("circle-minus")
                        .setTooltip(
                            enabledSites.length <= 1
                                ? "Can't disable last website"
                                : "Don't manage this website in this vault",
                        )
                        .onClick(async () => {
                            if (enabledSites.length > 1) {
                                await Config.Store.setSiteSettings(site.config.id, {
                                    ...site,
                                    enabled: false,
                                })
                                this.display()
                            } else {
                                Notice.warning("Can't disable last website")
                            }
                        }),
                )
        }

        if (disabledSites.length > 0) {
            const disabledSitesHeading = containerEl.createEl("div", {
                text: "Unmanaged sites",
                cls: `d42-settings-disabled-sites-header${this.showDisabledSites ? "" : " d42-settings-disabled-sites-header-folded"}`,
            })
            disabledSitesHeading.addEventListener("click", () => {
                this.showDisabledSites = !this.showDisabledSites
                disabledSitesHeading.classList.toggle(
                    "d42-settings-disabled-sites-header-folded",
                    this.showDisabledSites,
                )
                this.display()
            })

            if (this.showDisabledSites) {
                for (const site of disabledSites) {
                    let siteEl = new Obsidian.Setting(containerEl).setName(
                        site.config.label || site.config.addresses.primary,
                    )

                    const modulesPart =
                        site.config.modules.length > 0
                            ? `Modules: ${site.config.modules.map(m => m.name).join(", ")}`
                            : null

                    const descParts = [modulesPart, site.config.addresses.primary].filter(Boolean)
                    siteEl = siteEl.setDesc(descParts.join(" · "))

                    siteEl.addExtraButton(button =>
                        button
                            .setIcon("circle-plus")
                            .setTooltip("Manage website")
                            .onClick(async () => {
                                await Config.Store.setSiteSettings(site.config.id, {
                                    ...site,
                                    enabled: true,
                                })
                                this.display()
                            }),
                    )
                }
            }
        }

        new Obsidian.Setting(containerEl).setName("Automations").setHeading()

        const automations = Config.Store.automations()

        // TODO: Add link to docs when available
        const manageFoldersDesc = document.createDocumentFragment()
        manageFoldersDesc.createEl("div", { text: "Automatically manage file/folder structure of your sites." })
        manageFoldersDesc.createEl("div", {
            text: "We strongly recommend keeping this enabled, as manual management currently might have some rough edges.",
        })

        new Obsidian.Setting(containerEl)
            .setName("Manage site folders")
            .setDesc(manageFoldersDesc)
            .addToggle(toggle =>
                toggle.setValue(automations.manageFileTrees).onChange(async value => {
                    await Config.Store.setAutomationsManageFileTrees(value)
                    if (value) {
                        this.plugin.fileTreeManager.register()
                    } else {
                        this.plugin.fileTreeManager.dispose()
                    }
                }),
            )

        new Obsidian.Setting(containerEl).setName("Block IDs").setHeading()

        new Obsidian.Setting(containerEl)
            .setName("Enable")
            .setDesc("Generate identifiers for content blocks to make them linkable")
            .addToggle(toggle =>
                toggle.setValue(automations.blockIds.enable).onChange(async value => {
                    await Config.Store.setAutomationsBlockIdsEnable(value)
                    this.display()
                }),
            )

        if (automations.blockIds.enable) {
            new Obsidian.Setting(containerEl)
                .setName("Opacity")
                .setDesc("Set opacity of a block ID in editor")
                .addSlider(slider =>
                    slider
                        .setLimits(0, 1, 0.05)
                        .setValue(automations.blockIds.opacity)
                        .onChange(async value => {
                            await Config.Store.setAutomationsBlockIdsOpacity(value)
                            this.updateBlockIdCss()
                        }),
                )
        }

        new Obsidian.Setting(containerEl).setName("Debugging").setHeading()

        const debugging = Config.Store.debugging()

        new Obsidian.Setting(containerEl).setName("Extensive logging").addToggle(toggle =>
            toggle.setValue(debugging.extensiveLogging).onChange(async value => {
                await Config.Store.setDebuggingExtensiveLogging(value)
                this.display()
            }),
        )

        new Obsidian.Setting(containerEl).setName("Expose internal metadata").addToggle(toggle =>
            toggle.setValue(debugging.exposeInternalMetadata).onChange(async value => {
                await Config.Store.setDebuggingExposeInternalMetadata(value)
                if (value) {
                    this.plugin.styles.disposeInternalFrontmatterCss()
                    this.plugin.registerDeleteD42MetadataCommand()
                } else {
                    this.plugin.styles.injectInternalFrontmatterCss()
                    this.plugin.disposeDeleteD42MetadataCommand()
                }
                this.display()
            }),
        )

        const footer = containerEl.createEl("div", { cls: "d42-settings-footer" })
        footer.createEl("span", { text: `Version: ${D42_VERSION} (${D42_BUILD_ID})` })
        new Obsidian.ExtraButtonComponent(footer)
            .setIcon("copy")
            .setTooltip("Copy debug info")
            .onClick(() => CopyDebugInfoCmd.run())
    }

    updateBlockIdCss() {
        const file = this.app.workspace.getActiveFile()
        if (file) {
            this.plugin.styles.injectBlockIdCss(file)
        }
    }

    isWebViewerEnabled = (): boolean => {
        try {
            // @ts-expect-error - accessing internal API
            const webviewer = this.app.internalPlugins?.plugins?.webviewer
            return webviewer?.enabled && webviewer?.instance?.options?.openExternalURLs
        } catch {
            console.error("[Draft42] Failed to access webviewer options")
            return false
        }
    }
}

// --- Onboarding

type OnboardingStep = { _: "Start" } | { _: "ApiToken" } | { _: "Sites"; sites: Site.T[] | null }

const Onboarding = ({
    app,
    webViewerEnabled,
    onFinish,
    onRestart,
}: {
    app: Obsidian.App
    webViewerEnabled: boolean
    onFinish: (sites: Config.SitesSettings) => Promise<void>
    onRestart: () => Promise<void>
}) => {
    let initialStep = React.useMemo((): OnboardingStep => {
        return !Config.Store.apiToken() ? { _: "Start" } : { _: "Sites", sites: null }
    }, [])
    let [step, setStep] = React.useState<OnboardingStep>(initialStep)

    return (
        <div className="d42-onboarding-container">
            {(() => {
                switch (step._) {
                    case "Start": {
                        return <OnboardingStart onNextStep={() => setStep({ _: "ApiToken" })} />
                    }
                    case "ApiToken": {
                        return (
                            <OnboardingApiToken
                                app={app}
                                webViewerEnabled={webViewerEnabled}
                                onNextStep={sites => setStep({ _: "Sites", sites })}
                            />
                        )
                    }
                    case "Sites": {
                        return <OnboardingSites sites={step.sites} onFinish={onFinish} onRestart={onRestart} />
                    }
                    default: {
                        step satisfies never
                        return null
                    }
                }
            })()}
        </div>
    )
}

const Nbsp = () => "\u00A0"

const OnboardingHeading = ({ children }: { children: React.ReactNode }) => {
    return <h1 className="d42-onboarding-heading"> {children} </h1>
}

const OnboardingStart = ({ onNextStep }: { onNextStep: () => void }) => {
    return (
        <>
            <OnboardingHeading> Welcome to Draft42! </OnboardingHeading>
            <p className="d42-onboarding-row d42-onboarding-message">
                Let's set up your plugin. You'll need a Draft42 account to continue.
            </p>
            <div className="d42-onboarding-row d42-onboarding-actions">
                <button type="button" className="d42-button d42-button-primary" onClick={onNextStep}>
                    Get Started
                </button>
            </div>
        </>
    )
}

const SecretInput = ({
    app,
    value,
    onChange,
}: {
    app: Obsidian.App
    value: string
    onChange: (secretName: string) => void
}) => {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const componentRef = React.useRef<Obsidian.SecretComponent | null>(null)

    React.useEffect(() => {
        if (containerRef.current && !componentRef.current) {
            componentRef.current = new Obsidian.SecretComponent(app, containerRef.current)
                .setValue(value)
                .onChange(onChange)
        }
    }, [app])

    return <div ref={containerRef} className="d42-onboarding-secret-input" />
}

const OnboardingApiToken = ({
    app,
    webViewerEnabled,
    onNextStep,
}: {
    app: Obsidian.App
    webViewerEnabled: boolean
    onNextStep: (sites: Site.T[]) => void
}) => {
    let [secretName, setSecretName] = React.useState("")

    const [error, setError] = React.useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setError(null)

        if (!secretName) {
            setError("Please select or create a secret for your API token")
            return
        }

        const tokenValue = app.secretStorage.getSecret(secretName)
        if (!tokenValue) {
            setError("Secret value is empty")
            return
        }

        setIsSubmitting(true)

        try {
            let result = await GetSitesRequest.send(tokenValue)
            switch (result._) {
                case OK: {
                    await Config.Store.setTokenSecretName(secretName)
                    onNextStep(result.data)
                    break
                }
                case ERROR: {
                    log.error("Failed to fetch sites", result.error)
                    switch (result.error._) {
                        case "MISSING_API_TOKEN":
                        case "API_USER_ERROR":
                        case "API_SERVER_ERROR":
                        case "API_UNEXPECTED_ERROR": {
                            return setError("Something went wrong")
                        }
                        case "API_AUTH_ERROR": {
                            return setError("Invalid token")
                        }
                        case "MAINTENANCE": {
                            return setError("Service is under maintenance. Please try again later.")
                        }
                        case "CLIENT_OUTDATED": {
                            return setError("Please update plugin to the latest version")
                        }
                        default: {
                            result.error satisfies never
                            return
                        }
                    }
                }
                default:
                    result satisfies never
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Something went wrong")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <>
            <OnboardingHeading> API Token </OnboardingHeading>
            <div className="d42-onboarding-row">
                <span className="d42-onboarding-message">
                    Click "Get token" to copy your API token, then create a secret using
                    <Nbsp />
                    "Link..." button.
                </span>
            </div>
            {/* Don't bind submission handler here because SecretInput's link button would submit the form */}
            <form className="d42-onboarding-subcontainer" onSubmit={event => event.preventDefault()}>
                <div className="d42-onboarding-row">
                    <SecretInput
                        app={app}
                        value={secretName}
                        onChange={x => {
                            console.log(x)
                            setSecretName(x)
                        }}
                    />
                </div>
                {error && <div className="d42-onboarding-row d42-onboarding-error">{error}</div>}
                <div className="d42-onboarding-row d42-onboarding-actions">
                    <a href={Platform.apiTokensUrl()} className="d42-button d42-button-link d42-button-secondary">
                        Get token
                    </a>
                    <button
                        type="button"
                        disabled={isSubmitting}
                        className={"d42-button d42-button-primary" + (isSubmitting ? " d42-button-with-spinner" : "")}
                        onClick={handleSubmit}
                    >
                        {isSubmitting && <div className="d42-spinner" />}
                        Next
                    </button>
                </div>
                {webViewerEnabled && (
                    <>
                        <div className={"d42-onboarding-row d42-alert-container d42-alert-container-info"}>
                            <span className={"d42-alert-message d42-alert-message-info"}>
                                When you click "Get token", Obsidian's web viewer will open with a login form. After
                                logging in, you'll receive an email with a magic link. Paste that link into the web
                                viewer's address bar, not your default browser.
                            </span>
                        </div>
                        <div className={"d42-onboarding-row d42-alert-container d42-alert-container-warning"}>
                            <span className={"d42-alert-message d42-alert-message-warning"}>
                                Be aware that if you use other third-party Obsidian plugins, the Obsidian team{" "}
                                <a href="https://help.obsidian.md/plugins/web-viewer#Security" target="_blank">
                                    recommends
                                </a>{" "}
                                using your primary browser for sensitive tasks and websites that require login instead
                                of the web viewer for security reasons.
                            </span>
                        </div>
                    </>
                )}
            </form>
        </>
    )
}

type OnboardingSitesStep = { _: "Loading" } | { _: "Ready"; sites: Site.T[] } | { _: "Failure"; error: string }

const OnboardingSites = ({
    sites,
    onRestart,
    onFinish,
}: {
    sites: Site.T[] | null
    onRestart: () => Promise<void>
    onFinish: (sites: Config.SitesSettings) => Promise<void>
}) => {
    let initialState = React.useMemo((): OnboardingSitesStep => (!sites ? { _: "Loading" } : { _: "Ready", sites }), [])

    let [state, setState] = React.useState<OnboardingSitesStep>(initialState)

    React.useEffect(() => {
        switch (state._) {
            case "Loading": {
                GetSitesRequest.send().then(result => {
                    switch (result._) {
                        case OK: {
                            return setState({ _: "Ready", sites: result.data })
                        }
                        case ERROR: {
                            log.error("Failed to fetch sites", result.error)
                            switch (result.error._) {
                                case "MISSING_API_TOKEN":
                                case "API_USER_ERROR":
                                case "API_SERVER_ERROR":
                                case "API_UNEXPECTED_ERROR": {
                                    return setState({ _: "Failure", error: "Something went wrong" })
                                }
                                case "API_AUTH_ERROR": {
                                    return setState({ _: "Failure", error: "Invalid token" })
                                }
                                case "MAINTENANCE": {
                                    return setState({
                                        _: "Failure",
                                        error: "Service is under maintenance. Please try again later.",
                                    })
                                }
                                case "CLIENT_OUTDATED": {
                                    return setState({
                                        _: "Failure",
                                        error: "Please update plugin to the latest version",
                                    })
                                }
                                default: {
                                    result.error satisfies never
                                    return
                                }
                            }
                        }
                        default:
                            result satisfies never
                    }
                })
                return
            }
            case "Ready":
            case "Failure": {
                return
            }
            default: {
                state satisfies never
            }
        }
    }, [state])

    switch (state._) {
        case "Loading":
            return (
                <>
                    <div className="d42-spinner" />
                    <div className="d42-onboarding-row"> Loading sites... </div>
                </>
            )
        case "Ready": {
            return <OnboardingSitesList sites={state.sites} onFinish={onFinish} />
        }
        case "Failure":
            return (
                <>
                    <div className="d42-onboarding-row d42-onboarding-error"> {state.error} </div>
                    <div className="d42-onboarding-row d42-onboarding-actions">
                        <button className="d42-button d42-button-secondary" onClick={onRestart}>
                            Restart
                        </button>
                    </div>
                </>
            )
        default: {
            state satisfies never
            return null
        }
    }
}

type OnboardingSitesState = {
    sites: Config.SitesSettings
    errors: Record<Site.SiteId, string>
}

type OnboardingSitesAction =
    | { _: "TOGGLE_SITE"; siteId: Site.SiteId }
    | { _: "UPDATE_PATH"; siteId: Site.SiteId; path: string }
    | { _: "UPDATE_ERRORS"; errors: Record<Site.SiteId, string> }

let onboardingSitesInitialState = (initialSites: Site.T[]): OnboardingSitesState => {
    let sites: Config.SitesSettings = {}

    for (let site of initialSites) {
        sites[site.id] = {
            path: null,
            enabled: true,
            default: typeof site.owner === "object" && site.owner.TAG === "User" ? site.owner.isPrimary : false,
            config: site,
        }
    }

    return { sites, errors: {} }
}

let onboardingSitesReducer = (state: OnboardingSitesState, action: OnboardingSitesAction): OnboardingSitesState => {
    switch (action._) {
        case "TOGGLE_SITE": {
            let site = state.sites[action.siteId]!

            return {
                ...state,
                sites: {
                    ...state.sites,
                    [action.siteId]: { ...site, enabled: !site.enabled } satisfies Config.SiteSettings,
                },
            }
        }
        case "UPDATE_PATH": {
            let site = state.sites[action.siteId]!

            return {
                ...state,
                sites: {
                    ...state.sites,
                    [action.siteId]: { ...site, path: action.path } satisfies Config.SiteSettings,
                },
            }
        }
        case "UPDATE_ERRORS": {
            return {
                ...state,
                errors: action.errors,
            }
        }
        default: {
            action satisfies never
            return state
        }
    }
}

const OnboardingSitesList = ({
    sites: initialSites,
    onFinish,
}: {
    sites: Site.T[]
    onFinish: (sites: Config.SitesSettings) => Promise<void>
}) => {
    let [state, dispatch] = React.useReducer(onboardingSitesReducer, initialSites, onboardingSitesInitialState)

    let sites = Record.entries(state.sites)
    let isSingleSite = sites.length === 1

    let handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()

        let result = Site.validateSites(state.sites)

        switch (result._) {
            case OK:
                await onFinish(state.sites)
                break
            case ERROR: {
                let errors: Record<Site.SiteId, string> = {}
                let error = result.error

                switch (error._) {
                    case "ENABLED_SITE_MISSING_PATH":
                        errors[error.siteId] = "Path is required"
                        break
                    case "OVERLAPPING_PATHS":
                        errors[error.site1.id] = "Path overlaps with another site"
                        errors[error.site2.id] = "Path overlaps with another site"
                        break
                    default:
                        error satisfies never
                }

                dispatch({ _: "UPDATE_ERRORS", errors })
                break
            }
            default:
                result satisfies never
        }
    }

    return (
        <>
            <OnboardingHeading> Configure Sites </OnboardingHeading>
            <p className="d42-onboarding-row d42-onboarding-message">
                {isSingleSite ? (
                    <>Specify a folder path for your site's content. The folder will be created if it doesn't exist.</>
                ) : (
                    <>
                        Specify a folder path for each site's content. Folders will be created if they don't exist.
                        Uncheck sites you don't want to manage in this vault.
                    </>
                )}
            </p>
            <form className="d42-onboarding-subcontainer" onSubmit={handleSubmit}>
                <div className="d42-onboarding-sites">
                    {sites.map(([siteId, site]) => (
                        <div key={siteId} className="d42-onboarding-site-container">
                            {isSingleSite ? (
                                <span className={!site.enabled ? "d42-onboarding-site-disabled" : undefined}>
                                    {site.config.label || site.config.addresses.primary}
                                </span>
                            ) : (
                                <label className="d42-onboarding-site-label">
                                    <input
                                        type="checkbox"
                                        checked={site.enabled}
                                        onChange={() => dispatch({ _: "TOGGLE_SITE", siteId })}
                                    />
                                    <span className={!site.enabled ? "d42-onboarding-site-disabled" : undefined}>
                                        {site.config.label || site.config.addresses.primary}
                                    </span>
                                </label>
                            )}
                            <div className="d42-onboarding-site-input">
                                <input
                                    type="text"
                                    size={30}
                                    value={site.path || ""}
                                    placeholder="Path to site's folder"
                                    disabled={!site.enabled}
                                    onChange={event => dispatch({ _: "UPDATE_PATH", siteId, path: event.target.value })}
                                />
                                {state.errors[siteId] && (
                                    <div className="d42-onboarding-error">{state.errors[siteId]} </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="d42-onboarding-row d42-onboarding-actions">
                    <button
                        type="submit"
                        className="d42-button d42-button-primary"
                        disabled={!sites.some(([_, site]) => site.enabled)}
                    >
                        Finish
                    </button>
                </div>
            </form>
        </>
    )
}
