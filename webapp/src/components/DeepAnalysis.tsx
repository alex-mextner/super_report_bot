import type { DeepAnalysisResult } from "../hooks/useDeepAnalyze";
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

function formatPrice(price: number | null, currency?: string): string {
  if (price === null) return "—";
  const symbol = currency ? (currencySymbols[currency] || ` ${currency}`) : " ₽";
  return price.toLocaleString("ru-RU") + symbol;
}

function getVerdictInfo(verdict: string): { text: string; className: string } {
  switch (verdict) {
    case "good_deal":
      return { text: "✅ Выгодно", className: "verdict-good" };
    case "overpriced":
      return { text: "❌ Дорого", className: "verdict-bad" };
    case "fair":
      return { text: "👍 Норм", className: "verdict-fair" };
    default:
      return { text: "❓", className: "verdict-unknown" };
  }
}

function getRiskInfo(level: string): { text: string; className: string } {
  switch (level) {
    case "high":
      return { text: "Высокий", className: "risk-high" };
    case "medium":
      return { text: "Средний", className: "risk-medium" };
    default:
      return { text: "Низкий", className: "risk-low" };
  }
}

const listingTypeLabels: Record<string, string> = {
  sale: "Продажа",
  rent: "Аренда",
  service: "Услуга",
  other: "Другое",
};

export function DeepAnalysis({ result }: Props) {
  if (!result.isListing) {
    return (
      <div className="deep-analysis">
        <div className="analysis-not-listing">
          <div className="not-listing-title">❌ Это не объявление</div>
          <div className="not-listing-reason">
            {result.notListingReason || "Не удалось определить тип"}
          </div>
        </div>
      </div>
    );
  }

  const riskInfo = getRiskInfo(result.scamRisk.level);

  return (
    <div className="deep-analysis">
      {/* Header */}
      <div className="analysis-header">
        <span className="analysis-type">
          {listingTypeLabels[result.listingType || "other"] || "Объявление"}
        </span>
        <span className={`analysis-risk ${riskInfo.className}`}>
          Риск: {riskInfo.text} ({result.scamRisk.score}/100)
        </span>
      </div>

      {/* Scam flags */}
      {result.scamRisk.flags.length > 0 && (
        <div className="scam-flags">
          <div className="flags-label">⚠️ Флаги:</div>
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
          <div className="items-header">📋 Товары/услуги</div>
          <div className="items-table">
            <div className="table-header">
              <span className="col-name">Товар</span>
              <span className="col-price">Цена</span>
              <span className="col-market">Рынок</span>
              <span className="col-verdict">Оценка</span>
            </div>
            {result.items.map((item, i) => {
              const verdictInfo = getVerdictInfo(item.priceVerdict);
              return (
                <div key={i} className="table-row">
                  <span className="col-name" title={item.name}>
                    {item.name.slice(0, 25)}
                  </span>
                  <span className="col-price">
                    {item.extractedPrice || "—"}
                  </span>
                  <span className="col-market">
                    {item.marketPriceAvg ? `~${formatPrice(item.marketPriceAvg, item.marketCurrency ?? undefined)}` : "—"}
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
          <div className="not-worth-header">🚫 Не рекомендуется</div>
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
          <div className="sources-header">🔗 Источники цен</div>
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
        <div className="verdict-header">📝 Итог</div>
        <div className="verdict-text">{result.overallVerdict}</div>
      </div>

      {/* Similar items */}
      {result.similarItems.length > 0 && (
        <div className="similar-section">
          <div className="similar-header">📚 Похожие в истории</div>
          {result.similarItems.map((item, i) => (
            <a
              key={i}
              href={item.link || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="similar-item similar-item-link"
            >
              <span className="similar-text">{item.text}</span>
              <span className="similar-price">{formatPrice(item.price, item.currency ?? undefined)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
