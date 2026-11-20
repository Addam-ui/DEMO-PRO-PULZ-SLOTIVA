export class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new AppError(400, message, extra);
export const notFound = (message = 'Nenalezeno.') => new AppError(404, message);
export const conflict = (message, extra) => new AppError(409, message, extra);
export const unavailable = (message, extra) => new AppError(503, message, extra);
