import "./KeywordsDisplay.css";

interface Props {
  positive: string[];
  negative: string[];
  maxShow?: number;
}

export function KeywordsDisplay({ positive, negative, maxShow = 10 }: Props) {
  return (
    <div className="keywords-display">
      <div className="keywords-row">
        <span className="keywords-label">+</span>
        <div className="keywords-list positive">
          {positive.slice(0, maxShow).map((kw, i) => (
            <span key={i} className="keyword-badge">
              {kw}
            </span>
          ))}
          {positive.length > maxShow && (
            <span className="keywords-more">+{positive.length - maxShow}</span>
          )}
        </div>
      </div>
      {negative.length > 0 && (
        <div className="keywords-row">
          <span className="keywords-label">−</span>
          <div className="keywords-list negative">
            {negative.slice(0, maxShow).map((kw, i) => (
              <span key={i} className="keyword-badge">
                {kw}
              </span>
            ))}
            {negative.length > maxShow && (
              <span className="keywords-more">+{negative.length - maxShow}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
