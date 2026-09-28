const INTERVAL_MS = 6000

export function createHero(root, layout) {
  const hero = root.querySelector(".hero")
  const track = hero.querySelector("[data-hero-track]")
  const dots = hero.querySelector("[data-hero-dots]")
  let slides = []
  let index = 0
  let timer = 0

  const mark = () => dots.querySelectorAll(".hero__dot").forEach((dot, i) => {
    dot.classList.toggle("is-active", i === index)
    dot.setAttribute("aria-current", String(i === index))
  })
  const go = (next) => {
    if (!slides.length) return
    index = (next + slides.length) % slides.length
    track.scrollTo({ left: index * track.clientWidth })
    mark()
  }
  const stop = () => clearInterval(timer)
  const start = () => {
    stop()
    if (slides.length > 1) timer = setInterval(() => go(index + 1), INTERVAL_MS)
  }

  track.addEventListener("scroll", () => {
    const current = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))
    if (current !== index && current < slides.length) {
      index = current
      mark()
    }
  }, { passive: true })
  hero.addEventListener("click", (event) => {
    const arrow = event.target.closest("[data-hero]")
    const dot = event.target.closest("[data-dot]")
    if (arrow) go(index + (arrow.dataset.hero === "next" ? 1 : -1))
    if (dot) go(Number(dot.dataset.dot))
    if (arrow || dot) start()
  })
  hero.addEventListener("pointerenter", stop)
  hero.addEventListener("pointerleave", start)
  hero.addEventListener("touchstart", stop, { passive: true })
  hero.addEventListener("touchend", start, { passive: true })

  return function render(nextSlides) {
    slides = nextSlides.filter((slide) => slide[layout])
    index = 0
    track.replaceChildren(...slides.map((slide, i) => {
      const link = document.createElement("a")
      link.className = "hero__slide"
      link.href = slide.href || "#"
      if (slide.play) link.dataset.play = slide.play
      else link.dataset.action = slide.action
      const image = document.createElement("img")
      image.src = slide[layout]
      image.alt = slide.alt
      image.draggable = false
      image.decoding = "async"
      if (i > 0) image.loading = "lazy"
      link.append(image)
      return link
    }))
    dots.replaceChildren(...slides.map((slide, i) => {
      const dot = document.createElement("button")
      dot.className = "hero__dot"
      dot.type = "button"
      dot.dataset.dot = String(i)
      dot.setAttribute("aria-label", `第 ${i + 1} 張：${slide.alt}`)
      return dot
    }))
    hero.classList.toggle("is-single", slides.length < 2)
    track.scrollTo({ left: 0 })
    mark()
    start()
  }
}
