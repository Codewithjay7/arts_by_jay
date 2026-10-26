import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import api from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/hooks';
import { useUi } from '../../store/ui';
import { Spinner } from '../ui';

const QUICK_LINKS = [
  { label: 'Original paintings', to: '/shop?type=original' },
  { label: 'Limited prints', to: '/shop?type=print' },
  { label: 'Available now', to: '/shop?availability=available' },
  { label: 'Under ₹20,000', to: '/shop?maxPrice=20000' },
];

export const SearchOverlay = () => {
  const isOpen = useUi((state) => state.isSearchOpen);
  const closeSearch = useUi((state) => state.closeSearch);
  const navigate = useNavigate();

  const [term, setTerm] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef(null);

  // Typing fires one request after a pause, not one per keystroke.
  const debounced = useDebouncedValue(term.trim(), 280);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => {
      const { data: result } = await api.get('/artworks', { params: { q: debounced, limit: 6 } });
      return result;
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const results = data?.items ?? [];

  useEffect(() => {
    if (!isOpen) {
      setTerm('');
      setHighlighted(-1);
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Give the element a frame to mount before focusing it.
    const timer = setTimeout(() => inputRef.current?.focus(), 30);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => setHighlighted(-1), [debounced]);

  const goToSearch = () => {
    if (!term.trim()) return;
    navigate(`/shop?q=${encodeURIComponent(term.trim())}`);
    closeSearch();
  };

  const openResult = (artwork) => {
    navigate(`/art/${artwork.slug}`);
    closeSearch();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      closeSearch();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, results.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, -1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted >= 0 && results[highlighted]) openResult(results[highlighted]);
      else goToSearch();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20 sm:pt-28">
      <button
        type="button"
        className="absolute inset-0 animate-fade-in bg-surface-300/88 backdrop-blur-md"
        onClick={closeSearch}
        aria-label="Close search"
        tabIndex={-1}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search artwork"
        className="relative w-full max-w-2xl animate-fade-up"
      >
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-0 shadow-frame">
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-4.5 w-4.5 shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search by title, artist, medium or style…"
              aria-label="Search artwork"
              aria-controls="search-results"
              autoComplete="off"
              className="h-14 flex-1 bg-transparent text-[0.95rem] text-ink placeholder:text-muted/70 focus:outline-none"
            />
            {isFetching && <Spinner label="Searching" />}
            <button
              type="button"
              onClick={closeSearch}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-150 hover:text-ink"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div id="search-results" className="max-h-[55vh] overflow-y-auto">
            {debounced.length < 2 ? (
              <div className="p-4">
                <p className="eyebrow mb-3">Jump to</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_LINKS.map((link) => (
                    <button
                      key={link.to}
                      type="button"
                      onClick={() => {
                        navigate(link.to);
                        closeSearch();
                      }}
                      className="rounded-full border border-line-strong px-3.5 py-1.5 text-[0.8rem] text-ink/90 transition-colors hover:border-accent-300/50 hover:text-accent-300"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-[0.78rem] text-muted">
                  Type at least two characters to search the collection.
                </p>
              </div>
            ) : results.length === 0 && !isFetching ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-ink">Nothing matched “{debounced}”.</p>
                <p className="mt-1.5 text-[0.8rem] text-muted">
                  Try a shorter term, or browse the full collection.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/shop');
                    closeSearch();
                  }}
                  className="mt-4 text-[0.82rem] text-accent-300 underline-offset-4 hover:underline"
                >
                  Explore all artwork
                </button>
              </div>
            ) : (
              <>
                <ul role="listbox" aria-label="Search results">
                  {results.map((artwork, index) => (
                    <li key={artwork.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === highlighted}
                        onClick={() => openResult(artwork)}
                        onMouseEnter={() => setHighlighted(index)}
                        className={`flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors ${
                          index === highlighted ? 'bg-surface-150' : 'hover:bg-surface-150/60'
                        }`}
                      >
                        <div className="h-14 w-11 shrink-0 overflow-hidden rounded-sm bg-surface-150">
                          {artwork.image && (
                            <img
                              src={artwork.image.thumbUrl || artwork.image.url}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-ink">{artwork.title}</p>
                          <p className="truncate text-[0.76rem] text-muted">
                            {artwork.artist?.displayName}
                            {artwork.medium ? ` · ${artwork.medium}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[0.78rem] text-accent-300">
                            {formatMoney(artwork.priceMinor, artwork.currency)}
                          </p>
                          {artwork.isSoldOut && (
                            <p className="font-mono text-[0.66rem] uppercase tracking-wider text-muted">Sold</p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={goToSearch}
                  className="w-full border-t border-line px-4 py-3 text-[0.82rem] text-accent-300 transition-colors hover:bg-surface-150"
                >
                  See all results for “{debounced}”
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
