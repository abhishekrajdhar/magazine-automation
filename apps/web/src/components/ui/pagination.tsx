import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  noun?: string;
}

export function Pagination({ page, pageSize, total, onPageChange, noun = "items" }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-ink-3">
      <span className="tabular">
        {from}–{to} of {total} {noun}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular px-1">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon-xs" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}
