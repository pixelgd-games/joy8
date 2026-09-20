import { defineConfig } from "vite"
import { resolve } from "path"

const canonicalHostRedirect = {
  name: "joy8-canonical-host",
  transformIndexHtml() {
    return [{
      tag: "script",
      attrs: { src: "/canonical-host.js" },
      injectTo: "head-prepend",
    }]
  },
}

export default defineConfig({
  plugins: [canonicalHostRedirect],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        game: resolve(__dirname, "game/index.html"),
        brandedEntry: resolve(__dirname, "entry/index.html"),
        privateGame: resolve(__dirname, "play-test/index.html"),
        account: resolve(__dirname, "account/index.html"),
        adminLogin: resolve(__dirname, "admin/login/index.html"),
        adminGames: resolve(__dirname, "admin/games/index.html"),
        adminGamesNew: resolve(__dirname, "admin/games/new/index.html"),
        adminGamesEdit: resolve(__dirname, "admin/games/edit/index.html"),
      },
    },
  },
})
