import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { SlidersHorizontal, X } from 'lucide-react';
import { Badge, Button, Field, Input, Select } from '../ui';
import { formatMoney, minorToMajor } from '../../lib/format';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'popular', label: 'Most collected' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'Any type' },
  { value: 'original', label: 'Originals' },
  { value: 'print', label: 'Prints' },
  { value: 'digital', label: 'Digital' },
  { value: 'commission', label: 'Commissions' },
];

const AVAILABILITY_OPTIONS = [
  { value: '', label: 'Everything' },
  { value: 'available', label: 'Available now' },
  { value: 'sold', label: 'Sold works' },
];

const ORIENTATION_OPTIONS = [
  { value: '', label: 'Any shape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'square', label: 'Square' },
];

/** Readable labels for the active-filter chips. */
const describeFilter = (key, value, { categories, facets }) => {
  switch (key) {
    case 'q':
      return `“${value}”`;
    case 'category':
      return categories?.find((entry) => entry.slug === value)?.name ?? value;
    case 'artist':
      return value;
    case 'type':
      return TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
    case 'availability':
      return AVAILABILITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
    case 'orientation':
      return ORIENTATION_OPTIONS.find((option) => option.value === value)?.label ?? value;
    case 'medium':
      return value;
    case 'style':
      return value;
    case 'minPrice':
      return `From ${formatMoney(Number(value) * 100, facets?.currency ?? 'INR')}`;
    case 'maxPrice':
      return `Up to ${formatMoney(Number(value) * 100, facets?.currency ?? 'INR')}`;
    default:
      return `${key}: ${value}`;
  }
};

const FILTER_KEYS = ['q', 'category', 'artist', 'type', 'medium', 'style', 'minPrice', 'maxPrice', 'availability', 'orientation'];

export const ActiveFilters = ({ filters, onRemove, onClear, categories, facets, className }) => {
  const active = FILTER_KEYS.filter((key) => filters[key]);
  if (!active.length) return null;

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted">Filtering by</span>

      {active.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onRemove(key)}
          className="group inline-flex items-center gap-1.5 rounded-full border border-charcoal-600 bg-charcoal-800 px-3 py-1 text-[0.75rem] text-parchment transition-colors hover:border-accent-300/50 hover:text-accent-300"
        >
          {describeFilter(key, filters[key], { categories, facets })}
          <X className="h-3 w-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
          <span className="sr-only">Remove this filter</span>
        </button>
      ))}

      <button
        type="button"
        onClick={onClear}
        className="text-[0.75rem] text-muted underline-offset-4 transition-colors hover:text-accent-300 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
};

/**
 * The shop's filter rail. Price inputs are committed on blur or Enter rather
 * than on every keystroke, so typing a number does not fire a request per digit.
 */
export const FilterPanel = ({ filters, onChange, categories = [], facets, className }) => {
  const [minPrice, setMinPrice] = useState(filters.minPrice ?? '');
  const [maxPrice, setMaxPrice] = useState(filters.maxPrice ?? '');

  useEffect(() => {
    setMinPrice(filters.minPrice ?? '');
    setMaxPrice(filters.maxPrice ?? '');
  }, [filters.minPrice, filters.maxPrice]);

  const commitPrice = () => {
    const next = {};
    const min = minPrice === '' ? undefined : Math.max(0, Number(minPrice));
    const max = maxPrice === '' ? undefined : Math.max(0, Number(maxPrice));

    // A reversed range is a slip, not an intention — swap it rather than
    // returning nothing.
    if (min != null && max != null && min > max) {
      next.minPrice = max;
      next.maxPrice = min;
      setMinPrice(max);
      setMaxPrice(min);
    } else {
      next.minPrice = min;
      next.maxPrice = max;
    }

    onChange(next);
  };

  const flatCategories = categories.flatMap((category) => [
    category,
    ...(category.children ?? []).map((child) => ({ ...child, isChild: true })),
  ]);

  const priceFloor = facets?.price?.minMinor ? minorToMajor(facets.price.minMinor) : 0;
  const priceCeiling = facets?.price?.maxMinor ? minorToMajor(facets.price.maxMinor) : undefined;

  return (
    <div className={clsx('space-y-6', className)}>
      <Field label="Category" htmlFor="filter-category">
        <Select
          id="filter-category"
          value={filters.category ?? ''}
          onChange={(event) => onChange({ category: event.target.value || undefined })}
        >
          <option value="">All categories</option>
          {flatCategories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.isChild ? `— ${category.name}` : category.name}
              {category.artworkCount != null ? ` (${category.artworkCount})` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Type of work" htmlFor="filter-type">
        <Select
          id="filter-type"
          value={filters.type ?? ''}
          onChange={(event) => onChange({ type: event.target.value || undefined })}
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Price range"
        hint={
          priceCeiling
            ? `Collection spans ${formatMoney(facets.price.minMinor)} to ${formatMoney(facets.price.maxMinor)}`
            : undefined
        }
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={priceFloor}
            placeholder="Min"
            aria-label="Minimum price"
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            onBlur={commitPrice}
            onKeyDown={(event) => event.key === 'Enter' && commitPrice()}
          />
          <span className="text-muted" aria-hidden="true">
            –
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={priceFloor}
            placeholder="Max"
            aria-label="Maximum price"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            onBlur={commitPrice}
            onKeyDown={(event) => event.key === 'Enter' && commitPrice()}
          />
        </div>
      </Field>

      {Boolean(facets?.mediums?.length) && (
        <Field label="Medium" htmlFor="filter-medium">
          <Select
            id="filter-medium"
            value={filters.medium ?? ''}
            onChange={(event) => onChange({ medium: event.target.value || undefined })}
          >
            <option value="">Any medium</option>
            {facets.mediums.map((medium) => (
              <option key={medium} value={medium}>
                {medium}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {Boolean(facets?.styles?.length) && (
        <Field label="Style" htmlFor="filter-style">
          <Select
            id="filter-style"
            value={filters.style ?? ''}
            onChange={(event) => onChange({ style: event.target.value || undefined })}
          >
            <option value="">Any style</option>
            {facets.styles.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Availability" htmlFor="filter-availability">
        <Select
          id="filter-availability"
          value={filters.availability ?? ''}
          onChange={(event) => onChange({ availability: event.target.value || undefined })}
        >
          {AVAILABILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Orientation" htmlFor="filter-orientation">
        <Select
          id="filter-orientation"
          value={filters.orientation ?? ''}
          onChange={(event) => onChange({ orientation: event.target.value || undefined })}
        >
          {ORIENTATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
};

export const SortControl = ({ value, onChange, total, className }) => (
  <div className={clsx('flex items-center gap-3', className)}>
    {total != null && (
      <span className="hidden font-mono text-[0.72rem] uppercase tracking-wider text-muted sm:inline">
        {total} {total === 1 ? 'work' : 'works'}
      </span>
    )}
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Sort artwork"
      className="h-10 w-auto min-w-[11rem] py-0 text-[0.82rem]"
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  </div>
);

export const FilterToggle = ({ activeCount, onClick, className }) => (
  <Button variant="secondary" size="md" onClick={onClick} className={className}>
    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
    Filters
    {activeCount > 0 && <Badge tone="accent">{activeCount}</Badge>}
  </Button>
);

export { FILTER_KEYS, SORT_OPTIONS };
