import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import enOnboarding from "./locales/en/onboarding.json";
import enSettings from "./locales/en/settings.json";
import enFindings from "./locales/en/findings.json";
import enTabs from "./locales/en/tabs.json";

import trCommon from "./locales/tr/common.json";
import trOnboarding from "./locales/tr/onboarding.json";
import trSettings from "./locales/tr/settings.json";
import trFindings from "./locales/tr/findings.json";
import trTabs from "./locales/tr/tabs.json";

export type AppLocale = "en" | "tr";

i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "onboarding", "settings", "findings", "tabs"],
  defaultNS: "common",
  resources: {
    en: {
      common: enCommon,
      onboarding: enOnboarding,
      settings: enSettings,
      findings: enFindings,
      tabs: enTabs,
    },
    tr: {
      common: trCommon,
      onboarding: trOnboarding,
      settings: trSettings,
      findings: trFindings,
      tabs: trTabs,
    },
  },
  interpolation: {
    escapeValue: false,
  },
});

export default i18next;
