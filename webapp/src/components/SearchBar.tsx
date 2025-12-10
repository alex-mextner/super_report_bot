import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "./SearchBar.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  selectedGroupId?: number | null;
}

export function SearchBar({ value, onChange, selectedGroupId }: Props) {
  const [input, setInput] = useState(value);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(input);
    }, 300);

    return () => clearTimeout(timer);
  }, [input, onChange]);

  return (
    <div className="search-bar">
      <div className="search-input-wrapper">
        <input
          type="text"
          placeholder="Поиск..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="search-input"
        />
        {input && (
          <button
            className="search-clear"
            onClick={() => {
              setInput("");
              onChange("");
            }}
          >
            &times;
          </button>
        )}
      </div>
      {selectedGroupId && (
        <Link to={`/analytics/${selectedGroupId}`} className="analytics-btn" title="Аналитика группы">
          📊
        </Link>
      )}
    </div>
  );
}
