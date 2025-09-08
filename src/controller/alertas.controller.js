import { getConnection, querys, sql } from '../models/index.js';
import { io } from '../app.js';
import pkg from 'whatsapp-web.js';
import axios from 'axios';
const { Client, LocalAuth } = pkg;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Estado simple
let isClientReady = false;
let isInitializing = false;

// Cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "client-one"
    }),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false
    }
});

// Event listeners básicos
client.on('qr', (qr) => {
    console.log('QR Code generado - Escanéalo con WhatsApp');
});

client.on('ready', async () => {
    console.log('Cliente WhatsApp listo');
    isClientReady = true;

    // Mostrar grupos disponibles
    try {
        await sleep(3000);
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        console.log('Grupos encontrados:');
        groups.forEach(group => {
            console.log(`- ${group.name}`);
        });
    } catch (error) {
        console.error('Error obteniendo grupos:', error);
    }
});

client.on('disconnected', () => {
    console.log('Cliente desconectado');
    isClientReady = false;
});

// Función para inicializar cliente
const initializeClient = async () => {
    if (isInitializing) {
        console.log('Cliente ya se está inicializando...');
        return;
    }

    if (isClientReady) {
        console.log('Cliente ya está listo');
        return;
    }

    try {
        console.log('Inicializando cliente WhatsApp...');
        isInitializing = true;
        await client.initialize();
    } catch (error) {
        console.error('Error inicializando cliente:', error);
        isInitializing = false;
        throw error;
    }
};

// Función para esperar que el cliente esté listo
const waitForClient = async (maxWait = 60000) => {
    const start = Date.now();
    while (!isClientReady && (Date.now() - start) < maxWait) {
        console.log('Esperando que el cliente esté listo...');
        await sleep(2000);
    }
    return isClientReady;
};

// Función para obtener ID del grupo
const getGroupId = async (groupName) => {
    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);

        if (!group) {
            console.error(`Grupo "${groupName}" no encontrado`);
            const groups = chats.filter(chat => chat.isGroup);
            console.log('Grupos disponibles:', groups.map(g => g.name));
            return null;
        }

        console.log(`Grupo "${groupName}" encontrado`);
        return group.id._serialized;
    } catch (error) {
        console.error('Error obteniendo grupos:', error);
        return null;
    }
};

// Función para clasificar tipo de medio
const getTipoMedio = (tipoMedioId) => {
    if ([7, 8].includes(tipoMedioId)) return 'Gráfica';
    if (tipoMedioId === 10) return 'Online';
    if ([9, 11].includes(tipoMedioId)) return 'Televisión';
    if ([12, 6].includes(tipoMedioId)) return 'Radio';
    return 'Otro';
};

// Función para acortar enlaces
const shortLike = async (url, retries = 3, delay = 1000) => {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
            const shortUrl = response.data.trim();
            
            if (shortUrl && shortUrl.startsWith('https://is.gd/')) {
                console.log('Enlace acortado:', shortUrl);
                return shortUrl;
            } else {
                throw new Error('is.gd returned an invalid response');
            }
        } catch (error) {
            console.log(`[Intento ${attempt + 1}] Error: ${error.message}`);
            if (attempt < retries - 1) await sleep(delay);
        }
    }
    return url; // Fallback a URL original
};

// Función para generar enlace
const generateEnlace = async (alerta) => {
    const baseUrl = 'http://news.globalnews.com.co/Validar.aspx';
    const params = [
        `n=${alerta.NoticiaID}`,
        `u=${alerta.UserID_Pagina}`,
        `c=${alerta.ConsultaID}`
    ];

    if (alerta.TipoArticulo === 3) {
        params.push('m=audiovisual&lang=es');
    } else {
        params.push('m=i');
    }
    
    const originalUrl = `${baseUrl}?${params.join('&')}`;
    const link = await shortLike(originalUrl);
    return link;
};

// Función para generar mensaje - CORREGIDA PARA SER ASYNC
const generateMessage = async (alerta) => {
    console.log('Generando mensaje para alerta:', alerta);
    const tipoMedio = getTipoMedio(alerta.TipoMedioID);
    console.log('Generando mensaje para tipo de medio:', tipoMedio);
    
    // AWAIT el enlace
    const enlace = await generateEnlace(alerta);

    
    switch (tipoMedio) {
        case 'Online':
            return `
🟣 Tipo Medio: *Online*
💻 Medio: *${alerta.NombreMedio}*
 ${alerta.Descripcion && `👉 Programa/Sección:  *${alerta.Descripcion || ''}*` || ''}

${alerta.Titulo}

Noticia en GlobalNews: ${enlace}
`;

        case 'Gráfica':
            return `
🟢 Tipo de medio: *Gráfica*
📰 Medio: *${alerta.NombreMedio}*
👉 Programa/Sección: *${alerta.Descripcion || ''}*

${alerta.Titulo}

Noticia en GlobalNews: ${enlace}
`;

        case 'Televisión':
            return `
🟡 Tipo de medio: Televisión
📺 Medio: ${alerta.NombreMedio}
👉 Programa/Sección: *${alerta.Descripcion || ''}*

${alerta.Titulo}

Noticia en GlobalNews: ${enlace}
`;

        case 'Radio':
            return `
🔴 Tipo de medio: Radio
📻 Medio: ${alerta.NombreMedio}
👉 Programa/Sección: *${alerta.Descripcion || ''}*

${alerta.Titulo}

Noticia en GlobalNews: ${enlace}
`;

        default:
            return `
No se encontró el tipo de medio para esta alerta.`;
    }
};

export const sendAlert = async (req, res) => {
    const groupName = 'Cli1';

    try {
        console.log('=== INICIANDO ENVÍO DE ALERTAS ===');
        console.log('Estado del cliente:', { isClientReady, isInitializing });

        // Inicializar cliente si no está listo
        if (!isClientReady && !isInitializing) {
            console.log('Cliente no está listo, inicializando...');
            await initializeClient();
        }

        // Esperar hasta que esté listo
        if (!isClientReady) {
            console.log('Esperando que el cliente esté listo...');
            const ready = await waitForClient();
            if (!ready) {
                return res.status(408).json({
                    error: 'Timeout: Cliente no se conectó. Escanea el QR en la ventana de Chrome.'
                });
            }
        }

        console.log('Cliente listo, obteniendo alertas...');

        // Obtener alertas de la base de datos
        const pool = await getConnection();
        const result = await pool.request().query(querys.getAllAlerts);

        console.log('Alertas para enviar:', result.recordset.length);

        if (!result.recordset || result.recordset.length === 0) {
            console.log('No hay alertas pendientes');
            return res.status(200).json({ message: 'No hay alertas pendientes' });
        }

        console.log('Buscando grupo:', groupName);

        // Obtener ID del grupo
        const chatId = await getGroupId(groupName);
        if (!chatId) {
            return res.status(404).json({ error: `Grupo "${groupName}" no encontrado` });
        }

        console.log('Grupo encontrado, iniciando envío de mensajes...');

        let enviadas = 0;

        // Enviar cada alerta
        for (const alerta of result.recordset) {
            try {
                // Procesar datos y generar mensaje en el script
                const tipoMedio = getTipoMedio(alerta.TipoMedioID);

                console.log(`Procesando alerta ${alerta.DeliveryID}:`, {
                    tipo: tipoMedio,
                    tipoMedioId: alerta.TipoMedioID,
                    tipoArticulo: alerta.TipoArticulo
                });

                // AWAIT la función generateMessage ya que es async
                const mensaje = await generateMessage(alerta);

                console.log('Mensaje generado:', mensaje);

                console.log(`Enviando alerta ${alerta.DeliveryID} (${tipoMedio})...`);
                await client.sendMessage(chatId, mensaje);

                // // Marcar como enviada en la tabla de control
                // await pool.request()
                //     .input('noticiaId', alerta.NoticiaID)
                //     .input('deliveryId', alerta.DeliveryID)
                //     .query(`
                //         INSERT INTO dbo.BW_AlertasEnviadas (NoticiaID, DeliveryID, FechaEnvio)
                //         VALUES (@noticiaId, @deliveryId, GETDATE())
                //     `);

                enviadas++;
                console.log(`Alerta ${alerta.DeliveryID} enviada correctamente`);
                await sleep(2000); // Pausa entre mensajes

            } catch (error) {
                console.error(`Error enviando alerta ${alerta.DeliveryID}:`, error);
            }
        }

        console.log(`=== ENVÍO COMPLETADO: ${enviadas}/${result.recordset.length} ===`);

        res.status(200).json({
            message: `${enviadas} alertas enviadas al grupo ${groupName}`,
            totalAlertas: result.recordset.length,
            enviadas: enviadas
        });

    } catch (error) {
        console.error('Error en sendAlert:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// Función de debug simple
export const getDebugInfo = async (req, res) => {
    try {
        let info = {
            isClientReady,
            isInitializing,
            phoneNumber: null
        };

        if (isClientReady && client.info) {
            info.phoneNumber = client.info.wid.user;

            try {
                const chats = await client.getChats();
                const groups = chats.filter(chat => chat.isGroup);
                info.totalGroups = groups.length;
                info.groupNames = groups.map(g => g.name);
            } catch (error) {
                info.error = error.message;
            }
        }

        res.status(200).json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};