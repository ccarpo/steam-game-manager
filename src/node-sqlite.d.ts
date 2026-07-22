declare module "node:sqlite" {
  export class StatementSync {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
