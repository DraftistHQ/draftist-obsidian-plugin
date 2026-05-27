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

        containerEl.createEl("h1", { text: "Draftist Settings", cls: "draftist-settings-heading" })

        new Obsidian.Setting(containerEl).setName("Authentication").setHeading()

        const tokenSetting = new Obsidian.Setting(containerEl)
            .setName("Token")
            .setDesc("Select or create a secret for your Draftist API token")

        new Obsidian.SecretComponent(this.app, tokenSetting.controlEl)
            .setValue(Config.Store.tokenSecretName() || "")
            .onChange(async (secretName: string) => {
                await Config.Store.setTokenSecretName(secretName || null)
            })

        tokenSetting.addExtraButton(button =>
            button
                .setIcon("square-arrow-out-up-right")
                .setTooltip("Get token on Draftist")
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
                    .setTooltip("Refetch sites from Draftist")
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

                                    let oldSites = Config.Store.sites()
                                    await Site.renameModuleFolders(this.app, oldSites, nextSites)

                                    await Config.Store.setSites(nextSites)
                                    await Site.createFolders(this.app)

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
                    .setTooltip("Manage sites on Draftist")
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
                cls: `draftist-settings-disabled-sites-header${this.showDisabledSites ? "" : " draftist-settings-disabled-sites-header-folded"}`,
            })
            disabledSitesHeading.addEventListener("click", () => {
                this.showDisabledSites = !this.showDisabledSites
                disabledSitesHeading.classList.toggle(
                    "draftist-settings-disabled-sites-header-folded",
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
                } else {
                    this.plugin.styles.injectInternalFrontmatterCss()
                }
                this.display()
            }),
        )

        const footer = containerEl.createEl("div", { cls: "draftist-settings-footer" })
        footer.createEl("span", { text: `Version: ${DFT_VERSION} (${DFT_BUILD_ID})` })
        new Obsidian.ExtraButtonComponent(footer)
            .setIcon("copy")
            .setTooltip("Copy debug info")
            .onClick(() => CopyDebugInfoCmd.runCommand())
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
            console.error("[Draftist] Failed to access webviewer options")
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
        <div className="draftist-onboarding-container">
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
    return <h1 className="draftist-onboarding-heading"> {children} </h1>
}

const OnboardingStart = ({ onNextStep }: { onNextStep: () => void }) => {
    return (
        <>
            <OnboardingHeading> Welcome to Draftist! </OnboardingHeading>
            <p className="draftist-onboarding-row draftist-onboarding-message">
                Let's set up your plugin. You'll need a Draftist account to continue.
            </p>
            <div className="draftist-onboarding-row draftist-onboarding-actions">
                <button type="button" className="draftist-button draftist-button-primary" onClick={onNextStep}>
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

    return <div ref={containerRef} className="draftist-onboarding-secret-input" />
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
            <div className="draftist-onboarding-row">
                <span className="draftist-onboarding-message">
                    Click "Get token" to copy your API token, then create a secret using
                    <Nbsp />
                    "Link..." button.
                </span>
            </div>
            {/* Don't bind submission handler here because SecretInput's link button would submit the form */}
            <form className="draftist-onboarding-subcontainer" onSubmit={event => event.preventDefault()}>
                <div className="draftist-onboarding-row">
                    <SecretInput
                        app={app}
                        value={secretName}
                        onChange={x => {
                            console.log(x)
                            setSecretName(x)
                        }}
                    />
                </div>
                {error && <div className="draftist-onboarding-row draftist-onboarding-error">{error}</div>}
                <div className="draftist-onboarding-row draftist-onboarding-actions">
                    <a
                        href={Platform.apiTokensUrl()}
                        className="draftist-button draftist-button-link draftist-button-secondary"
                    >
                        Get token
                    </a>
                    <button
                        type="button"
                        disabled={isSubmitting}
                        className={
                            "draftist-button draftist-button-primary" +
                            (isSubmitting ? " draftist-button-with-spinner" : "")
                        }
                        onClick={handleSubmit}
                    >
                        {isSubmitting && <div className="draftist-spinner" />}
                        Next
                    </button>
                </div>
                {webViewerEnabled && (
                    <>
                        <div
                            className={"draftist-onboarding-row draftist-alert-container draftist-alert-container-info"}
                        >
                            <span className={"draftist-alert-message draftist-alert-message-info"}>
                                When you click "Get token", Obsidian's web viewer will open with a login form. After
                                logging in, you'll receive an email with a magic link. Paste that link into the web
                                viewer's address bar, not your default browser.
                            </span>
                        </div>
                        <div
                            className={
                                "draftist-onboarding-row draftist-alert-container draftist-alert-container-warning"
                            }
                        >
                            <span className={"draftist-alert-message draftist-alert-message-warning"}>
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
                    <div className="draftist-spinner" />
                    <div className="draftist-onboarding-row"> Loading sites... </div>
                </>
            )
        case "Ready": {
            return <OnboardingSitesList sites={state.sites} onFinish={onFinish} />
        }
        case "Failure":
            return (
                <>
                    <div className="draftist-onboarding-row draftist-onboarding-error"> {state.error} </div>
                    <div className="draftist-onboarding-row draftist-onboarding-actions">
                        <button className="draftist-button draftist-button-secondary" onClick={onRestart}>
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
            <p className="draftist-onboarding-row draftist-onboarding-message">
                {isSingleSite ? (
                    <>Specify a folder path for your site's content. The folder will be created if it doesn't exist.</>
                ) : (
                    <>
                        Specify a folder path for each site's content. Folders will be created if they don't exist.
                        Uncheck sites you don't want to manage in this vault.
                    </>
                )}
            </p>
            <form className="draftist-onboarding-subcontainer" onSubmit={handleSubmit}>
                <div className="draftist-onboarding-sites">
                    {sites.map(([siteId, site]) => (
                        <div key={siteId} className="draftist-onboarding-site-container">
                            {isSingleSite ? (
                                <span className={!site.enabled ? "draftist-onboarding-site-disabled" : undefined}>
                                    {site.config.label || site.config.addresses.primary}
                                </span>
                            ) : (
                                <label className="draftist-onboarding-site-label">
                                    <input
                                        type="checkbox"
                                        checked={site.enabled}
                                        onChange={() => dispatch({ _: "TOGGLE_SITE", siteId })}
                                    />
                                    <span className={!site.enabled ? "draftist-onboarding-site-disabled" : undefined}>
                                        {site.config.label || site.config.addresses.primary}
                                    </span>
                                </label>
                            )}
                            <div className="draftist-onboarding-site-input">
                                <input
                                    type="text"
                                    size={30}
                                    value={site.path || ""}
                                    placeholder="Path to site's folder"
                                    disabled={!site.enabled}
                                    onChange={event => dispatch({ _: "UPDATE_PATH", siteId, path: event.target.value })}
                                />
                                {state.errors[siteId] && (
                                    <div className="draftist-onboarding-error">{state.errors[siteId]} </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="draftist-onboarding-row draftist-onboarding-actions">
                    <button
                        type="submit"
                        className="draftist-button draftist-button-primary"
                        disabled={!sites.some(([_, site]) => site.enabled)}
                    >
                        Finish
                    </button>
                </div>
            </form>
        </>
    )
}
