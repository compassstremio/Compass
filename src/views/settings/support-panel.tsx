import { ArrowUpRight, Heart } from "./icons";
import type { ReactNode } from "react";
import stremioLogo from "@/assets/stremio.png";
import amfIcon from "@/assets/support/amf.png";
import charityNavigatorIcon from "@/assets/support/charity-navigator.png";
import effIcon from "@/assets/support/eff.png";
import ehsanIcon from "@/assets/support/ehsan.svg";
import internetArchiveIcon from "@/assets/support/internet-archive.png";
import msfIcon from "@/assets/support/msf.png";
import nationalPcfIcon from "@/assets/support/nationalpcf.png";
import stJudeIcon from "@/assets/support/stjude.png";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";
import { badgeIconUrl } from "@/views/profile/badge-catalog";
import { SettingRow } from "./kit";
import { ROW_DESC, Section } from "./shared";
import { SButton, SRow } from "./ui";

const STREMIO_DONATE = "https://www.stremio.com/donate";

const KOFI_DONATE = "https://ko-fi.com/compass_sio";

const CHARITY_NAVIGATOR = "https://www.charitynavigator.org/";

const CHARITIES = [
  {
    name: "Ehsan (إحسان)",
    url: "https://ehsan.sa/",
    icon: ehsanIcon,
    blurb: "Saudi Arabia's national platform for charitable giving, with licensed charities and projects.",
  },
  {
    name: "St. Jude Children's Research Hospital",
    url: "https://www.stjude.org",
    icon: stJudeIcon,
    blurb:
      "Childhood cancer research and treatment. Families are never billed for care, travel, housing, or food.",
  },
  {
    name: "National Pediatric Cancer Foundation",
    url: "https://nationalpcf.org",
    icon: nationalPcfIcon,
    blurb: "Funds research into less toxic, more targeted treatments for childhood cancer.",
  },
  {
    name: "Electronic Frontier Foundation",
    url: "https://www.eff.org",
    icon: effIcon,
    blurb:
      "Defends privacy, free expression, and the open internet, in the courts and in the code.",
  },
  {
    name: "Internet Archive",
    url: "https://archive.org/donate",
    icon: internetArchiveIcon,
    blurb: "Keeps the web's memory alive. Compass would be poorer without it.",
  },
  {
    name: "Doctors Without Borders",
    url: "https://www.doctorswithoutborders.org/",
    icon: msfIcon,
    blurb: "Emergency medical care in crisis zones, independent of politics.",
  },
  {
    name: "Against Malaria Foundation",
    url: "https://www.againstmalaria.com/",
    icon: amfIcon,
    blurb: "Insecticide-treated nets. One of the most cost-effective interventions measured.",
  },
];

const LEAD_IMG = "h-[22px] w-[22px] shrink-0 object-contain";
const LEAD_ICON = "shrink-0 text-ink-subtle";
const CHARITY_IMG = "h-9 w-9 shrink-0 rounded-[9px] object-cover";

function OutArrow() {
  return (
    <ArrowUpRight
      size={18}
      strokeWidth={2.2}
      className="shrink-0 text-ink-subtle rtl:-scale-x-100"
    />
  );
}

function OpenButton({ label, url, primary }: { label: string; url: string; primary?: boolean }) {
  return (
    <SButton variant={primary ? "primary" : "secondary"} onClick={() => openUrl(url)}>
      {label}
      <ArrowUpRight size={17} strokeWidth={2.2} className="shrink-0 rtl:-scale-x-100" />
    </SButton>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className={`max-w-[70ch] ${ROW_DESC}`}>{children}</p>;
}

function Callout({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-elevated px-4 py-3">
      {icon}
      <p className={`max-w-[66ch] ${ROW_DESC}`}>{children}</p>
    </div>
  );
}

export function SupportPanel() {
  const t = useT();
  return (
    <>
      <Section
        title={t("Built on Stremio")}
        subtitle={t(
          "Compass would not be possible without Stremio. It is the foundation everything here is built on.",
        )}
      >
        <Prose>
          {t(
            "Compass speaks Stremio's addon protocol, and the whole ecosystem of addons grows out of their work. Stremio is funded by its community, and supporters who chip in get early access to experimental features. If you have it to spare, send some their way too.",
          )}
        </Prose>
        <Callout
          icon={
            <img
              src={badgeIconUrl("stremio_supporter")}
              alt=""
              draggable={false}
              className="mt-[1px] h-5 w-5 shrink-0 object-contain"
            />
          }
        >
          {t("Stremio Supporters get a special badge on their Compass profile.")}
        </Callout>
        <SettingRow
          icon={<img src={stremioLogo} alt="" draggable={false} className={LEAD_IMG} />}
          label={t("Support Stremio")}
          desc={t("Opens Stremio's donation page in your browser.")}
        >
          <OpenButton label={t("Donate")} url={STREMIO_DONATE} primary />
        </SettingRow>
      </Section>

      <Section
        title={t("Donating to Compass")}
        subtitle={t("Donations are optional. Compass is free to use either way.")}
      >
        <Prose>
          {t(
            "If you would like to support Compass directly, you can do it on Ko-fi. If you would rather give elsewhere, send it to Stremio above, or to one of the charities below. They all do more good with it.",
          )}
        </Prose>
        <SettingRow
          icon={<Heart size={22} strokeWidth={2} className={LEAD_ICON} />}
          label={t("Support Compass")}
          desc={t("Opens the Compass Ko-fi page in your browser.")}
        >
          <OpenButton label={t("Donate")} url={KOFI_DONATE} primary />
        </SettingRow>
      </Section>

      <Section
        title={t("Badges for giving")}
        subtitle={t(
          "Support Stremio, or give to any charity below, and the badge lands on your profile.",
        )}
      >
        <SRow
          leading={
            <img src={badgeIconUrl("donator")} alt="" draggable={false} className={LEAD_IMG} />
          }
          title={t("Charity")}
          description={t("For donating to a charity.")}
        />
        <SRow
          leading={
            <img src={badgeIconUrl("top_donator")} alt="" draggable={false} className={LEAD_IMG} />
          }
          title={t("Charity $100+")}
          description={t("For giving more than $100 to charity.")}
        />
      </Section>

      <Section
        title={t("If you would rather give it away")}
        subtitle={t(
          "No affiliation, no referral links, and Compass gets nothing from these. They are just places where money goes further than it does here.",
        )}
      >
        {CHARITIES.map((c) => (
          <SRow
            key={c.url}
            leading={<img src={c.icon} alt="" draggable={false} className={CHARITY_IMG} />}
            leadSize="lg"
            title={c.name}
            description={t(c.blurb)}
            onClick={() => openUrl(c.url)}
            trailing={<OutArrow />}
          />
        ))}
        <SRow
          leading={
            <img src={charityNavigatorIcon} alt="" draggable={false} className={CHARITY_IMG} />
          }
          leadSize="lg"
          title={t("Charity Navigator")}
          description={t("Look any of them up before you give, or find a cause of your own.")}
          onClick={() => openUrl(CHARITY_NAVIGATOR)}
          trailing={<OutArrow />}
        />
      </Section>
    </>
  );
}
