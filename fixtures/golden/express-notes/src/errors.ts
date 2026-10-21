import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(what: string) {
    super(404, `${what} not found`);
  }
}

export class ValidationError extends HttpError {
  constructor(details: string[]) {
    super(400, "Invalid request", details);
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError("Route"));
}

// Express recognizes error handlers by their four parameters.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
