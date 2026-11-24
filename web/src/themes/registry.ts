import { ModernDetails } from "./modern/Details";
import { MetapiChrome } from "./metapi/Chrome";
import type { UIThemeId, UIThemePackage } from "./types";

export const UI_THEMES: Record<UIThemeId, UIThemePackage> = {
  metapi: {
    id: "metapi",
    version: "1.0.0",
    apiVersion: 1,
    Chrome: MetapiChrome,
    Details: ModernDetails,
    channelDetails: "drawer",
  },
};
