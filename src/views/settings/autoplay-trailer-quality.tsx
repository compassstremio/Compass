import { Dropdown } from "@/components/dropdown";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import type { TrailerQualityPref } from "@/lib/trailer";
import { Film } from "./icons";
import { SettingRow } from "./kit";

export function AutoplayTrailerQuality() {
  const { settings, update } = useSettings();
  const t = useT();
  return (
    <SettingRow
      icon={<Film size={18} strokeWidth={2} />}
      label={t("Autoplay trailer resolution")}
      desc={t("Resolution for trailers that play automatically on Home and detail pages. Higher resolutions may take longer to start.")}
    >
      <div className="w-[280px] max-w-full">
        <Dropdown
          size="md"
          value={settings.autoplayTrailerQuality}
          onChange={(value) => update({ autoplayTrailerQuality: value as TrailerQualityPref })}
          options={[
            { value: "auto", label: t("Auto") },
            { value: "360p", label: "360p" },
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" },
            { value: "best", label: t("Best") },
          ]}
        />
      </div>
    </SettingRow>
  );
}
