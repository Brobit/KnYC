export interface Link {
  code: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  visits: number;
  lastVisitAt: string | null;
}
