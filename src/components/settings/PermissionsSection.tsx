import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Section } from "./SectionWrapper";
import {
  KeychainPermRow,
  type KeychainStatus,
} from "../onboarding/PermissionsStep";

function PermissionsContent() {
  const [keychainStatus, setKeychainStatus] = useState<KeychainStatus>("unknown");

  const keychainStatusRef = useRef(keychainStatus);
  useEffect(() => { keychainStatusRef.current = keychainStatus; }, [keychainStatus]);

  async function probeKeychain(allowProbe: boolean) {
    try {
      const res = await invoke<{ state: string }>("check_keychain_access", { allowProbe });
      setKeychainStatus(res.state as KeychainStatus);
    } catch {
      setKeychainStatus("unknown");
    }
  }

  useEffect(() => {
    probeKeychain(false);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused && !cancelled) probeKeychain(false);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleKeychainGrant() {
    try {
      const res = await invoke<{ state: string }>("check_keychain_access", { allowProbe: true });
      setKeychainStatus(res.state as KeychainStatus);
    } catch {
      setKeychainStatus("unknown");
    }
  }

  return (
    <KeychainPermRow
      status={keychainStatus}
      onGrant={handleKeychainGrant}
    />
  );
}

export function SectionPermissions() {
  const { t } = useTranslation("settings");
  return (
    <Section
      title={t("section_permissions.title")}
      description={t("section_permissions.description")}
    >
      <PermissionsContent />
    </Section>
  );
}
