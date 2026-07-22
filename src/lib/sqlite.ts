import { DatabaseSync, StatementSync } from "node:sqlite";

export class Database {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
  }

  exec(sql: string) {
    this.database.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.database.prepare(sql);
  }

  pragma(value: string) {
    this.database.exec(`PRAGMA ${value}`);
  }

  transaction<T>(callback: () => T): () => T {
    return () => {
      this.database.exec("BEGIN");
      try {
        const result = callback();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    };
  }

  close() {
    this.database.close();
  }
}
