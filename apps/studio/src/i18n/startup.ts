import { englishCatalog as EN } from "@reading-studio/contracts/i18n"
import type { Plugin } from "vite"

export type StartupCatalog = Pick<
  typeof EN,
  | "startup.title"
  | "startup.description"
  | "startup.loading"
  | "startup.noscript.title"
  | "startup.noscript.body"
  | "startup.noscript.link"
>

export function startupPlugin(catalog: StartupCatalog = EN): Plugin {
  const values = {
    TITLE: catalog["startup.title"],
    DESCRIPTION: catalog["startup.description"],
    LOADING: catalog["startup.loading"],
    NOSCRIPT_TITLE: catalog["startup.noscript.title"],
    NOSCRIPT_BODY: catalog["startup.noscript.body"],
    NOSCRIPT_LINK: catalog["startup.noscript.link"],
  }
  return {
    name: "catalog-startup",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        Object.entries(values).reduce(
          (output, [key, value]) =>
            output.replaceAll(
              `__UI_${key}__`,
              value
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#39;"),
            ),
          html,
        ),
    },
  }
}
