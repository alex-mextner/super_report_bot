import { useState, useEffect } from "react";
import "./SearchBar.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: Props) {
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
  );
}
