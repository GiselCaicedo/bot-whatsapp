import pkg from 'whatsapp-web.js';
import { getConnection, sql, querys } from '../models/index.js';
import { getSessionDir } from '../models/sesiones.js';
import { enviarAlerta } from './alertas.controller.js';
import { INTERVALO_MS, PAUSA_ENTRE_MENSAJES_MS, HEADLESS, CHROME_PATH } from '../../config.js';

const { Client, LocalAuth } = pkg;

const instancias = new Map();

async function crearInstancia(instanciaId) {
  const sessionDir = getSessionDir(instanciaId);
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: instanciaId.toString(), dataPath: sessionDir }),
    puppeteer: {
      headless: HEADLESS,
      executablePath: CHROME_PATH || undefined
    }
  });

  const state = {
    client,
    estado: 'INICIANDO',
    timer: null,
    gruposCache: new Map(),
    enviadasHoy: 0,
    ultimaEjecucion: null
  };

  client.on('qr', () => { state.estado = 'QR_PENDIENTE'; });
  client.on('ready', () => { state.estado = 'READY'; });
  client.on('disconnected', () => { state.estado = 'DESCONECTADO'; });

  await client.initialize();
  state.timer = setInterval(() => procesarPendientes(instanciaId), INTERVALO_MS);
  instancias.set(instanciaId, state);
}

export async function encender(req, res) {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(querys.getInstancias);
    for (const row of result.recordset) {
      const id = row.InstanciaID;
      if (!instancias.has(id)) {
        await crearInstancia(id);
      }
    }
    res.json({ instancias: Array.from(instancias.keys()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function apagar(req, res) {
  for (const [id, state] of instancias.entries()) {
    clearInterval(state.timer);
    try { await state.client.destroy(); } catch {}
  }
  instancias.clear();
  res.json({ message: 'instancias apagadas' });
}

export function health(req, res) {
  const data = {};
  for (const [id, state] of instancias.entries()) {
    data[id] = {
      estado: state.estado,
      ultimaEjecucion: state.ultimaEjecucion,
      enviadasHoy: state.enviadasHoy,
      gruposCacheados: state.gruposCache.size
    };
  }
  res.json(data);
}

async function procesarPendientes(instanciaId) {
  const state = instancias.get(instanciaId);
  if (!state || state.estado !== 'READY') return;
  const pool = await getConnection();
  const deliveries = await pool.request()
    .input('instancia', sql.VarChar, instanciaId)
    .query(querys.getDeliveriesByInstancia);
  for (const { DeliveryID } of deliveries.recordset) {
    const alertas = await pool.request()
      .input('delivery', sql.Int, DeliveryID)
      .query(querys.getAlertasDelDia);
    for (const alerta of alertas.recordset) {
      const ya = await pool.request()
        .input('delivery', sql.Int, DeliveryID)
        .input('noticia', sql.Int, alerta.NoticiaID)
        .query(querys.checkAlertaEnviada);
      if (ya.recordset.length) continue;
      const groupName = alerta.GrupoCli;
      if (!groupName) continue;
      let chatId = state.gruposCache.get(groupName);
      if (!chatId) {
        const chats = await state.client.getChats();
        const group = chats.find(c => c.isGroup && c.name === groupName);
        if (!group) continue;
        chatId = group.id._serialized;
        state.gruposCache.set(groupName, chatId);
      }
      await enviarAlerta(state.client, alerta, chatId);
      await pool.request()
        .input('delivery', sql.Int, DeliveryID)
        .input('noticia', sql.Int, alerta.NoticiaID)
        .query(querys.insertAlertaEnviada);
      state.enviadasHoy++;
      await new Promise(r => setTimeout(r, PAUSA_ENTRE_MENSAJES_MS));
    }
  }
  state.ultimaEjecucion = new Date().toISOString();
}
