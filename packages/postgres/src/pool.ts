import _ from 'lodash';
import pg, { QueryResult } from 'pg';
import path from 'node:path';
import debugFactory from 'debug';
import { callbackify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

type Params = Record<string, any> | any[];

const debug = debugFactory('prairielib:' + path.basename(__filename, '.js'));
const lastQueryMap: WeakMap<pg.PoolClient, string> = new WeakMap();
const searchSchemaMap: WeakMap<pg.PoolClient, string> = new WeakMap();

function addDataToError(err: Error, data: Record<string, any>): Error {
  (err as any).data = {
    ...((err as any).data ?? {}),
    ...data,
  };
  return err;
}

export class PostgresError extends Error {
  public data: Record<string, any>;

  constructor(message: string, data: Record<string, any>) {
    super(message);
    this.data = data;
    this.name = 'PostgresError';
  }
}

/**
 * Formats a string for debugging.
 */
function debugString(s: string): string {
  if (!_.isString(s)) return 'NOT A STRING';
  s = s.replace(/\n/g, '\\n');
  if (s.length > 78) s = s.substring(0, 75) + '...';
  s = '"' + s + '"';
  return s;
}

/**
 * Formats a set of params for debugging.
 */
function debugParams(params: Params): string {
  let s;
  try {
    s = JSON.stringify(params);
  } catch (err) {
    s = 'CANNOT JSON STRINGIFY';
  }
  return debugString(s);
}

/**
 * Given an SQL string and params, creates an array of params and an SQL string
 * with any named dollar-sign placeholders replaced with parameters.
 */
function paramsToArray(sql: string, params: Params): { processedSql: string; paramsArray: any } {
  if (typeof sql !== 'string') throw new Error('SQL must be a string');
  if (Array.isArray(params)) {
    return {
      processedSql: sql,
      paramsArray: params,
    };
  }
  if (!_.isObjectLike(params)) throw new Error('params must be array or object');

  const re = /\$([-_a-zA-Z0-9]+)/;
  let result;
  let processedSql = '';
  let remainingSql = sql;
  let nParams = 0;
  const map: Record<string, string> = {};
  let paramsArray: any[] = [];
  while ((result = re.exec(remainingSql)) !== null) {
    const v = result[1];
    if (!_(map).has(v)) {
      if (!_(params).has(v)) throw new Error(`Missing parameter: ${v}`);
      if (_.isArray(params[v])) {
        map[v] =
          'ARRAY[' +
          _.map(_.range(nParams + 1, nParams + params[v].length + 1), function (n) {
            return '$' + n;
          }).join(',') +
          ']';
        nParams += params[v].length;
        paramsArray = paramsArray.concat(params[v]);
      } else {
        nParams++;
        map[v] = '$' + nParams;
        paramsArray.push(params[v]);
      }
    }
    processedSql += remainingSql.substring(0, result.index) + map[v];
    remainingSql = remainingSql.substring(result.index + result[0].length);
  }
  processedSql += remainingSql;
  remainingSql = '';
  return { processedSql, paramsArray };
}

/**
 * Escapes the given identifier for use in an SQL query. Useful for preventing
 * SQL injection.
 */
function escapeIdentifier(identifier: string): string {
  // Note that as of 2021-06-29 escapeIdentifier() is undocumented. See:
  // https://github.com/brianc/node-postgres/pull/396
  // https://github.com/brianc/node-postgres/issues/1978
  // https://www.postgresql.org/docs/12/sql-syntax-lexical.html
  return pg.Client.prototype.escapeIdentifier(identifier);
}

export class PostgresPool {
  /** The pool from which clients will be acquired. */
  private pool: pg.Pool | null = null;
  /**
   * We use this to propagate the client associated with the current transaction
   * to any nested queries. In the past, we had some nasty bugs associated with
   * the fact that we tried to acquire new clients inside of transactions, which
   * ultimately lead to a deadlock.
   */
  private alsClient: AsyncLocalStorage<pg.PoolClient> = new AsyncLocalStorage();
  private searchSchema: string | null = null;

  /**
   * Creates a new connection pool and attempts to connect to the database.
   */
  async initAsync(
    pgConfig: pg.PoolConfig,
    idleErrorHandler: (error: Error, client: pg.PoolClient) => void
  ): Promise<void> {
    this.pool = new pg.Pool(pgConfig);
    this.pool.on('error', function (err, client) {
      const lastQuery = lastQueryMap.get(client);
      idleErrorHandler(addDataToError(err, { lastQuery }), client);
    });
    this.pool.on('connect', (client) => {
      client.on('error', (err) => {
        const lastQuery = lastQueryMap.get(client);
        idleErrorHandler(addDataToError(err, { lastQuery }), client);
      });
    });
    this.pool.on('remove', (client) => {
      // This shouldn't be necessary, as `pg` currently allows clients to be
      // garbage collected after they're removed. However, if `pg` someday
      // starts reusing client objects across difference connections, this
      // will ensure that we re-set the search path when the client reconnects.
      searchSchemaMap.delete(client);
    });

    // Attempt to connect to the database so that we can fail quickly if
    // something isn't configured correctly.
    let retryCount = 0;
    const retryTimeouts = [500, 1000, 2000, 5000, 10000];
    while (retryCount <= retryTimeouts.length) {
      try {
        const client = await this.pool.connect();
        client.release();
        return;
      } catch (err: any) {
        if (retryCount === retryTimeouts.length) {
          throw new Error(
            `Could not connect to Postgres after ${retryTimeouts.length} attempts: ${err.message}`
          );
        }

        const timeout = retryTimeouts[retryCount];
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, timeout));
      }
    }
  }

  /**
   * Creates a new connection pool and attempts to connect to the database.
   */
  init = callbackify(this.initAsync);

  /**
   * Closes the connection pool.
   */
  async closeAsync(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }

  /**
   * Closes the connection pool.
   */
  close = callbackify(this.closeAsync);

  /**
   * Gets a new client from the connection pool. If `err` is not null
   * then `client` and `done` are undefined. If `err` is null then
   * `client` is valid and can be used. The caller MUST call `done()` to
   * release the client, whether or not errors occurred while using
   * `client`. The client can call `done(truthy_value)` to force
   * destruction of the client, but this should not be used except in
   * unusual circumstances.
   */
  async getClientAsync(): Promise<pg.PoolClient> {
    if (!this.pool) {
      throw new Error('Connection pool is not open');
    }

    // If we're inside a transaction, we'll reuse the same client to avoid a
    // potential deadlock.
    let client = this.alsClient.getStore() ?? (await this.pool.connect());

    // If we're configured to use a particular schema, we'll store whether or
    // not the search path has already been configured for this particular
    // client. If we acquire a client and it's already had its search path
    // set, we can avoid setting it again since the search path will persist
    // for the life of the client.
    //
    // We do this check for each call to `getClient` instead of on
    // `pool.connect` so that we don't have to be really careful about
    // destroying old clients that were created before `setSearchSchema` was
    // called. Instead, we'll just check if the search path matches the
    // currently-desired schema, and if it's a mismatch (or doesn't exist
    // at all), we re-set it for the current client.
    //
    // Note that this accidentally supports changing the search_path on the fly,
    // although that's not something we currently do (or would be likely to do).
    // It does NOT support clearing the existing search schema - e.g.,
    // `setSearchSchema(null)` would not work as you expect. This is fine, as
    // that's not something we ever do in practice.
    const clientSearchSchema = searchSchemaMap.get(client);
    if (this.searchSchema != null && clientSearchSchema !== this.searchSchema) {
      const setSearchPathSql = `SET search_path TO ${escapeIdentifier(this.searchSchema)},public`;
      try {
        await this.queryWithClientAsync(client, setSearchPathSql, {});
      } catch (err) {
        client.release();
        throw err;
      }
      searchSchemaMap.set(client, this.searchSchema);
    }

    return client;
  }

  /**
   * Gets a new client from the connection pool.
   */
  getClient(callback: (error: Error | null, client?: pg.PoolClient, done?: () => void) => void) {
    this.getClientAsync()
      .then((client) => callback(null, client, client.release))
      .catch((err) => callback(err));
  }

  /**
   * Performs a query with the given client.
   */
  async queryWithClientAsync(
    client: pg.PoolClient,
    sql: string,
    params: Params
  ): Promise<pg.QueryResult> {
    debug('queryWithClient()', 'sql:', debugString(sql));
    debug('queryWithClient()', 'params:', debugParams(params));
    const { processedSql, paramsArray } = paramsToArray(sql, params);
    try {
      lastQueryMap.set(client, processedSql);
      const result = await client.query(processedSql, paramsArray);
      debug('queryWithClient() success', 'rowCount:', result.rowCount);
      return result;
    } catch (err: any) {
      // TODO: why do we do this?
      const sqlError = JSON.parse(JSON.stringify(err));
      sqlError.message = err.message;
      throw addDataToError(err, {
        sqlError: sqlError,
        sql: sql,
        sqlParams: params,
      });
    }
  }

  /**
   * Performs a query with the given client.
   */
  queryWithClient = callbackify(this.queryWithClientAsync);

  /**
   * Performs a query with the given client. Errors if the query returns more
   * than one row.
   */
  async queryWithClientOneRowAsync(
    client: pg.PoolClient,
    sql: string,
    params: Params
  ): Promise<pg.QueryResult> {
    debug('queryWithClientOneRow()', 'sql:', debugString(sql));
    debug('queryWithClientOneRow()', 'params:', debugParams(params));
    const result = await this.queryWithClientAsync(client, sql, params);
    if (result.rowCount !== 1) {
      throw new PostgresError(`Incorrect rowCount: ${result.rowCount}`, {
        sql,
        sqlParams: params,
        result,
      });
    }
    debug('queryWithClientOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Performs a query with the given client. Errors if the query returns more
   * than one row.
   */
  queryWithClientOneRow = callbackify(this.queryWithClientOneRowAsync);

  /**
   * Performs a query with the given client. Errors if the query returns more
   * than one row.
   */
  async queryWithClientZeroOrOneRowAsync(
    client: pg.PoolClient,
    sql: string,
    params: Params
  ): Promise<QueryResult> {
    debug('queryWithClientZeroOrOneRow()', 'sql:', debugString(sql));
    debug('queryWithClientZeroOrOneRow()', 'params:', debugParams(params));
    const result = await this.queryWithClientAsync(client, sql, params);
    if (result.rowCount > 1) {
      throw new PostgresError(`Incorrect rowCount: ${result.rowCount}`, {
        sql,
        sqlParams: params,
        result,
      });
    }
    debug('queryWithClientZeroOrOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Performs a query with the given client. Errors if the query returns more
   * than one row.
   */
  queryWithClientZeroOrOneRow = callbackify(this.queryWithClientZeroOrOneRowAsync);

  /**
   * Rolls back the current transaction for the given client.
   */
  async rollbackWithClientAsync(client: pg.PoolClient) {
    debug('rollbackWithClient()');
    // From https://node-postgres.com/features/transactions
    try {
      await client.query('ROLLBACK');
      // Only release the client if we weren't already inside a transaction.
      if (this.alsClient.getStore() === undefined) {
        client.release();
      }
    } catch (err: any) {
      // If there was a problem rolling back the query, something is
      // seriously messed up. Return the error to the release() function to
      // close & remove this client from the pool. If you leave a client in
      // the pool with an unaborted transaction, weird and hard to diagnose
      // problems might happen.
      client.release(err);
    }
  }

  /**
   * Rolls back the current transaction for the given client.
   */
  rollbackWithClient(
    client: pg.PoolClient,
    _done: (release?: any) => void,
    callback: (err: Error | null) => void
  ) {
    // Note that we can't use `util.callbackify` here because this function
    // has an additional unused `done` parameter for backwards compatibility.
    this.rollbackWithClientAsync(client)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  /**
   * Begins a new transaction.
   */
  async beginTransactionAsync(): Promise<pg.PoolClient> {
    debug('beginTransaction()');
    const client = await this.getClientAsync();
    try {
      await this.queryWithClientAsync(client, 'START TRANSACTION;', {});
      return client;
    } catch (err) {
      await this.rollbackWithClientAsync(client);
      throw err;
    }
  }

  /**
   * Commits the transaction if err is null, otherwise rollbacks the transaction.
   * Also releases the client.
   */
  async endTransactionAsync(client: pg.PoolClient, err: Error | null | undefined) {
    debug('endTransaction()');
    if (err) {
      try {
        await this.rollbackWithClientAsync(client);
      } catch (rollbackErr: any) {
        throw addDataToError(rollbackErr, { prevErr: err, rollback: 'fail' });
      }

      // Even though we successfully rolled back the transaction, there was
      // still an error in the first place that necessitated a rollback. Re-throw
      // that error here so that everything downstream of here will know about it.
      throw addDataToError(err, { rollback: 'success' });
    } else {
      try {
        await this.queryWithClientAsync(client, 'COMMIT', {});
      } finally {
        // Only release the client if we aren't nested inside another transaction.
        if (this.alsClient.getStore() === undefined) {
          client.release();
        }
      }
    }
  }

  /**
   * Commits the transaction if err is null, otherwise rollbacks the transaction.
   * Also releases the client.
   */
  endTransaction(
    client: pg.PoolClient,
    _done: (rollback?: any) => void,
    err: Error | null | undefined,
    callback: (error: Error | null) => void
  ): void {
    this.endTransactionAsync(client, err)
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  /**
   * Runs the specified function inside of a transaction. The function will
   * receive a database client as an argument, but it can also make queries
   * as usual, and the correct client will be used automatically.
   *
   * The transaction will be rolled back if the function throws an error, and
   * will be committed otherwise.
   */
  async runInTransactionAsync(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await this.beginTransactionAsync();
    try {
      await this.alsClient.run(client, () => fn(client));
    } catch (err: any) {
      await this.endTransactionAsync(client, err);
      throw err;
    }

    // Note that we don't invoke `endTransactionAsync` inside the `try` block
    // because we don't want an error thrown by it to trigger *another* call
    // to `endTransactionAsync` in the `catch` block.
    await this.endTransactionAsync(client, null);
  }

  /**
   * Executes a query with the specified parameters.
   */
  async queryAsync(sql: string, params: Params): Promise<QueryResult> {
    debug('query()', 'sql:', debugString(sql));
    debug('query()', 'params:', debugParams(params));
    const client = await this.getClientAsync();
    try {
      return await this.queryWithClientAsync(client, sql, params);
    } finally {
      // Only release if we aren't nested in a transaction.
      if (this.alsClient.getStore() === undefined) {
        client.release();
      }
    }
  }

  /**
   * Executes a query with the specified parameters.
   */
  query = callbackify(this.queryAsync);

  /**
   * Executes a query with the specified parameters. Errors if the query does
   * not return exactly one row.
   */
  async queryOneRowAsync(sql: string, params: Params): Promise<pg.QueryResult> {
    debug('queryOneRow()', 'sql:', debugString(sql));
    debug('queryOneRow()', 'params:', debugParams(params));
    const result = await this.queryAsync(sql, params);
    if (result.rowCount !== 1) {
      throw new PostgresError(`Incorrect rowCount: ${result.rowCount}`, {
        sql,
        sqlParams: params,
      });
    }
    debug('queryOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Executes a query with the specified parameters. Errors if the query does
   * not return exactly one row.
   */
  queryOneRow = callbackify(this.queryOneRowAsync);

  /**
   * Executes a query with the specified parameters. Errors if the query
   * returns more than one row.
   */
  async queryZeroOrOneRowAsync(sql: string, params: Params): Promise<pg.QueryResult> {
    debug('queryZeroOrOneRow()', 'sql:', debugString(sql));
    debug('queryZeroOrOneRow()', 'params:', debugParams(params));
    const result = await this.queryAsync(sql, params);
    if (result.rowCount > 1) {
      throw new PostgresError(`Incorrect rowCount: ${result.rowCount}`, {
        sql,
        sqlParams: params,
      });
    }
    debug('queryZeroOrOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Executes a query with the specified parameters. Errors if the query
   * returns more than one row.
   */
  queryZeroOrOneRow = callbackify(this.queryZeroOrOneRowAsync);

  /**
   * Calls the given function with the specified parameters.
   */
  async callAsync(functionName: string, params: any[]): Promise<pg.QueryResult> {
    debug('call()', 'function:', functionName);
    debug('call()', 'params:', debugParams(params));
    const placeholders = _.map(_.range(1, params.length + 1), (v) => '$' + v).join();
    const sql = `SELECT * FROM ${escapeIdentifier(functionName)}(${placeholders});`;
    const result = await this.queryAsync(sql, params);
    debug('call() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Calls the given function with the specified parameters.
   */
  call = callbackify(this.callAsync);

  /**
   * Calls the given function with the specified parameters. Errors if the
   * function does not return exactly one row.
   */
  async callOneRowAsync(functionName: string, params: any[]): Promise<pg.QueryResult> {
    debug('callOneRow()', 'function:', functionName);
    debug('callOneRow()', 'params:', debugParams(params));
    const result = await this.callAsync(functionName, params);
    if (result.rowCount !== 1) {
      throw new PostgresError('Incorrect rowCount: ' + result.rowCount, {
        functionName,
        sqlParams: params,
      });
    }
    debug('callOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Calls the given function with the specified parameters. Errors if the
   * function does not return exactly one row.
   */
  callOneRow = callbackify(this.callOneRowAsync);

  /**
   * Calls the given function with the specified parameters. Errors if the
   * function returns more than one row.
   */
  async callZeroOrOneRowAsync(functionName: string, params: any[]): Promise<pg.QueryResult> {
    debug('callZeroOrOneRow()', 'function:', functionName);
    debug('callZeroOrOneRow()', 'params:', debugParams(params));
    const result = await this.callAsync(functionName, params);
    if (result.rowCount > 1) {
      throw new PostgresError('Incorrect rowCount: ' + result.rowCount, {
        functionName,
        sqlParams: params,
      });
    }
    debug('callZeroOrOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Calls the given function with the specified parameters. Errors if the
   * function returns more than one row.
   */
  callZeroOrOneRow = callbackify(this.callZeroOrOneRowAsync);

  /**
   * Calls a function with the specified parameters using a specific client.
   */
  async callWithClientAsync(
    client: pg.PoolClient,
    functionName: string,
    params: any[]
  ): Promise<pg.QueryResult> {
    debug('callWithClient()', 'function:', functionName);
    debug('callWithClient()', 'params:', debugParams(params));
    const placeholders = _.map(_.range(1, params.length + 1), (v) => '$' + v).join();
    const sql = `SELECT * FROM ${escapeIdentifier(functionName)}(${placeholders})`;
    const result = await this.queryWithClientAsync(client, sql, params);
    debug('callWithClient() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Calls a function with the specified parameters using a specific client.
   */
  callWithClient = callbackify(this.callWithClientAsync);

  /**
   * Calls a function with the specified parameters using a specific client.
   * Errors if the function does not return exactly one row.
   */
  async callWithClientOneRowAsync(
    client: pg.PoolClient,
    functionName: string,
    params: any[]
  ): Promise<pg.QueryResult> {
    debug('callWithClientOneRow()', 'function:', functionName);
    debug('callWithClientOneRow()', 'params:', debugParams(params));
    const result = await this.callWithClientAsync(client, functionName, params);
    if (result.rowCount !== 1) {
      throw new PostgresError('Incorrect rowCount: ' + result.rowCount, {
        functionName,
        sqlParams: params,
      });
    }
    debug('callWithClientOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Calls a function with the specified parameters using a specific client.
   * Errors if the function does not return exactly one row.
   */
  callWithClientOneRow = callbackify(this.callWithClientOneRowAsync);

  /**
   * Calls a function with the specified parameters using a specific client.
   * Errors if the function returns more than one row.
   */
  async callWithClientZeroOrOneRowAsync(
    client: pg.PoolClient,
    functionName: string,
    params: any[]
  ): Promise<pg.QueryResult> {
    debug('callWithClientZeroOrOneRow()', 'function:', functionName);
    debug('callWithClientZeroOrOneRow()', 'params:', debugParams(params));
    const result = await this.callWithClientAsync(client, functionName, params);
    if (result.rowCount > 1) {
      throw new PostgresError('Incorrect rowCount: ' + result.rowCount, {
        functionName,
        sqlParams: params,
      });
    }
    debug('callWithClientZeroOrOneRow() success', 'rowCount:', result.rowCount);
    return result;
  }

  /**
   * Calls a function with the specified parameters using a specific client.
   * Errors if the function returns more than one row.
   */
  callWithClientZeroOrOneRow = callbackify(this.callWithClientZeroOrOneRowAsync);

  /**
   * Wrapper around {@link queryAsync} that validates that the returned data
   * matches the given validation model. Returns only the rows of the query.
   */
  async queryValidatedRows<Model extends z.ZodTypeAny>(
    query: string,
    params: Record<string, any>,
    model: Model
  ): Promise<z.infer<Model>[]> {
    const results = await this.queryAsync(query, params);
    return z.array(model).parse(results.rows);
  }

  /**
   * Wrapper around {@link queryOneRowAsync} that validates that the returned data
   * matches the given validation model. Returns only a single row of the query.
   */
  async queryValidatedOneRow<Model extends z.ZodTypeAny>(
    query: string,
    params: Record<string, any>,
    model: Model
  ): Promise<z.infer<Model>> {
    const results = await this.queryOneRowAsync(query, params);
    return model.parse(results.rows[0]);
  }

  /**
   * Wrapper around {@link queryZeroOrOneRowAsync} that validates that the
   * returned data matches the given validation model, if it return anything.
   * Returns either the single row of the query or `null`.
   */
  async queryValidatedZeroOrOneRow<Model extends z.ZodTypeAny>(
    query: string,
    params: Record<string, any>,
    model: Model
  ): Promise<z.infer<Model> | null> {
    const results = await this.queryZeroOrOneRowAsync(query, params);
    if (results.rows.length == 0) {
      return null;
    } else {
      return model.parse(results.rows[0]);
    }
  }

  /**
   * Wrapper around {@link queryAsync} that validates that only one column is
   * returned and the data in it matches the given validation model. Returns only
   * the single column of the query as an array.
   */
  async queryValidatedSingleColumnRows<Model extends z.ZodTypeAny>(
    query: string,
    params: Record<string, any>,
    model: Model
  ): Promise<z.infer<Model>[]> {
    const results = await this.queryAsync(query, params);
    if (results.fields.length != 1) {
      throw new Error(`Expected one column, got ${results.fields.length}`);
    }
    const columnName = results.fields[0].name;
    const rawData = results.rows.map((row) => row[columnName]);
    return z.array(model).parse(rawData);
  }

  /**
   * Wrapper around {@link queryOneRowAsync} that validates that only one column
   * is returned and the data in it matches the given validation model. Returns
   * only the single entry.
   */
  async queryValidatedSingleColumnOneRow<Model extends z.ZodTypeAny>(
    query: string,
    params: Record<string, any>,
    model: Model
  ): Promise<z.infer<Model>> {
    const results = await this.queryOneRowAsync(query, params);
    if (results.fields.length != 1) {
      throw new Error(`Expected one column, got ${results.fields.length}`);
    }
    const columnName = results.fields[0].name;
    return model.parse(results.rows[0][columnName]);
  }

  /**
   * Wrapper around {@link queryZeroOrOneRowAsync} that validates that only one
   * column is returned and the data in it matches the given validation model, if
   * it return anything. Returns either the single row of the query or `null`.
   */
  async queryValidatedSingleColumnZeroOrOneRow<Model extends z.ZodTypeAny>(
    query: string,
    params: Record<string, any>,
    model: Model
  ): Promise<z.infer<Model> | null> {
    const results = await this.queryZeroOrOneRowAsync(query, params);
    if (results.fields.length != 1) {
      throw new Error(`Expected one column, got ${results.fields.length}`);
    }
    if (results.rows.length == 0) {
      return null;
    } else {
      const columnName = results.fields[0].name;
      return model.parse(results.rows[0][columnName]);
    }
  }

  /**
   * Wrapper around {@link callAsync} that validates that the returned data
   * matches the given validation model. Returns only the rows.
   */
  async callValidatedRows<Model extends z.ZodTypeAny>(
    sprocName: string,
    params: any[],
    model: Model
  ): Promise<z.infer<Model>[]> {
    const results = await this.callAsync(sprocName, params);
    return z.array(model).parse(results.rows);
  }

  /**
   * Wrapper around {@link callOneRowAsync} that validates that the returned data
   * matches the given validation model. Returns only a single row.
   */
  async callValidatedOneRow<Model extends z.ZodTypeAny>(
    sprocName: string,
    params: any[],
    model: Model
  ): Promise<z.infer<Model>> {
    const results = await this.callOneRowAsync(sprocName, params);
    return model.parse(results.rows[0]);
  }

  /**
   * Wrapper around {@link callZeroOrOneRowAsync} that validates that the
   * returned data matches the given validation model, if it return anything.
   * Returns at most a single row.
   */
  async callValidatedZeroOrOneRow<Model extends z.ZodTypeAny>(
    sprocName: string,
    params: any[],
    model: Model
  ): Promise<z.infer<Model> | null> {
    const results = await this.callZeroOrOneRowAsync(sprocName, params);
    if (results.rows.length == 0) {
      return null;
    } else {
      return model.parse(results.rows[0]);
    }
  }

  /**
   * Set the schema to use for the search path.
   *
   * @param schema The schema name to use (can be "null" to unset the search path)
   */
  async setSearchSchema(schema: string) {
    if (schema == null) {
      this.searchSchema = schema;
      return;
    }

    await this.queryAsync(`CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(schema)}`, {});
    // We only set searchSchema after CREATE to avoid the above query() call using searchSchema.
    this.searchSchema = schema;
  }

  /**
   * Get the schema that is currently used for the search path.
   *
   * @return schema in use (may be `null` to indicate no schema)
   */
  getSearchSchema(): string | null {
    return this.searchSchema;
  }

  /**
   * Generate, set, and return a random schema name.
   *
   * @param prefix The prefix of the new schema, only the first 28 characters will be used (after lowercasing).
   * @returns The randomly-generated search schema.
   */
  async setRandomSearchSchemaAsync(prefix: string): Promise<string> {
    // truncated prefix (max 28 characters)
    const truncPrefix = prefix.substring(0, 28);
    // timestamp in format YYYY-MM-DDTHH:MM:SS.SSSZ (guaranteed to not exceed 27 characters in the spec)
    const timestamp = new Date().toISOString();
    // random 6-character suffix to avoid clashes (approx 2 billion possible values)
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const suffix = _.times(6, function () {
      return _.sample(chars);
    }).join('');

    // Schema is guaranteed to have length at most 63 (= 28 + 1 + 27 + 1 + 6),
    // which is the default PostgreSQL identifier limit.
    // Note that this schema name will need quoting because of characters like ':', '-', etc
    const schema = `${truncPrefix}_${timestamp}_${suffix}`;
    await this.setSearchSchema(schema);
    return schema;
  }

  /**
   * Generate, set, and return a random schema name.
   */
  setRandomSearchSchema = callbackify(this.setRandomSearchSchemaAsync);
}