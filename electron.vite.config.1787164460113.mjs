// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "C:\\Users\\minhl\\OneDrive\\Desktop\\Robo\\KiboEyeStudio";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "electron/main/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "electron/preload/index.ts")
      }
    }
  },
  renderer: {
    root: ".",
    resolve: {
      alias: {
        "@": resolve(__electron_vite_injected_dirname, "src")
      }
    },
    // This repo lives under OneDrive, which dehydrates some node_modules/.vite/deps chunk files to
    // cloud-only, so Vite fails with "The file does not exist ... which is in the optimize deps
    // directory". force:true re-optimizes deps on every dev start instead of trusting that cache,
    // which self-heals the error. (Real fix: pin node_modules to "Always keep on this device", or
    // move the repo out of OneDrive — see README / IMPORTANT notes.)
    optimizeDeps: {
      force: true
    },
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "index.html")
      }
    },
    plugins: [react()]
  }
});
export {
  electron_vite_config_default as default
};
