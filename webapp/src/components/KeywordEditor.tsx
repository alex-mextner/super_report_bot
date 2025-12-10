import { useState } from "react";
import "./KeywordEditor.css";

interface Props {
  keywords: string[];
  type: "positive" | "negative";
  onChange: (keywords: string[]) => void;
}

export function KeywordEditor({ keywords, type, onChange }: Props) {
  const [newKeyword, setNewKeyword] = useState("");

  const handleAdd = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (kw && !keywords.includes(kw)) {
      onChange([...keywords, kw]);
      setNewKeyword("");
    }
  };

  const handleRemove = (kw: string) => {
    onChange(keywords.filter((k) => k !== kw));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="keyword-editor">
      <div className="keyword-tags">
        {keywords.map((kw) => (
          <span key={kw} className={`keyword-tag ${type}`}>
            {kw}
            <button className="keyword-remove" onClick={() => handleRemove(kw)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="keyword-input-row">
        <input
          type="text"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={type === "positive" ? "Добавить слово..." : "Добавить исключение..."}
          className="keyword-input"
        />
        <button onClick={handleAdd} className="keyword-add-btn" disabled={!newKeyword.trim()}>
          +
        </button>
      </div>
    </div>
  );
}
