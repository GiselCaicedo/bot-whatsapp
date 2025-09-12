import axios from 'axios';

// (opcional pero recomendado) escapar markdown de WhatsApp en textos dinámicos
const escapeWAMarkdown = (text = '') =>
  String(text).replace(/([*_~`])/g, '\\$1').trim();

const getTipoMedio = (tipoMedioId) => {
  if ([7, 8].includes(tipoMedioId)) return 'Gráfica';
  if (tipoMedioId === 10) return 'Online';
  if ([9, 11].includes(tipoMedioId)) return 'Televisión';
  if ([12, 6].includes(tipoMedioId)) return 'Radio';
  return 'Otro';
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const shortLike = async (url, retries = 3, delay = 800) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
      const shortUrl = String(res.data || '').trim();
      if (shortUrl.startsWith('https://is.gd/')) return shortUrl;
      throw new Error('Respuesta inválida de is.gd');
    } catch (e) {
      if (i < retries - 1) await sleep(delay);
    }
  }
  return url; // fallback
};

// Usa tu lógica de enlace real; si ya tienes generateEnlace, puedes reutilizarla
const generateEnlace = async (alerta) => {
  const baseUrl = 'http://news.globalnews.com.co/Validar.aspx';
  const params = [
    `n=${alerta.NoticiaID}`,
    `u=${alerta.UserID_Pagina}`,
    `c=${alerta.ConsultaID}`,
    alerta.TipoArticulo === 3 ? 'm=audiovisual&lang=es' : 'm=i'
  ];
  const originalUrl = `${baseUrl}?${params.join('&')}`;
  return await shortLike(originalUrl);
};

// MISMO NOMBRE, NUEVO FORMATO
export async function enviarAlerta(client, alerta, chatId) {
  const tipoMedio = getTipoMedio(alerta.TipoMedioID);

  const medio = escapeWAMarkdown(alerta.NombreMedio);
  const titulo = escapeWAMarkdown(alerta.Titulo);
  const descripcion = alerta.Descripcion ? escapeWAMarkdown(alerta.Descripcion) : '';
  const enlace = await generateEnlace(alerta);

  const lineas = [];

  if (tipoMedio === 'Online') {
    lineas.push('🟣 Tipo Medio: *Online*');
    lineas.push(`💻 Medio: *${medio}*`);
  } else if (tipoMedio === 'Gráfica') {
    lineas.push('🟢 Tipo de medio: *Gráfica*');
    lineas.push(`📰 Medio: *${medio}*`);
  } else if (tipoMedio === 'Televisión') {
    lineas.push('🟡 Tipo de medio: *Televisión*');
    lineas.push(`📺 Medio: *${medio}*`);
  } else if (tipoMedio === 'Radio') {
    lineas.push('🔴 Tipo de medio: *Radio*');
    lineas.push(`📻 Medio: *${medio}*`);
  } else {
    lineas.push('🟣 Tipo de medio: *Otro*');
    lineas.push(`💻 Medio: *${medio}*`);
  }

  if (descripcion) {
    lineas.push(`👉 Programa/Sección: *${descripcion}*`);
  }

  lineas.push('');
  lineas.push(titulo);
  lineas.push('');
  lineas.push(`Noticia en GlobalNews: ${enlace}`);

  const mensaje = lineas.join('\n');

  // Enviar sin romper formato (opcional: desactiva vista previa si molesta)
  await client.sendMessage(chatId, mensaje /*, { linkPreview: false }*/);

  return mensaje; // por si quieres loguearlo o testearlo
}
