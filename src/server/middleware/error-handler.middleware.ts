/**
 * Global error handler middleware.
 */

import { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message });
}
