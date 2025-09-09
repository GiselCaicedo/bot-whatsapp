import { Router } from 'express';
import { 
  encender, 
  apagar, 
  health, 
  enviarMensajePrueba, 
  listarGrupos,
  obtenerEstadoInstancia 
} from '../controller/instancias.controller.js';

const router = Router();

// Rutas principales
router.post('/on', encender);
router.post('/off', apagar);
router.get('/health', health);

// Rutas de utilidades y pruebas
router.post('/test/message', enviarMensajePrueba);
router.get('/instance/:instanciaId/groups', listarGrupos);
router.get('/instance/:instanciaId/status', obtenerEstadoInstancia);

// Ruta principal para servir el HTML
router.get('/', (req, res) => {
  res.sendFile('index.html', { root: './public' });
});

export default router;