import pkg from 'whatsapp-web.js';
import { getConnection, sql, querys } from '../models/index.js';
import { getSessionDir } from '../models/sesiones.js';
import { enviarAlerta } from './alertas.controller.js';
import { INTERVALO_MS, PAUSA_ENTRE_MENSAJES_MS, HEADLESS, CHROME_PATH, TIMEOUT_READY_MS } from '../../config.js';
import { getIO } from '../socket.js';

const { Client, LocalAuth } = pkg;

const instancias = new Map();

async function crearInstancia(instanciaId) {
  console.log(`Creando instancia ${instanciaId}`);
  
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
  console.log(`Socket.IO conectado:`, !!io);
  
  // Enviar mensaje inicial con ID de instancia
  io.emit('message', { 
    id: instanciaId, 
    type: 'init', 
    message: `Iniciando instancia ${instanciaId}` 
  });
  console.log(`Mensaje 'init' enviado para instancia ${instanciaId}`);

  client.on('qr', (qr) => {
    console.log(`QR generado para instancia ${instanciaId}`);
    state.estado = 'QR_PENDIENTE';
    
    // Emitir mensaje con ID específico
    io.emit('message', { 
      id: instanciaId, 
      type: 'qr', 
      message: 'Escanea el código QR con WhatsApp' 
    });
    
    // Emitir QR con ID específico
    io.emit('qr', { 
      id: instanciaId, 
      qr: qr 
    });
    
    console.log(`QR emitido para instancia ${instanciaId}`);
  });

  client.on('ready', () => {
    console.log(`Cliente listo para instancia ${instanciaId}`);
    state.estado = 'READY';
    
    const phone = client.info?.wid?.user;
    
    // Emitir mensaje de éxito con ID específico
    io.emit('message', { 
      id: instanciaId, 
      type: 'ready', 
      message: 'Conectado exitosamente' 
    });
    
    // Emitir estado de registro con ID específico
    io.emit('registrationStatus', { 
      id: instanciaId, 
      phoneNumber: phone, 
      isRegistered: true 
    });
    
    console.log(`Instancia ${instanciaId} conectada con número: ${phone}`);
    
    // Resolver la promesa cuando esté listo
    if (state.readyResolve) {
      state.readyResolve({
        instanciaId,
        phoneNumber: phone,
        estado: 'READY'
      });
    }
  });

  client.on('disconnected', (reason) => {
    console.log(`Cliente desconectado para instancia ${instanciaId}. Razón:`, reason);
    state.estado = 'DESCONECTADO';
    
    const phone = client.info?.wid?.user;
    
    // Emitir desconexión con ID específico
    io.emit('message', { 
      id: instanciaId, 
      type: 'disconnected', 
      message: 'Cliente desconectado' 
    });
    
    io.emit('registrationStatus', { 
      id: instanciaId, 
      phoneNumber: phone, 
      isRegistered: false 
    });
    
    // Rechazar la promesa si se desconecta antes de estar listo
    if (state.readyReject && state.estado !== 'READY') {
      state.readyReject(new Error(`Instancia ${instanciaId} se desconectó antes de estar lista`));
    }
    
    // Limpiar timer si existe
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
      console.log(`Timer limpiado para instancia desconectada ${instanciaId}`);
    }
  });

  client.on('auth_failure', (msg) => {
    console.log(`Fallo de autenticación para instancia ${instanciaId}:`, msg);
    
    io.emit('message', { 
      id: instanciaId, 
      type: 'auth_failure', 
      message: `Error de autenticación: ${msg}` 
    });
    
    if (state.readyReject) {
      state.readyReject(new Error(`Error de autenticación: ${msg}`));
    }
  });

  // Manejar errores del cliente
  client.on('change_state', (state_info) => {
    console.log(`Cambio de estado en instancia ${instanciaId}:`, state_info);
  });

  try {
    console.log(`Inicializando cliente para instancia ${instanciaId}`);
    await client.initialize();
    console.log(`Cliente inicializado para instancia ${instanciaId}`);
  } catch (error) {
    console.error(`Error inicializando instancia ${instanciaId}:`, error);
    
    io.emit('message', { 
      id: instanciaId, 
      type: 'auth_failure', 
      message: `Error de inicialización: ${error.message}` 
    });
    
    if (state.readyReject) {
      state.readyReject(error);
    }
    throw error;
  }

  instancias.set(instanciaId, state);
  console.log(`Instancia ${instanciaId} guardada en Map`);
  
  return state;
}

export async function encender(req, res) {
  try {
    console.log(`Iniciando proceso de encendido de instancias`);
    
    const pool = await getConnection();
    const result = await pool.request().query(querys.getInstancias);
    const instanciasDB = result.recordset;
    
    console.log(`Instancias encontradas en DB: ${instanciasDB.length}`);
    
    if (instanciasDB.length === 0) {
      return res.json({ 
        message: 'No se encontraron instancias configuradas en la base de datos',
        instancias: [],
        resumen: { total: 0, exitosas: 0, conError: 0 }
      });
    }
    
    const promesasInstancias = [];
    const resultadosInstancias = [];

    for (const row of instanciasDB) {
      const id = row.InstanciaID;
      console.log(`Procesando instancia ${id}`);
      
      if (!instancias.has(id)) {
        console.log(`Creando nueva instancia ${id}`);
        try {
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
        } catch (error) {
          console.error(`Error creando instancia ${id}:`, error);
          resultadosInstancias.push({
            id,
            estado: 'ERROR',
            error: error.message
          });
        }
      } else {
        console.log(`Instancia ${id} ya existe`);
        const state = instancias.get(id);
        if (state.estado === 'READY') {
          resultadosInstancias.push({
            id,
            estado: 'READY',
            phoneNumber: state.client.info?.wid?.user,
            mensaje: 'Ya estaba conectada'
          });
        } else {
          // Si existe pero no está ready, intentar reconectar
          console.log(`Reinstanciando ${id} (estado actual: ${state.estado})`);
          try {
            // Limpiar instancia anterior
            if (state.timer) clearInterval(state.timer);
            if (state.client) await state.client.destroy().catch(() => {});
            instancias.delete(id);
            
            // Crear nueva instancia
            const newState = await crearInstancia(id);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Timeout: Instancia ${id} no se conectó en ${TIMEOUT_READY_MS}ms`));
              }, TIMEOUT_READY_MS);
            });
            
            promesasInstancias.push({
              id,
              promise: Promise.race([newState.readyPromise, timeoutPromise])
            });
          } catch (error) {
            console.error(`Error reinstanciando ${id}:`, error);
            resultadosInstancias.push({
              id,
              estado: 'ERROR',
              error: error.message
            });
          }
        }
      }
    }

    console.log(`Esperando conexión de ${promesasInstancias.length} instancias nuevas...`);

    // Esperar a que todas las instancias estén listas (sin bloquear)
    const resultadosPromesas = await Promise.allSettled(
      promesasInstancias.map(async ({ id, promise }) => {
        try {
          console.log(`Esperando instancia ${id}...`);
          const resultado = await promise;
          
          // Iniciar el timer para procesar mensajes
          const state = instancias.get(id);
          if (state && !state.timer) {
            state.timer = setInterval(() => procesarPendientes(id), INTERVALO_MS);
            console.log(`Timer iniciado para instancia ${id}`);
          }
          
          console.log(`Instancia ${id} lista y funcionando`);
          return {
            ...resultado,
            mensaje: 'Conectada exitosamente'
          };
        } catch (error) {
          console.error(`Error con instancia ${id}:`, error.message);
          return {
            id,
            estado: 'ERROR',
            error: error.message
          };
        }
      })
    );

    // Procesar resultados de las promesas
    for (const resultado of resultadosPromesas) {
      if (resultado.status === 'fulfilled') {
        resultadosInstancias.push(resultado.value);
      } else {
        resultadosInstancias.push({
          id: 'unknown',
          estado: 'ERROR',
          error: resultado.reason?.message || 'Error desconocido'
        });
      }
    }

    const exitosas = resultadosInstancias.filter(r => r.estado === 'READY').length;
    const conError = resultadosInstancias.filter(r => r.estado === 'ERROR').length;
    const enProceso = instanciasDB.length - exitosas - conError;
    
    console.log(`Proceso completado: ${exitosas} exitosas, ${conError} con error, ${enProceso} en proceso`);

    res.json({ 
      message: `Instancias procesadas: ${exitosas} exitosas, ${conError} con error${enProceso > 0 ? `, ${enProceso} en proceso` : ''}`,
      instancias: resultadosInstancias,
      resumen: {
        total: instanciasDB.length,
        exitosas,
        conError,
        enProceso
      }
    });
    
  } catch (err) {
    console.error('Error general en encender:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function apagar(req, res) {
  console.log(`Apagando todas las instancias (${instancias.size} activas)`);
  
  const promesasApagado = [];
  const io = getIO();
  
  for (const [id, state] of instancias.entries()) {
    console.log(`Apagando instancia ${id}`);
    
    // Emitir mensaje de que se está deteniendo
    io.emit('message', { 
      id: id, 
      type: 'disconnected', 
      message: 'Deteniendo instancia...' 
    });
    
    const promesa = (async () => {
      try {
        // PRIMERO: Limpiar timer para evitar que siga procesando
        if (state.timer) {
          clearInterval(state.timer);
          state.timer = null;
          console.log(`Timer detenido para instancia ${id}`);
        }
        
        // SEGUNDO: Cambiar estado para que procesarPendientes no haga nada
        state.estado = 'APAGANDO';
        
        // TERCERO: Esperar un momento para que termine cualquier procesamiento en curso
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // CUARTO: Destruir cliente si existe
        if (state.client) {
          await state.client.destroy();
          console.log(`Cliente destruido para instancia ${id}`);
        }
        
        // QUINTO: Limpiar estado
        state.estado = 'DESCONECTADO';
        
        // Emitir estado final
        io.emit('registrationStatus', { 
          id: id, 
          phoneNumber: null, 
          isRegistered: false 
        });
        
        return { id, success: true };
      } catch (error) {
        console.log(`Error destruyendo cliente ${id}:`, error.message);
        
        // Asegurar que el timer se detenga incluso si hay error
        if (state.timer) {
          clearInterval(state.timer);
          state.timer = null;
        }
        state.estado = 'ERROR';
        
        return { id, success: false, error: error.message };
      }
    })();
    
    promesasApagado.push(promesa);
  }
  
  // Esperar a que todas se apaguen
  const resultados = await Promise.allSettled(promesasApagado);
  const exitosos = resultados.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const conError = resultados.length - exitosos;
  
  // Limpiar el mapa de instancias
  instancias.clear();
  console.log(`Mapa de instancias limpiado`);
  
  // Cerrar conexión de base de datos
  try {
    const pool = await getConnection();
    await pool.close();
    console.log('Conexión de base de datos cerrada');
  } catch (error) {
    console.log('Error cerrando conexión de base de datos:', error.message);
  }
  
  res.json({ 
    message: `Instancias apagadas: ${exitosos} exitosas, ${conError} con error. Conexión DB cerrada.`,
    detalles: resultados.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message })
  });
}

export function health(req, res) {
  const data = {};
  for (const [id, state] of instancias.entries()) {
    data[id] = {
      estado: state.estado,
      ultimaEjecucion: state.ultimaEjecucion,
      enviadasHoy: state.enviadasHoy,
      gruposCacheados: state.gruposCache.size,
      phoneNumber: state.client?.info?.wid?.user || 'N/A',
      timerActivo: !!state.timer
    };
  }
  
  res.json({
    instanciasActivas: instancias.size,
    instancias: data,
    timestamp: new Date().toISOString()
  });
}

async function procesarPendientes(instanciaId) {
  const state = instancias.get(instanciaId);
  const io = getIO();
  
  // Verificaciones de seguridad mejoradas
  if (!state) {
    console.log(`Instancia ${instanciaId} no existe en el mapa`);
    return;
  }
  
  if (!state.client) {
    console.log(`Cliente no existe para instancia ${instanciaId}`);
    return;
  }
  
  // Estados que impiden el procesamiento
  if (!['READY'].includes(state.estado)) {
    console.log(`Instancia ${instanciaId} no está lista para procesar (estado: ${state.estado})`);
    return;
  }
  
  // Verificar que el timer aún esté activo (no fue limpiado)
  if (!state.timer) {
    console.log(`Timer no activo para instancia ${instanciaId}, deteniendo procesamiento`);
    return;
  }
  
  try {
    const pool = await getConnection();
    
    const deliveries = await pool.request()
      .input('instancia', sql.VarChar, instanciaId.toString())
      .query(querys.getDeliveriesByInstancia);
      
    console.log(`Deliveries encontrados para instancia ${instanciaId}:`, deliveries.recordset.length);
    
    for (const { DeliveryID } of deliveries.recordset) {
      // Verificar nuevamente el estado antes de cada iteración
      if (state.estado !== 'READY' || !state.timer) {
        console.log(`Procesamiento interrumpido para instancia ${instanciaId}`);
        return;
      }
      
      const alertas = await pool.request()
        .input('delivery', sql.Int, DeliveryID)
        .query(querys.getAlertasDelDia);
        
      console.log(`Alertas del día para delivery ${DeliveryID}:`, alertas.recordset.length);
      
      for (const alerta of alertas.recordset) {
        // Verificación adicional antes de cada alerta
        if (state.estado !== 'READY' || !state.timer || !state.client) {
          console.log(`Estado cambió durante procesamiento, deteniendo instancia ${instanciaId}`);
          return;
        }
        
        // Verificar si ya fue enviada
        const ya = await pool.request()
          .input('delivery', sql.Int, DeliveryID)
          .input('noticia', sql.Int, alerta.NoticiaID)
          .query(querys.checkAlertaEnviada);
          
        if (ya.recordset.length) {
          console.log(`Alerta ${alerta.NoticiaID} ya fue enviada`);
          continue;
        }
        
        // Obtener nombre del grupo (usar el configurado o CliGis por defecto)
        const groupName = 'CliGis';
        if (!groupName) {
          console.log(`Sin grupo definido para alerta ${alerta.NoticiaID}`);
          continue;
        }
        
        // Buscar o cachear el chat ID del grupo
        let chatId = state.gruposCache.get(groupName);
        if (!chatId) {
          console.log(`Buscando grupo: ${groupName}`);
          try {
            // Verificar que el cliente siga válido antes de usarlo
            if (!state.client || state.estado !== 'READY') {
              console.log(`Cliente no válido para instancia ${instanciaId}`);
              return;
            }
            
            const chats = await state.client.getChats();
            const group = chats.find(c => c.isGroup && c.name === groupName);
            
            if (!group) {
              console.log(`Grupo no encontrado: ${groupName}`);
              continue;
            }
            
            chatId = group.id._serialized;
            state.gruposCache.set(groupName, chatId);
            console.log(`Grupo encontrado y cacheado: ${groupName} (${chatId})`);
          } catch (error) {
            console.error(`Error buscando grupos para instancia ${instanciaId}:`, error);
            continue;
          }
        }
        
        try {
          // Verificación final antes del envío
          if (state.estado !== 'READY' || !state.timer || !state.client) {
            console.log(`Estado cambió justo antes del envío, cancelando para instancia ${instanciaId}`);
            return;
          }
          
          console.log(`Enviando alerta ${alerta.NoticiaID} al grupo ${groupName} (instancia ${instanciaId})`);
          io.emit('message', {
            id: instanciaId,
            type: 'sending',
            message: `Enviando alerta ${alerta.NoticiaID} al grupo ${groupName}`
          });
          
          await enviarAlerta(state.client, alerta, chatId);
          
          // Verificar estado después del envío
          if (state.estado !== 'READY') {
            console.log(`Estado cambió después del envío para instancia ${instanciaId}`);
            return;
          }
          
          // Registrar como enviada
          await pool.request()
            .input('delivery', sql.Int, DeliveryID)
            .input('noticia', sql.Int, alerta.NoticiaID)
            .query(querys.insertAlertaEnviada);
            
          state.enviadasHoy++;
          console.log(`Alerta enviada y registrada. Total enviadas hoy por instancia ${instanciaId}: ${state.enviadasHoy}`);
          io.emit('message', {
            id: instanciaId,
            type: 'sent',
            message: `Alerta ${alerta.NoticiaID} enviada exitosamente`
          });
          
        } catch (error) {
          console.error(`Error enviando alerta ${alerta.NoticiaID} (instancia ${instanciaId}):`, error);
          
          // Si es error de sesión cerrada, marcar instancia como problemática
          if (error.message.includes('Session closed') || error.message.includes('Protocol error')) {
            console.log(`Sesión cerrada detectada para instancia ${instanciaId}, marcando como desconectada`);
            state.estado = 'DESCONECTADO';
            if (state.timer) {
              clearInterval(state.timer);
              state.timer = null;
            }
            io.emit('message', {
              id: instanciaId,
              type: 'disconnected',
              message: 'Sesión cerrada inesperadamente'
            });
            return;
          }
          
          // Si el grupo no existe o hay error de envío, remover del cache para reintentarlo
          if (error.message.includes('Chat not found') || error.message.includes('Group not found')) {
            state.gruposCache.delete(groupName);
            console.log(`Cache de grupo ${groupName} limpiado para instancia ${instanciaId}`);
          }
        }
        
        // Pausa entre mensajes solo si seguimos activos
        if (state.estado === 'READY' && state.timer) {
          await new Promise(r => setTimeout(r, PAUSA_ENTRE_MENSAJES_MS));
        }
      }
    }
    
    state.ultimaEjecucion = new Date().toISOString();
    console.log(`Procesamiento completado para instancia ${instanciaId} - ${state.enviadasHoy} enviadas hoy`);
    
  } catch (error) {
    console.error(`Error procesando pendientes para instancia ${instanciaId}:`, error);
    
    // Si hay error de conexión de BD, no cambiar estado de la instancia
    if (error.message.includes('PROTOCOL_CONNECTION_LOST') || 
        error.message.includes('CONNECTION_LOST') || 
        error.message.includes('Request timeout')) {
      console.log(`Problema de conexión de BD detectado en instancia ${instanciaId}`);
    } else if (error.message.includes('Session closed') || error.message.includes('Protocol error')) {
      // Pero sí marcar como desconectada si es problema del cliente WhatsApp
      console.log(`Problema de cliente WhatsApp detectado en instancia ${instanciaId}`);
      state.estado = 'DESCONECTADO';
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }
  }
}

// Funciones de prueba y utilidades
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

    console.log(`Enviando mensaje de prueba desde instancia ${instanciaId} a ${chatId}`);

    await state.client.sendMessage(chatId, mensaje);

    res.json({ 
      success: true, 
      message: 'Mensaje enviado correctamente',
      destino: chatId,
      instancia: instanciaId
    });

  } catch (error) {
    console.error('Error enviando mensaje de prueba:', error);
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
      grupos: grupos,
      total: grupos.length
    });

  } catch (error) {
    console.error('Error listando grupos:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function obtenerEstadoInstancia(req, res) {
  try {
    const { instanciaId } = req.params;
    const id = parseInt(instanciaId);
    
    const state = instancias.get(id);
    if (!state) {
      return res.status(404).json({ error: 'Instancia no encontrada' });
    }

    res.json({
      id,
      estado: state.estado,
      phoneNumber: state.client?.info?.wid?.user || null,
      ultimaEjecucion: state.ultimaEjecucion,
      enviadasHoy: state.enviadasHoy,
      gruposCacheados: state.gruposCache.size,
      timerActivo: !!state.timer
    });

  } catch (error) {
    console.error('Error obteniendo estado de instancia:', error);
    res.status(500).json({ error: error.message });
  }
}