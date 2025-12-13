import type { DeepAnalysisResult } from "../hooks/useDeepAnalyze";
import { useLocale } from "../context/LocaleContext";
import type { TranslationKey } from "../i18n";
import "./DeepAnalysis.css";

interface Props {
  result: DeepAnalysisResult;
}

const currencySymbols: Record<string, string> = {
  RUB: "₽",
  EUR: "€",
  USD: "$",
  RSD: " дин",
};

function formatPrice(price: number | null, currency: string | undefined, locale: string): string {
  if (price === null) return "—";
  const symbol = currency ? (currencySymbols[currency] || ` ${currency}`) : " ₽";
  return price.toLocaleString(locale) + symbol;
}

function getVerdictInfo(
  verdict: string,
  t: (key: TranslationKey) => string
): { text: string; className: string } {
  switch (verdict) {
    case "good_deal":
      return { text: t("verdictGood"), className: "verdict-good" };
    case "overpriced":
      return { text: t("verdictBad"), className: "verdict-bad" };
    case "fair":
      return { text: t("verdictFair"), className: "verdict-fair" };
    default:
      return { text: t("verdictUnknown"), className: "verdict-unknown" };
  }
}

function getRiskInfo(
  level: string,
  t: (key: TranslationKey) => string
): { text: string; className: string } {
  switch (level) {
    case "high":
      return { text: t("riskHigh"), className: "risk-high" };
    case "medium":
      return { text: t("riskMedium"), className: "risk-medium" };
    default:
      return { text: t("riskLow"), className: "risk-low" };
  }
}

function getListingTypeLabel(
  type: string,
  t: (key: TranslationKey) => string
): string {
  switch (type) {
    case "sale":
      return t("listingTypeSale");
    case "rent":
      return t("listingTypeRent");
    case "service":
      return t("listingTypeService");
    default:
      return t("listingTypeOther");
  }
}

export function DeepAnalysis({ result }: Props) {
  const { intlLocale, t } = useLocale();

  if (!result.isListing) {
    return (
      <div className="deep-analysis">
        <div className="analysis-not-listing">
          <div className="not-listing-title">{t("notListing")}</div>
          <div className="not-listing-reason">
            {result.notListingReason || t("notListingReason")}
          </div>
        </div>
      </div>
    );
  }

  const riskInfo = getRiskInfo(result.scamRisk.level, t);

  return (
    <div className="deep-analysis">
      {/* Header */}
      <div className="analysis-header">
        <span className="analysis-type">
          {getListingTypeLabel(result.listingType || "other", t)}
        </span>
        <span className={`analysis-risk ${riskInfo.className}`}>
          {t("riskLabel", { text: riskInfo.text, score: result.scamRisk.score })}
        </span>
      </div>

      {/* Scam flags */}
      {result.scamRisk.flags.length > 0 && (
        <div className="scam-flags">
          <div className="flags-label">{t("flagsLabel")}</div>
          <div className="flags-list">
            {result.scamRisk.flags.map((flag, i) => (
              <span key={i} className="flag-badge">{flag}</span>
            ))}
          </div>
        </div>
      )}

      {/* Scam recommendation */}
      <div className="scam-recommendation">
        {result.scamRisk.recommendation}
      </div>

      {/* Items table */}
      {result.items.length > 0 && (
        <div className="items-section">
          <div className="items-header">{t("itemsSection")}</div>
          <div className="items-table">
            <div className="table-header">
              <span className="col-name">{t("itemName")}</span>
              <span className="col-price">{t("itemPrice")}</span>
              <span className="col-market">{t("itemMarket")}</span>
              <span className="col-verdict">{t("itemVerdict")}</span>
            </div>
            {result.items.map((item, i) => {
              const verdictInfo = getVerdictInfo(item.priceVerdict, t);
              return (
                <div key={i} className="table-row">
                  <span className="col-name" title={item.name}>
                    {item.name.slice(0, 25)}
                  </span>
                  <span className="col-price">
                    {item.extractedPrice || "—"}
                  </span>
                  <span className="col-market">
                    {item.marketPriceAvg ? `~${formatPrice(item.marketPriceAvg, item.marketCurrency ?? undefined, intlLocale)}` : "—"}
                  </span>
                  <span className={`col-verdict ${verdictInfo.className}`}>
                    {verdictInfo.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Not worth buying warnings */}
      {result.items.filter(i => !i.worthBuying).length > 0 && (
        <div className="not-worth-section">
          <div className="not-worth-header">{t("notRecommended")}</div>
          {result.items.filter(i => !i.worthBuying).map((item, i) => (
            <div key={i} className="not-worth-item">
              <strong>{item.name}:</strong> {item.worthBuyingReason}
            </div>
          ))}
        </div>
      )}

      {/* Price sources */}
      {result.items.some(i => i.sources.length > 0) && (
        <div className="sources-section">
          <div className="sources-header">{t("priceSources")}</div>
          {result.items.flatMap(i => i.sources).filter(s => s.price).slice(0, 5).map((src, i) => (
            <a
              key={i}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              {src.title.slice(0, 50)}: {src.price}
            </a>
          ))}
        </div>
      )}

      {/* Overall verdict */}
      <div className="overall-verdict">
        <div className="verdict-header">{t("overallVerdict")}</div>
        <div className="verdict-text">{result.overallVerdict}</div>
      </div>

      {/* Similar items */}
      {result.similarItems.length > 0 && (
        <div className="similar-section">
          <div className="similar-header">{t("similarInHistory")}</div>
          {result.similarItems.map((item, i) => (
            <a
              key={i}
              href={item.link || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="similar-item similar-item-link"
            >
              <span className="similar-text">{item.text}</span>
              <span className="similar-price">{formatPrice(item.price, item.currency ?? undefined, intlLocale)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
