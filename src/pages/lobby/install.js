let deferredPrompt = null

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault()
  deferredPrompt = event
})

window.addEventListener("appinstalled", () => {
  deferredPrompt = null
})

export function canOfferInstall() {
  return document.documentElement.dataset.layout === "mobile"
    && !window.matchMedia("(display-mode: standalone)").matches
    && window.navigator.standalone !== true
}

export async function promptInstall() {
  const prompt = deferredPrompt
  if (!prompt) return null
  deferredPrompt = null
  prompt.prompt()
  const choice = await prompt.userChoice
  return choice.outcome === "accepted"
}
