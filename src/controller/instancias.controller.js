import pkg from 'whatsapp-web.js';
import { getConnection, sql, querys } from '../models/index.js';
import { getSessionDir } from '../models/sesiones.js';
import { enviarAlerta } from './alertas.controller.js';
import { INTERVALO_MS, PAUSA_ENTRE_MENSAJES_MS, HEADLESS, CHROME_PATH, TIMEOUT_READY_MS } from '../../config.js';
import { getIO } from '../socket.js';

const { Client, LocalAuth } = pkg;

const instancias = new Map();

async function crearInstancia(instanciaId) {
  console.log(`🚀 Creando instancia ${instanciaId}`);
  
  const sessionDir = getSessionDir(instanciaId);
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: instanciaId.toString(), dataPath: sessionDir }),
    puppeteer: {
      headless: HEADLESS,
      executablePath: CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  const state = {
    client,
    estado: 'INICIANDO',
    timer: null,
    gruposCache: new Map(),
    enviadasHoy: 0,
    ultimaEjecucion: null,
    readyPromise: null,
    readyResolve: null,
    readyReject: null
  };

  // Crear promesa que se resuelve cuando el cliente esté listo
  state.readyPromise = new Promise((resolve, reject) => {
    state.readyResolve = resolve;
    state.readyReject = reject;
  });

  const io = getIO();
  console.log(`📡 Socket.IO conectado:`, !!io);
  
  io.emit('message', { id: instanciaId, type: 'init', message: 'Iniciando instancia' });
  console.log(`📤 Mensaje 'init' enviado para instancia ${instanciaId}`);

  client.on('qr', (qr) => {
    console.log(`📱 QR generado para instancia ${instanciaId}`);
    state.estado = 'QR_PENDIENTE';
    io.emit('message', { id: instanciaId, type: 'qr', message: 'Escanea el código QR' });
    io.emit('qr', { id: instanciaId, qr });
    console.log(`📤 QR emitido para instancia ${instanciaId}`);
  });

  client.on('ready', () => {
    console.log(`✅ Cliente listo para instancia ${instanciaId}`);
    state.estado = 'READY';
    io.emit('message', { id: instanciaId, type: 'ready', message: 'Cliente listo' });
    const phone = client.info?.wid?.user;
    io.emit('registrationStatus', { id: instanciaId, phoneNumber: phone, isRegistered: true });
    
    // Resolver la promesa cuando esté listo
    if (state.readyResolve) {
      state.readyResolve({
        instanciaId,
        phoneNumber: phone,
        estado: 'READY'
      });
    }
  });

  client.on('disconnected', () => {
    console.log(`❌ Cliente desconectado para instancia ${instanciaId}`);
    state.estado = 'DESCONECTADO';
    io.emit('message', { id: instanciaId, type: 'disconnected', message: 'Cliente desconectado' });
    const phone = client.info?.wid?.user;
    io.emit('registrationStatus', { id: instanciaId, phoneNumber: phone, isRegistered: false });
    
    // Rechazar la promesa si se desconecta antes de estar listo
    if (state.readyReject && state.estado !== 'READY') {
      state.readyReject(new Error(`Instancia ${instanciaId} se desconectó antes de estar lista`));
    }
  });

  client.on('auth_failure', (msg) => {
    console.log(`🔐 Fallo de autenticación para instancia ${instanciaId}:`, msg);
    io.emit('message', { id: instanciaId, type: 'auth_failure', message: 'Error de autenticación' });
    
    if (state.readyReject) {
      state.readyReject(new Error(`Error de autenticación: ${msg}`));
    }
  });

  try {
    console.log(`🔄 Inicializando cliente para instancia ${instanciaId}`);
    await client.initialize();
    console.log(`✅ Cliente inicializado para instancia ${instanciaId}`);
  } catch (error) {
    console.error(`❌ Error inicializando instancia ${instanciaId}:`, error);
    if (state.readyReject) {
      state.readyReject(error);
    }
    throw error;
  }

  instancias.set(instanciaId, state);
  console.log(`💾 Instancia ${instanciaId} guardada en Map`);
  
  return state;
}

export async function encender(req, res) {
  try {
    console.log(`🔥 Iniciando proceso de encendido de instancias`);
    
    const pool = await getConnection();
    const result = await pool.request().query(querys.getInstancias);
    const instanciasDB = result.recordset;
    
    console.log(`📊 Instancias encontradas en DB: ${instanciasDB.length}`);
    
    const promesasInstancias = [];
    const resultadosInstancias = [];

    for (const row of instanciasDB) {
      const id = row.InstanciaID;
      console.log(`🔍 Procesando instancia ${id}`);
      
      if (!instancias.has(id)) {
        console.log(`🆕 Creando nueva instancia ${id}`);
        const state = await crearInstancia(id);
        
        // Crear timeout para esta instancia
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Timeout: Instancia ${id} no se conectó en ${TIMEOUT_READY_MS}ms`));
          }, TIMEOUT_READY_MS);
        });
        
        // Agregar promesa con timeout
        promesasInstancias.push({
          id,
          promise: Promise.race([state.readyPromise, timeoutPromise])
        });
      } else {
        console.log(`♻️ Instancia ${id} ya existe`);
        const state = instancias.get(id);
        if (state.estado === 'READY') {
          resultadosInstancias.push({
            id,
            estado: 'READY',
            phoneNumber: state.client.info?.wid?.user,
            mensaje: 'Ya estaba conectada'
          });
        }
      }
    }

    console.log(`⏳ Esperando conexión de ${promesasInstancias.length} instancias...`);

    // Esperar a que todas las instancias estén listas
    for (const { id, promise } of promesasInstancias) {
      try {
        console.log(`⏳ Esperando instancia ${id}...`);
        const resultado = await promise;
        
        // Iniciar el timer para procesar mensajes
        const state = instancias.get(id);
        if (state && !state.timer) {
          state.timer = setInterval(() => procesarPendientes(id), INTERVALO_MS);
          console.log(`⏲️ Timer iniciado para instancia ${id}`);
        }
        
        resultadosInstancias.push({
          ...resultado,
          mensaje: 'Conectada exitosamente'
        });
        
        console.log(`✅ Instancia ${id} lista y funcionando`);
      } catch (error) {
        console.error(`❌ Error con instancia ${id}:`, error.message);
        resultadosInstancias.push({
          id,
          estado: 'ERROR',
          error: error.message
        });
      }
    }

    const exitosas = resultadosInstancias.filter(r => r.estado === 'READY').length;
    const conError = resultadosInstancias.filter(r => r.estado === 'ERROR').length;
    
    console.log(`🎉 Proceso completado: ${exitosas} exitosas, ${conError} con error`);

    res.json({ 
      message: `Instancias procesadas: ${exitosas} exitosas, ${conError} con error`,
      instancias: resultadosInstancias,
      resumen: {
        total: resultadosInstancias.length,
        exitosas,
        conError
      }
    });
    
  } catch (err) {
    console.error('❌ Error general en encender:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function apagar(req, res) {
  console.log(`🔴 Apagando todas las instancias`);
  
  for (const [id, state] of instancias.entries()) {
    console.log(`🔴 Apagando instancia ${id}`);
    
    if (state.timer) {
      clearInterval(state.timer);
      console.log(`⏹️ Timer detenido para instancia ${id}`);
    }
    
    try { 
      await state.client.destroy(); 
      console.log(`✅ Cliente destruido para instancia ${id}`);
    } catch (error) {
      console.log(`⚠️ Error destruyendo cliente ${id}:`, error.message);
    }
  }
  
  instancias.clear();
  console.log(`🧹 Mapa de instancias limpiado`);
  
  res.json({ message: 'Todas las instancias han sido apagadas' });
}

export function health(req, res) {
  const data = {};
  for (const [id, state] of instancias.entries()) {
    data[id] = {
      estado: state.estado,
      ultimaEjecucion: state.ultimaEjecucion,
      enviadasHoy: state.enviadasHoy,
      gruposCacheados: state.gruposCache.size,
      phoneNumber: state.client?.info?.wid?.user || 'N/A'
    };
  }
  res.json(data);
}

async function procesarPendientes(instanciaId) {
  const state = instancias.get(instanciaId);
  if (!state || state.estado !== 'READY') return;
  
  try {
    const pool = await getConnection();
    
    const deliveries = await pool.request()
      .input('instancia', sql.VarChar, instanciaId.toString())
      .query(querys.getDeliveriesByInstancia);
      
    console.log(`📊 Deliveries encontrados para instancia ${instanciaId}:`, deliveries.recordset.length);
    
    for (const { DeliveryID } of deliveries.recordset) {
      const alertas = await pool.request()
        .input('delivery', sql.Int, DeliveryID)
        .query(querys.getAlertasDelDia);
        
      console.log(`📧 Alertas del día para delivery ${DeliveryID}:`, alertas.recordset.length);
      
      for (const alerta of alertas.recordset) {
        const ya = await pool.request()
          .input('delivery', sql.Int, DeliveryID)
          .input('noticia', sql.Int, alerta.NoticiaID)
          .query(querys.checkAlertaEnviada);
          
        if (ya.recordset.length) {
          console.log(`⏭️ Alerta ${alerta.NoticiaID} ya fue enviada`);
          continue;
        }
        
        // const groupName = alerta.GrupoCli;
        const groupName = 'CliGis'
        if (!groupName) {
          console.log(`⚠️ Sin grupo definido para alerta ${alerta.NoticiaID}`);
          continue;
        }
        
        let chatId = state.gruposCache.get(groupName);
        if (!chatId) {
          console.log(`🔍 Buscando grupo: ${groupName}`);
          const chats = await state.client.getChats();
          const group = chats.find(c => c.isGroup && c.name === groupName);
          if (!group) {
            console.log(`❌ Grupo no encontrado: ${groupName}`);
            continue;
          }
          chatId = group.id._serialized;
          state.gruposCache.set(groupName, chatId);
          console.log(`✅ Grupo encontrado y cacheado: ${groupName}`);
        }
        
        console.log(`📤 Enviando alerta ${alerta.NoticiaID} al grupo ${groupName}`);
        await enviarAlerta(state.client, alerta, chatId);
        
        await pool.request()
          .input('delivery', sql.Int, DeliveryID)
          .input('noticia', sql.Int, alerta.NoticiaID)
          .query(querys.insertAlertaEnviada);
          
        state.enviadasHoy++;
        console.log(`✅ Alerta enviada y registrada. Total enviadas hoy: ${state.enviadasHoy}`);
        
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_MENSAJES_MS));
      }
    }
    
    state.ultimaEjecucion = new Date().toISOString();
    console.log(`🔄 Procesamiento completado para instancia ${instanciaId}`);
    
  } catch (error) {
    console.error(`❌ Error procesando pendientes para instancia ${instanciaId}:`, error);
  }
}

// Funciones de prueba
export async function enviarMensajePrueba(req, res) {
  try {
    const { instanciaId, mensaje, numeroDestino } = req.body;
    
    if (!instanciaId || !mensaje || !numeroDestino) {
      return res.status(400).json({ 
        error: 'Faltan parámetros: instanciaId, mensaje, numeroDestino' 
      });
    }

    const state = instancias.get(parseInt(instanciaId));
    if (!state) {
      return res.status(404).json({ error: 'Instancia no encontrada' });
    }

    if (state.estado !== 'READY') {
      return res.status(400).json({ 
        error: `Instancia no está lista. Estado: ${state.estado}` 
      });
    }

    let chatId = numeroDestino;
    if (!chatId.includes('@')) {
      const numeroLimpio = numeroDestino.replace(/[\s\-\(\)]/g, '');
      chatId = `${numeroLimpio}@c.us`;
    }

    console.log(`📤 Enviando mensaje de prueba desde instancia ${instanciaId} a ${chatId}`);

    await state.client.sendMessage(chatId, mensaje);

    res.json({ 
      success: true, 
      message: 'Mensaje enviado correctamente',
      destino: chatId,
      instancia: instanciaId
    });

  } catch (error) {
    console.error('❌ Error enviando mensaje de prueba:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function listarGrupos(req, res) {
  try {
    const { instanciaId } = req.params;
    
    const state = instancias.get(parseInt(instanciaId));
    if (!state) {
      return res.status(404).json({ error: 'Instancia no encontrada' });
    }

    if (state.estado !== 'READY') {
      return res.status(400).json({ 
        error: `Instancia no está lista. Estado: ${state.estado}` 
      });
    }

    const chats = await state.client.getChats();
    const grupos = chats
      .filter(chat => chat.isGroup)
      .map(grupo => ({
        id: grupo.id._serialized,
        nombre: grupo.name,
        participantes: grupo.participants?.length || 0
      }));

    res.json({ 
      instancia: instanciaId,
      grupos: grupos
    });

  } catch (error) {
    console.error('❌ Error listando grupos:', error);
    res.status(500).json({ error: error.message });
  }
}