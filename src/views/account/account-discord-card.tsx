import { useState } from "react";
import { Loader2 } from "@/views/settings/icons";
import { DiscordIcon } from "@/components/discord-icon";
import { canLinkDiscord, linkDiscord, unlinkDiscord } from "@/lib/account/discord-link";
import { accountErrorMessage, type AccountErrorMessage } from "@/lib/account/error-messages";
import { useAccountCapabilities } from "@/hooks/use-account-capabilities";
import type { Author } from "@/lib/theme-auth";
import { useT } from "@/lib/i18n";
import { SettingRow } from "@/views/settings/kit";
import { SButton } from "@/views/settings/ui";

export function AccountDiscordCard({
  author,
  onRecovery,
}: {
  author: Author;
  onRecovery: (code: string) => void;
}) {
  const t = useT();
  const caps = useAccountCapabilities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountErrorMessage | null>(null);

  if (!caps.discord) return null;

  const linked = !!(author.discordLinkMethod || author.discordUsername);
  const desktop = canLinkDiscord();

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const link = () => run(linkDiscord);
  const unlink = () =>
    run(async () => {
      const { recoveryCode } = await unlinkDiscord();
      if (recoveryCode) onRecovery(recoveryCode);
    });

  const desc = linked
    ? author.discordUsername
      ? t("Linked as {name}.", { name: author.discordUsername })
      : t("Linked to your Discord account.")
    : desktop
      ? t("Link Discord to get your recovery key in a message and join the Compass server.")
      : t("Open Compass on desktop to link Discord.");

  return (
    <SettingRow
      label={t("Discord account")}
      desc={desc}
      icon={<DiscordIcon className="h-[18px] w-[18px]" />}
    >
      {(linked || desktop) && (
        <div className="flex flex-col items-end gap-2">
          {linked ? (
            <SButton variant="danger" onClick={unlink} disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {t("Unlink")}
            </SButton>
          ) : (
            <SButton variant="primary" onClick={link} disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? t("Continue in your browser...") : t("Link Discord")}
            </SButton>
          )}
          {error && (
            <span role="alert" className="max-w-[320px] text-end text-[13px] text-danger">
              {error.kind === "built-in" ? t(error.key) : error.detail}
            </span>
          )}
        </div>
      )}
    </SettingRow>
  );
}
