import { t, isRTL } from "../i18n.js";
import { printTerms } from "../bridge.js";
import { openModal } from "../modal.js";
import { INTRO, SECTIONS } from "../terms-text.js";
import { h } from "../lib/dom.js";

export function openTerms() {
  return openModal({
    label: t("Terms of service"),
    build: (body) => {
      const article = h(
        "article",
        { class: "cn-terms" },
        h("p", { class: "t-prose", text: t(INTRO) }),
        ...SECTIONS.flatMap((section, i) => [
          h("h2", { class: "t-prose-h", text: i + 1 + ". " + t(section.heading) }),
          ...section.body.map((copy) => h("p", { class: "t-prose", text: t(copy) })),
        ]),
      );
      const print = h("button", {
        type: "button",
        class: "cn-mini",
        text: t("Print"),
        onclick: () =>
          printTerms({
            title: t("Terms of service"),
            intro: t(INTRO),
            rtl: isRTL(),
            sections: SECTIONS.map((section) => ({
              heading: t(section.heading),
              paragraphs: section.body.map((copy) => t(copy)),
            })),
          }),
      });
      body.append(article, h("div", { class: "cn-terms-tools" }, print));
    },
  });
}
