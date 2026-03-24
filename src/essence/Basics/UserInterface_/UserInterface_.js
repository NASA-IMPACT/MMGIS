// Function to load the appropriate UserInterface based on config
async function loadUserInterface(config = null) {
    // Check useragent for now (FIXME use a better way to determine if mobile or not)
    // https://gist.github.com/dalethedeveloper/1503252
    let isMobile = window.navigator.userAgent.match(
        /Mobi|iP(hone|od|ad)|Android|BlackBerry/
    )

    // Check for enhanced layout from config or environment variable
    let useEnhancedLayout = false
    if (config?.panels?.enhancedLayout === true) {
        useEnhancedLayout = true
    } else if (window.mmgisglobal?.ENABLE_ENHANCED_LAYOUT === 'true') {
        useEnhancedLayout = true
    }

    if (isMobile) {
        const module = await import('./UserInterfaceMobile_')
        module.default.isMobile = true
        return module.default
    } else if (useEnhancedLayout) {
        const module = await import('./UserInterfaceEnhanced_')
        return module.default
    } else {
        const module = await import('./UserInterfaceDefault_')
        return module.default
    }
}

export default loadUserInterface
