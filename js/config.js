/* Static configuration & copy. window.AITOP namespace; classic script (no
   modules — must run from file://). */
window.AITOP = window.AITOP || {};
window.AITOP.config = {
  MOBILE_BREAKPOINT: 767.98,
  SUMMARY_TRUNCATE: 120,
  SEARCH_DEBOUNCE_MS: 180,

  // Brand title/pill copy is rendered literally per the spec; all counts are
  // data-driven from window.DASHBOARD_DATA.
  TITLE: "AI Top 25",
  SUBTITLE: "The Definitive Ranking of AI Maturity in Wholesale Distribution",
  INTRO: "Distribution Strategy Group's evidence-based assessment of how North " +
         "America's leading wholesale distributors are deploying artificial " +
         "intelligence — who leads, how verticals compare, and what AI maturity " +
         "actually looks like.",

  CHART_TITLE: "AI Maturity by Distribution Vertical",
  METHOD_TITLE: "Methodology & Maturity Tiers",
  METHOD_NOTE: "Ranking reflects a composite score across three independent " +
               "industry source models. Maturity tier is a separate, evidence-" +
               "based assessment of how deeply AI is embedded — it does not " +
               "determine rank.",

  DETAIL_CTA_TEXT: "Read the full company profile in the AI Top 50 Report →",
  DETAIL_CTA_URL: "https://www.distributionstrategy.com/ai-top-50-report",
  FOOTER_DOWNLOAD_TEXT: "Download the full AI Top 50 Report",
  FOOTER_DOWNLOAD_URL: "https://www.distributionstrategy.com/ai-top-50-report",
  FOOTER_CONTACT_TEXT: "Contact Distribution Strategy Group",
  FOOTER_CONTACT_MAILTO: "mailto:info@distributionstrategy.com" +
                         "?subject=AI%20Top%2050%20Report",
  ORG: "Distribution Strategy Group",
  PHASE_TEASER: "Phase 1 (Top 25) shown. The full Top 50, including the " +
                "complete maturity breakdown, is in the gated report.",
};
