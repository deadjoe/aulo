import { Filter, Heart, LayoutList, ListFilter, Search } from "lucide-react";
import Dropdown from "./Dropdown";
import {
  activeFilterCount,
  LAYOUT_LABELS,
  SORT_LABELS,
  type Filters,
  type Layout,
  type Sort,
  type ViewOptions,
} from "../lib/view";

const FILTER_LABELS: Record<keyof Filters, string> = {
  liked: "Liked",
  instrumental: "Instrumental",
  vocals: "With vocals",
};

export default function LibraryToolbar({
  view,
  onChange,
  sortable = true,
}: {
  view: ViewOptions;
  onChange: (view: ViewOptions) => void;
  sortable?: boolean;
}) {
  const count = activeFilterCount(view.filters);
  const toggle = (key: keyof Filters) =>
    onChange({
      ...view,
      filters: { ...view.filters, [key]: !view.filters[key] },
    });
  return (
    <div className="library-toolbar">
      <label className="search">
        <Search size={16} />
        <input
          aria-label="Search your songs"
          placeholder="Search"
          value={view.query}
          onChange={(e) => onChange({ ...view, query: e.target.value })}
        />
      </label>
      <Dropdown<keyof Filters>
        label={count ? `Filters (${count})` : "Filters"}
        icon={<Filter size={15} />}
        active={count > 0}
        multiple
        options={(Object.keys(FILTER_LABELS) as (keyof Filters)[]).map(
          (value) => ({ value, label: FILTER_LABELS[value] }),
        )}
        selected={(Object.keys(view.filters) as (keyof Filters)[]).filter(
          (key) => view.filters[key],
        )}
        onSelect={toggle}
      />
      {sortable && (
        <Dropdown<Sort>
          label={SORT_LABELS[view.sort]}
          icon={<ListFilter size={15} />}
          options={(Object.keys(SORT_LABELS) as Sort[]).map((value) => ({
            value,
            label: SORT_LABELS[value],
          }))}
          selected={[view.sort]}
          onSelect={(sort) => onChange({ ...view, sort })}
        />
      )}
      <Dropdown<Layout>
        label={LAYOUT_LABELS[view.layout]}
        icon={<LayoutList size={15} />}
        options={(Object.keys(LAYOUT_LABELS) as Layout[]).map((value) => ({
          value,
          label: LAYOUT_LABELS[value],
        }))}
        selected={[view.layout]}
        onSelect={(layout) => onChange({ ...view, layout })}
      />
      <button
        className={`tool-pill${view.filters.liked ? " selected" : ""}`}
        aria-pressed={view.filters.liked}
        onClick={() => toggle("liked")}
      >
        <Heart size={14} fill={view.filters.liked ? "currentColor" : "none"} />
        Liked
      </button>
    </div>
  );
}
