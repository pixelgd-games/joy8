import { defineConfig } from "vite"
import { resolve } from "path"

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        game: resolve(__dirname, "game/index.html"),
        account: resolve(__dirname, "account/index.html"),
        adminLogin: resolve(__dirname, "admin/login/index.html"),
        adminGames: resolve(__dirname, "admin/games/index.html"),
        adminGamesNew: resolve(__dirname, "admin/games/new/index.html"),
        adminGamesEdit: resolve(__dirname, "admin/games/edit/index.html"),
      },
    },
  },
})
