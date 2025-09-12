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

let globalPool = null;

export async function getConnection() {
  try {
    if (!globalPool) {
      console.log('Creando nueva conexión a la base de datos...');
      globalPool = await sql.connect(dbSettings);
      console.log('Conexión a la base de datos establecida');
    }
    return globalPool;
  } catch (error) {
    console.error('Error conectando a la base de datos:', error);
    globalPool = null; // Reset para permitir reconexión
    throw error;
  }
}

export async function closeConnection() {
  try {
    if (globalPool) {
      console.log('Cerrando conexión global de base de datos...');
      await globalPool.close();
      globalPool = null;
      console.log('Conexión de base de datos cerrada exitosamente');
      return true;
    }
    console.log('No hay conexión activa para cerrar');
    return false;
  } catch (error) {
    console.error('Error cerrando conexión de base de datos:', error);
    globalPool = null; // Reset en caso de error
    throw error;
  }
}

export function getConnectionStatus() {
  return {
    connected: !!globalPool,
    pool: globalPool ? {
      connected: globalPool.connected,
      connecting: globalPool.connecting
    } : null
  };
}

export { sql };