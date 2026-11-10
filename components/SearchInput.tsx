import { useEffect, useRef } from 'react';
import { SearchIcon } from './Icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  autoFocus?: boolean;
  size?: 'md' | 'lg';
  busy?: boolean;
}

export function SearchInput({ value, onChange, onSubmit, autoFocus, size = 'lg', busy }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  // "/" focuses the search box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && t?.tagName !== 'INPUT' && t?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lg = size === 'lg';
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      className={`card flex items-center gap-2 ${lg ? 'px-4 py-3' : 'px-3 py-2'} focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/25`}
    >
      <SearchIcon className={`shrink-0 text-stone-400 ${busy ? 'animate-pulse text-accent-500' : ''}`} />
      <input
        ref={ref}
        type="search"
        aria-label="Describe the page you remember"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe what you remember… e.g. that AI tutor website in Zimbabwe"
        className={`min-w-0 flex-1 bg-transparent outline-none placeholder:text-stone-400 ${lg ? 'text-base' : 'text-sm'}`}
      />
      <button type="submit" className="btn-primary" disabled={!value.trim()}>
        Search
      </button>
    </form>
  );
}
