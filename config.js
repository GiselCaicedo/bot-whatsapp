import dotenv from 'dotenv';

dotenv.config();

export const PORT = parseInt(process.env.PORT ?? '3000');
export const INTERVALO_MS = parseInt(process.env.INTERVALO_MS ?? '20000');
export const PAUSA_ENTRE_MENSAJES_MS = parseInt(process.env.PAUSA_ENTRE_MENSAJES_MS ?? '1500');
export const TIMEOUT_READY_MS = parseInt(process.env.TIMEOUT_READY_MS ?? '60000');
export const RUTA_SESIONES = process.env.RUTA_SESIONES ?? './.wwebjs_auth';
export const HEADLESS = process.env.HEADLESS === 'false' ? false : true;
export const CHROME_PATH = process.env.CHROME_PATH;

export const DB_HOST = process.env.DB_HOST;
export const DB_USER = process.env.DB_USER;
export const DB_PASS = process.env.DB_PASS;
export const DB_NAME = process.env.DB_NAME;
export const DB_PORT = parseInt(process.env.DB_PORT ?? '1433');
