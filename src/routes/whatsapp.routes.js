import { Router } from "express";
import * as alerta from "../controller/alertas.controller.js"

const router = Router()

router.post("/send-alert", alerta.sendAlert) 
router.get('/debug', alerta.getDebugInfo);



export default router;

