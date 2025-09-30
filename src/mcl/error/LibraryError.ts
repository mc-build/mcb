import { McbError } from "./McbError";

export class LibraryError extends McbError {
  constructor(message: string) {
    super(`Library Error:\n\t${message}`, []);
    this.name = "LibraryError";
  }
}
