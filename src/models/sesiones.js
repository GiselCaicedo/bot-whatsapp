import fs from 'fs';
import path from 'path';
import { RUTA_SESIONES } from '../../config.js';

export function getSessionDir(instanciaId) {
  const dir = path.join(RUTA_SESIONES, instanciaId.toString());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
