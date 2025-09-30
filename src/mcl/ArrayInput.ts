export class ArrayInput<T> {
  private array: T[];
  private _index: number;

  constructor(array: T[]) {
    this.array = array;
    this._index = 0;
  }

  get index(): number {
    return this._index;
  }
  set index(i: number) {
    this._index = i;
  }

  next(): T {
    if (this._index >= this.array.length) {
      throw new Error('Tried to read past the end of the token list');
    }
    return this.array[this._index++];
  }

  skip(): void {
    this._index++;
  }

  peek(): T {
    return this.array[this._index];
  }

  hasNext(): boolean {
    return this._index < this.array.length;
  }

  insert(token: T): void {
    this.array.splice(this._index, 0, token);
  }

  back(): void {
    this._index--;
  }

  update(token: T): void {
    this.array[this._index] = token;
  }
}
