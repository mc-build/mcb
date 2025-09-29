export class McbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McbError';
  }

  public static isMclError(error: any): boolean {
    return error instanceof McbError;
  }
}