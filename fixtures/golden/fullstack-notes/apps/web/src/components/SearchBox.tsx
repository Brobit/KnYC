/** Filters the list as you type. */
export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="search" aria-label="Search notes" placeholder="Search" value={value} onChange={(e) => onChange(e.target.value)} />;
}
