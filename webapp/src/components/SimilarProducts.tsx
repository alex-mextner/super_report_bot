import { useNavigate } from "react-router-dom";
import type { SimilarProduct } from "../types";
import { useLocale } from "../context/LocaleContext";
import type { TranslationKey } from "../i18n";
import "./SimilarProducts.css";

interface Props {
  products: SimilarProduct[];
  loading: boolean;
}

function formatPriceDiff(
  diff: number | null,
  locale: string,
  t: (key: TranslationKey) => string
): string | null {
  if (diff === null) return null;
  if (diff === 0) return t("samePrice");
  if (diff > 0) return `+${diff.toLocaleString(locale)} ₽`;
  return `${diff.toLocaleString(locale)} ₽`;
}

export function SimilarProducts({ products, loading }: Props) {
  const navigate = useNavigate();
  const { intlLocale, t } = useLocale();

  if (loading) {
    return (
      <div className="similar-products">
        <h3 className="similar-title">{t("similarProducts")}</h3>
        <div className="similar-loading">{t("loading")}</div>
      </div>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <div className="similar-products">
      <h3 className="similar-title">{t("similarProducts")}</h3>
      <div className="similar-list">
        {products.map((product) => (
          <div
            key={product.id}
            className="similar-card"
            onClick={() => navigate(`/product/${product.id}`)}
          >
            <p className="similar-text">
              {product.text.length > 100
                ? product.text.slice(0, 100) + "..."
                : product.text}
            </p>
            <div className="similar-footer">
              {product.price_raw && (
                <span className="similar-price">{product.price_raw}</span>
              )}
              {formatPriceDiff(product.priceDiff, intlLocale, t) && (
                <span
                  className={`similar-diff ${
                    product.priceDiff! > 0 ? "diff-more" : "diff-less"
                  }`}
                >
                  {formatPriceDiff(product.priceDiff, intlLocale, t)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
