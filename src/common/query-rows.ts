/**
 * Lo que devuelve `dataSource.query` en Postgres: con UPDATE / DELETE … RETURNING,
 * `[filas, cantidad]`; con SELECT (o INSERT), directamente las filas.
 */
export type QueryRows<T> = [T[], number] | T[];

/** Las filas, sea cual sea la forma en que TypeORM las devolvió. */
export function rowsOf<T>(result: QueryRows<T>): T[] {
  return Array.isArray(result[0]) ? (result as [T[], number])[0] : (result as T[]);
}
