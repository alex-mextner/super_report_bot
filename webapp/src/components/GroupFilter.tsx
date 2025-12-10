import type { Group } from "../hooks/useGroups";
import "./GroupFilter.css";

interface Props {
  groups: Group[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

export function GroupFilter({ groups, selected, onSelect }: Props) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="group-filter">
      {groups.map((group) => (
        <button
          key={group.id}
          className={`group-btn ${selected === group.id ? "active" : ""}`}
          onClick={() => onSelect(group.id)}
        >
          {group.title} ({group.count})
        </button>
      ))}
    </div>
  );
}
