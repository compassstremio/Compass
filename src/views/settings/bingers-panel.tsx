import { useEffect, useState } from "react";
import bingersLogo from "@/assets/bingers.png";
import { BingersDeviceModal } from "@/components/bingers/bingers-device-modal";
import { BINGERS_INTEGRATIONS_URL, BINGERS_WEBSITE } from "@/lib/bingers/config";
import { useBingers } from "@/lib/bingers/provider";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";
import { ExternalLink, LogOut } from "./icons";
import { ModalButton, ROW_ACTION_DANGER, ROW_DESC, SettingRow, SettingsModal } from "./kit";
import { Section, ToggleRow } from "./shared";
import { TrackerConnect } from "./tracker-connect";
import { TrackerIdentity } from "./tracker-identity";
import { SButton } from "./ui";

export function BingersPanel() {
  const t = useT();
  const { isConnected, session, access, disconnect, refreshAccount } = useBingers();
  const { settings, update } = useSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Opening the panel re-asks the API, so a plan bought since the last check shows up.
  useEffect(() => {
    if (isConnected) void refreshAccount();
  }, [isConnected, refreshAccount]);

  if (!isConnected || !session) {
    return (
      <>
        <Section title={t("Connect your Bingers account")} bare>
          <TrackerConnect
            service="Bingers"
            logo={bingersLogo}
            description={t(
              "Marks the episodes and movies you finish in Compass as watched on Bingers. Connect with a short code at bingers.app. Bingers opens its API to Legend and Icon members.",
            )}
            onConnect={() => setModalOpen(true)}
            website={BINGERS_WEBSITE}
          />
        </Section>
        {modalOpen && <BingersDeviceModal onClose={() => setModalOpen(false)} />}
      </>
    );
  }

  return (
    <Section
      title={t("Your Bingers account")}
      subtitle={t("Compass marks episodes and movies watched on Bingers once you finish them.")}
    >
      <TrackerIdentity
        logo={bingersLogo}
        service="Bingers"
        handle={session.handle ?? undefined}
        meta={session.name && session.name !== session.handle ? session.name : undefined}
        onDisconnect={() => setConfirmDisconnect(true)}
      />

      {access === "plan-required" && (
        <p
          role="status"
          className={`rounded-[10px] border border-danger/30 bg-danger/5 px-4 py-3 ${ROW_DESC}`}
        >
          {t(
            "Bingers is turning Compass away because this account has no Legend or Icon plan. Subscribe in the Bingers app under Profile › Settings › Support Bingers, and watches start syncing once the plan is active.",
          )}
        </p>
      )}
      {access === "reauth" && (
        <p
          role="status"
          className={`rounded-[10px] border border-danger/30 bg-danger/5 px-4 py-3 ${ROW_DESC}`}
        >
          {t(
            "This connection can read your Bingers library but not change it. Disconnect, then connect again and allow changes.",
          )}
        </p>
      )}

      <ToggleRow
        label={t("Mark finished items watched on Bingers")}
        sub={t("Sends one watch when you get through 90% of an episode or movie.")}
        value={settings.bingersScrobbleEnabled !== false}
        onChange={(on) => update({ bingersScrobbleEnabled: on })}
      />

      <SettingRow
        label={t("Connected apps on Bingers")}
        desc={t(
          "Disconnecting forgets the sign-in on this device. To revoke Compass's access completely, remove it from your connected apps on bingers.app.",
        )}
      >
        <SButton onClick={() => openUrl(BINGERS_INTEGRATIONS_URL)}>
          {t("Open bingers.app")}
          <ExternalLink size={15} />
        </SButton>
      </SettingRow>

      <SettingsModal
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title={t("Disconnect from Bingers")}
        actions={
          <>
            <ModalButton ghost onClick={() => setConfirmDisconnect(false)}>
              {t("Cancel")}
            </ModalButton>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setConfirmDisconnect(false);
              }}
              className={ROW_ACTION_DANGER}
            >
              <LogOut size={18} strokeWidth={2.2} />
              {t("Disconnect")}
            </button>
          </>
        }
      >
        <p className={`max-w-[66ch] ${ROW_DESC}`}>
          {t("Disconnect Bingers? Compass stops marking what you watch until you reconnect.")}
        </p>
      </SettingsModal>
    </Section>
  );
}
