import { Router } from 'express';
import { encender, apagar, health } from '../controller/instancias.controller.js';

const router = Router();

router.post('/on', encender);
router.post('/off', apagar);
router.get('/health', health);

export default router;
