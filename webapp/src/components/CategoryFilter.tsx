import type { Category } from "../types";
import "./CategoryFilter.css";

interface Props {
  categories: Category[];
  selected: string | null;
  onSelect: (code: string | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: Props) {
  return (
    <div className="category-filter">
      <button
        className={`category-btn ${selected === null ? "active" : ""}`}
        onClick={() => onSelect(null)}
      >
        Все
      </button>
      {categories.map((cat) => (
        <button
          key={cat.code}
          className={`category-btn ${selected === cat.code ? "active" : ""}`}
          onClick={() => onSelect(cat.code)}
        >
          {cat.name_ru}
        </button>
      ))}
    </div>
  );
}
