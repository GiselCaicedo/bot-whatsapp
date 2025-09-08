import sql from 'mssql';
import { DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT } from '../../config.js';

const dbSettings = {
  user: DB_USER,
  password: DB_PASS,
  server: DB_HOST,
  database: DB_NAME,
  port: DB_PORT,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: false,
    enableArithAbort: true,
    trustServerCertificate: true
  },
  requestTimeout: 60000
};

export async function getConnection() {
  const pool = await sql.connect(dbSettings);
  return pool;
}

export { sql };
